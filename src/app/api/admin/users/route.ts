// Route-local import — do NOT use the shared lib helper here.
// Importing from '@/lib/supabase/server' can cause Next.js to tree-shake or
// bundle this module into a context where SUPABASE_SERVICE_ROLE_KEY is scrubbed.
// Reading the env vars and constructing the client directly inside this file
// guarantees they are evaluated in the Node.js API-route runtime.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth'
import { freshTrialWindow } from '@/lib/trial'
import { generateMagicToken } from '@/lib/guestToken'
import { sendEmail, buildWelcomeEmail, buildStaffWelcomeEmail, looksLikeEmail } from '@/lib/email'

// ── Shared admin-client factory (module-scoped helper, server-only) ──────────
// Defined here rather than imported from lib so the env-var reads stay inside
// the API route bundle and are never confused with client-side code.
function buildAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/** POST /api/admin/users — create a new athlete account via the Admin Auth API */
export async function POST(request: Request) {
  // ── Caller must be staff (admin or coach) ──────────────────────────────────
  let caller
  try {
    caller = await requireStaff()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Build admin client ─────────────────────────────────────────────────────
  const supabaseAdmin = buildAdminClient()
  if (!supabaseAdmin) {
    console.error('[POST /api/admin/users] Missing SUPABASE_SERVICE_ROLE_KEY or URL')
    return NextResponse.json(
      { error: 'Thiếu cấu hình môi trường hệ thống trên Server.' },
      { status: 500 },
    )
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let email: string, password: string, full_name: string | undefined, role: string
  try {
    const body = await request.json()
    email     = body.email
    password  = body.password
    full_name = body.full_name
    role      = body.role ?? 'user'
  } catch {
    return NextResponse.json(
      { error: 'Yêu cầu không hợp lệ — body phải là JSON' },
      { status: 400 },
    )
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: 'email và mật khẩu là bắt buộc' },
      { status: 400 },
    )
  }

  // ── Ownership / role rules ─────────────────────────────────────────────────
  // Only admins may pick a role / create privileged accounts; everyone else
  // (coach AND trial) may create students (role 'user') only, and owns them.
  // Only admins may create 'trial' (Trải nghiệm) accounts.
  const isAdmin = caller.role === 'admin'
  if (!isAdmin) role = 'user'
  if (!['user', 'coach', 'admin', 'trial'].includes(role)) role = 'user'
  const createdBy: string | null = isAdmin ? null : caller.id

  // Trial accounts start with a fresh 5-hour activation window.
  const trialFields = role === 'trial' ? freshTrialWindow() : {}

  // ── Welcome-email plan ─────────────────────────────────────────────────────
  // Send a welcome email when the address looks real (a bogus / placeholder
  // email means no send — "nếu email đó không tồn tại thì không gửi gì hết").
  // Staff (coach/admin) log in at /login with email+password, so they get NO
  // magic token. Athletes (user/trial) get a pre-minted passwordless magic
  // token so we can email them a ready-to-use login link; that token can also
  // be minted lazily later via /api/magic-link.
  const isStaffAccount = role === 'coach' || role === 'admin'
  const willEmail = looksLikeEmail(email)
  const magicToken = willEmail && !isStaffAccount ? generateMagicToken(full_name ?? email) : null

  // ── Step 1: Create auth user (bypasses signup restrictions) ───────────────
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name, role },
    email_confirm: true,
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  // ── Step 2: Explicitly write the profile row ───────────────────────────────
  // We upsert (not just insert) to handle the case where the Supabase DB
  // trigger has already auto-inserted the row. The .select().single() at the
  // end waits for the committed write before we respond, preventing the magic-
  // link route from racing against an uncommitted row.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id:         userId,
        email,
        full_name:  full_name ?? null,
        role,
        created_by: createdBy,
        ...(magicToken ? { magic_token: magicToken } : {}),
        ...trialFields,
      },
      { onConflict: 'id', ignoreDuplicates: false },
    )
    // Select '*' (not a fixed column list) so this keeps working before
    // migration 008 adds the trial_* columns. trialFields is empty unless the
    // admin explicitly created a 'trial' account, so non-trial creation never
    // references the new columns.
    .select('*')
    .single()

  if (profileError || !profile) {
    console.error('[POST /api/admin/users] Profile upsert failed:', profileError)
    return NextResponse.json(
      { error: profileError?.message ?? 'Không thể tạo hồ sơ học viên.' },
      { status: 500 },
    )
  }

  // ── Step 3: Send the welcome email (best-effort, never blocks creation) ─────
  // Staff get a login-page link + their email/temp-password; athletes get their
  // passwordless magic link. A failure here must NOT fail the request — the
  // account already exists. We surface the outcome in `emailed` for the UI.
  let emailed = false
  if (willEmail) {
    const origin = new URL(request.url).origin
    const { subject, html } = isStaffAccount
      ? buildStaffWelcomeEmail({
          fullName: full_name ?? null,
          email,
          password,
          loginUrl: `${origin}/login`,
          isAdmin:  role === 'admin',
        })
      : buildWelcomeEmail({
          fullName: full_name ?? null,
          loginUrl: `${origin}/p/${magicToken}`,
          siteUrl:  origin,
        })
    const result = await sendEmail({ to: email, subject, html })
    emailed = result.sent
    if (!result.sent && result.error) {
      console.error('[POST /api/admin/users] Welcome email failed:', result.error)
    }
  }

  // ── Step 4: Return the confirmed profile row ───────────────────────────────
  // The frontend adds this directly to the users list — the row is guaranteed
  // committed because .select().single() waited for the write to complete.
  return NextResponse.json({ profile, emailed }, { status: 201 })
}

/** GET /api/admin/users — list profiles (admins: all; coaches: their students) */
export async function GET() {
  let caller
  try {
    caller = await requireStaff()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabaseAdmin = buildAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Thiếu cấu hình môi trường hệ thống trên Server.' },
      { status: 500 },
    )
  }

  let query = supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  // Non-admins (coach / trial) only see students they created.
  if (caller.role !== 'admin') query = query.eq('created_by', caller.id)

  const { data: profiles, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ profiles })
}
