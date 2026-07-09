// Route-local import — do NOT use the shared lib helper here.
// Importing from '@/lib/supabase/server' can cause Next.js to tree-shake or
// bundle this module into a context where SUPABASE_SERVICE_ROLE_KEY is scrubbed.
// Reading the env vars and constructing the client directly inside this file
// guarantees they are evaluated in the Node.js API-route runtime.
import { randomInt } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth'
import { pendingTrialWindow } from '@/lib/trial'
import { generateMagicToken } from '@/lib/guestToken'
import { sendEmail, buildStaffWelcomeEmail, looksLikeEmail } from '@/lib/email'

// ── Random password generator (server-only) ──────────────────────────────────
// Staff-side accounts (HLV / Quản trị / Trải nghiệm) get an auto-generated
// password that is emailed to them, so the admin never has to invent one.
// Excludes visually ambiguous characters (0/O, 1/l/I) and guarantees at least
// one upper, one lower and one digit.
function generatePassword(length = 12): string {
  const upper  = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const lower  = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const all    = upper + lower + digits
  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [pick(upper), pick(lower), pick(digits)]
  while (chars.length < length) chars.push(pick(all))
  // Fisher–Yates shuffle so the guaranteed chars aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

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
  let email: string, bodyPassword: string | undefined, full_name: string | undefined, role: string
  try {
    const body = await request.json()
    email        = body.email
    bodyPassword = body.password
    full_name    = body.full_name
    role         = body.role ?? 'user'
  } catch {
    return NextResponse.json(
      { error: 'Yêu cầu không hợp lệ — body phải là JSON' },
      { status: 400 },
    )
  }

  if (!email) {
    return NextResponse.json(
      { error: 'email là bắt buộc' },
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

  // ── Password ───────────────────────────────────────────────────────────────
  // Staff-side accounts (HLV / Quản trị / Trải nghiệm) get an auto-generated
  // password (emailed to them). Students keep the coach-provided temporary
  // password — they don't get an email and sign in via the magic link.
  const isStaffAccount = role === 'coach' || role === 'admin' || role === 'trial'
  const password = isStaffAccount ? generatePassword() : (bodyPassword ?? '')
  if (!password) {
    return NextResponse.json(
      { error: 'Mật khẩu là bắt buộc' },
      { status: 400 },
    )
  }

  // Trial accounts start switched ON but with the 5-hour clock NOT yet running.
  // The window begins counting from the tester's FIRST login (see
  // /api/auth/login), so preparing the account in advance doesn't burn the time.
  const trialFields = role === 'trial' ? pendingTrialWindow() : {}

  // ── Welcome-email plan ─────────────────────────────────────────────────────
  // Only staff-side accounts (HLV / Quản trị / Trải nghiệm) receive a welcome
  // email — and only when the address looks real. Students get NO email (their
  // coach shares the magic link manually via "Gửi link"). Staff log in at
  // /login with email+password. Students still get a pre-minted magic token so
  // that "Gửi link" is instant; it can also be minted lazily via /api/magic-link.
  const willEmail = isStaffAccount && looksLikeEmail(email)
  const magicToken = role === 'user' ? generateMagicToken(full_name ?? email) : null

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
  // Staff-side accounts get a login-page link + their email/auto-password with
  // sign-in instructions. A failure here must NOT fail the request — the account
  // already exists. We surface the outcome in `emailed` for the UI.
  let emailed = false
  if (willEmail) {
    const origin = new URL(request.url).origin
    const roleLabel =
      role === 'admin' ? 'Quản trị viên' : role === 'coach' ? 'Huấn luyện viên' : 'Trải nghiệm'
    const { subject, html } = buildStaffWelcomeEmail({
      fullName: full_name ?? null,
      email,
      password,
      loginUrl: `${origin}/login`,
      roleLabel,
    })
    const result = await sendEmail({ to: email, subject, html })
    emailed = result.sent
    if (!result.sent && result.error) {
      console.error('[POST /api/admin/users] Welcome email failed:', result.error)
    }
  }

  // ── Step 4: Return the confirmed profile row ───────────────────────────────
  // The frontend adds this directly to the users list — the row is guaranteed
  // committed because .select().single() waited for the write to complete. For
  // staff-side accounts we also return the auto-generated password so the admin
  // has it as a backup (and can relay it if the email couldn't be sent).
  return NextResponse.json(
    { profile, emailed, ...(isStaffAccount ? { password } : {}) },
    { status: 201 },
  )
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
