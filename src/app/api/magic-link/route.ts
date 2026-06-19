// Route-local client initialization — do NOT import createAdminClient from
// '@/lib/supabase/server' here. That shared helper can be tree-shaken into a
// bundle context where Next.js scrubs SUPABASE_SERVICE_ROLE_KEY for security.
// Reading env vars and building the client inline guarantees Node.js runtime
// evaluation on every request.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth'
import { generateMagicToken } from '@/lib/guestToken'

/**
 * POST /api/magic-link
 * Body: { user_id: string, force?: boolean }
 *
 * Generates (or retrieves) a shareable magic token for the given athlete.
 * The same token is returned on repeat calls. Pass force:true to regenerate.
 * Only admins may call this endpoint.
 */
export async function POST(request: Request) {
  // ── Staff auth check ───────────────────────────────────────────────────────
  let caller
  try {
    caller = await requireStaff()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let user_id: string, force: boolean
  try {
    const body = await request.json()
    user_id = body.user_id
    force   = body.force ?? false
  } catch {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ — body phải là JSON' }, { status: 400 })
  }

  if (!user_id) {
    return NextResponse.json({ error: 'user_id là bắt buộc' }, { status: 400 })
  }

  // ── Build admin client (service-role key, localized) ───────────────────────
  const supabaseUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[POST /api/magic-link] Missing env vars:', {
      supabaseUrl: !!supabaseUrl,
      supabaseServiceKey: !!supabaseServiceKey,
    })
    return NextResponse.json(
      { error: 'Thiếu cấu hình môi trường hệ thống trên Server.' },
      { status: 500 },
    )
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken:   false,
      persistSession:     false,
      detectSessionInUrl: false,
    },
  })

  // ── Step 1: Look up the athlete's profile row ──────────────────────────────
  let { data: profile, error: profileFetchError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, magic_token, created_by')
    .eq('id', user_id)
    .maybeSingle()

  // ── Step 2: If not found yet, fetch from Auth and write the profile row ────
  // This handles a race condition where the DB trigger that auto-inserts the
  // profile row hasn't committed by the time this request arrives, or where
  // the trigger doesn't exist on the database.
  if (!profile && !profileFetchError) {
    console.warn('[POST /api/magic-link] Profile not found — fetching from Auth and inserting.')

    const { data: authUser, error: authFetchError } = await supabaseAdmin.auth.admin.getUserById(user_id)

    if (authFetchError || !authUser?.user) {
      return NextResponse.json(
        { error: 'Học viên không tồn tại trong hệ thống xác thực.' },
        { status: 404 },
      )
    }

    const u = authUser.user
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id:        u.id,
          email:     u.email ?? '',
          full_name: u.user_metadata?.full_name ?? null,
          role:      u.user_metadata?.role ?? 'user',
        },
        { onConflict: 'id' },
      )
      .select('id, full_name, email, magic_token, created_by')
      .single()

    if (insertError || !inserted) {
      console.error('[POST /api/magic-link] Profile upsert failed:', insertError)
      return NextResponse.json(
        { error: insertError?.message ?? 'Không thể tạo hồ sơ học viên.' },
        { status: 500 },
      )
    }

    profile = inserted
  }

  // Surface any unexpected query error from the initial fetch
  if (profileFetchError) {
    console.error('[POST /api/magic-link] Profile query error:', profileFetchError)
    return NextResponse.json({ error: profileFetchError.message }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'Học viên không tồn tại.' }, { status: 404 })
  }

  // ── Coach ownership guard ──────────────────────────────────────────────────
  // This route uses the service-role client (bypasses RLS); coaches may only
  // generate links for students they created.
  if (caller.role !== 'admin' && profile.created_by !== caller.id) {
    return NextResponse.json(
      { error: 'Bạn chỉ có thể tạo liên kết cho học viên của mình.' },
      { status: 403 },
    )
  }

  // ── Step 3: Generate token if missing or force-refresh requested ───────────
  let token: string = profile.magic_token ?? ''

  if (!token || force) {
    token = generateMagicToken(profile.full_name ?? profile.email)

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ magic_token: token })
      .eq('id', user_id)

    if (updateError) {
      console.error('[POST /api/magic-link] Token write failed:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  // ── Step 4: Return the shareable URL ──────────────────────────────────────
  const origin = new URL(request.url).origin
  return NextResponse.json({ token, url: `${origin}/p/${token}` }, { status: 201 })
}

/**
 * DELETE /api/magic-link
 * Body: { user_id: string }
 *
 * Revokes the athlete's shareable link by clearing their magic_token. The old
 * URL stops resolving immediately (resolveGuestToken → null → 404). A brand-new
 * token can be issued later via POST. Only admins, or the coach who created the
 * student, may call this endpoint.
 */
export async function DELETE(request: Request) {
  // ── Staff auth check ───────────────────────────────────────────────────────
  let caller
  try {
    caller = await requireStaff()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let user_id: string
  try {
    const body = await request.json()
    user_id = body.user_id
  } catch {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ — body phải là JSON' }, { status: 400 })
  }

  if (!user_id) {
    return NextResponse.json({ error: 'user_id là bắt buộc' }, { status: 400 })
  }

  // ── Build admin client (service-role key, localized) ───────────────────────
  const supabaseUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[DELETE /api/magic-link] Missing env vars:', {
      supabaseUrl: !!supabaseUrl,
      supabaseServiceKey: !!supabaseServiceKey,
    })
    return NextResponse.json(
      { error: 'Thiếu cấu hình môi trường hệ thống trên Server.' },
      { status: 500 },
    )
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken:   false,
      persistSession:     false,
      detectSessionInUrl: false,
    },
  })

  // ── Coach ownership guard ──────────────────────────────────────────────────
  // This route uses the service-role client (bypasses RLS); coaches may only
  // revoke links for students they created.
  const { data: profile, error: profileFetchError } = await supabaseAdmin
    .from('profiles')
    .select('id, created_by')
    .eq('id', user_id)
    .maybeSingle()

  if (profileFetchError) {
    console.error('[DELETE /api/magic-link] Profile query error:', profileFetchError)
    return NextResponse.json({ error: profileFetchError.message }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'Học viên không tồn tại.' }, { status: 404 })
  }

  if (caller.role !== 'admin' && profile.created_by !== caller.id) {
    return NextResponse.json(
      { error: 'Bạn chỉ có thể thu hồi liên kết của học viên của mình.' },
      { status: 403 },
    )
  }

  // ── Clear the token ────────────────────────────────────────────────────────
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ magic_token: null })
    .eq('id', user_id)

  if (updateError) {
    console.error('[DELETE /api/magic-link] Token clear failed:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ revoked: true }, { status: 200 })
}
