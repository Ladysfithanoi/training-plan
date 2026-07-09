import { createAdminClient } from '@/lib/supabase/server'
import { signResetToken } from '@/lib/resetToken'
import { sendEmail, buildPasswordResetEmail, looksLikeEmail } from '@/lib/email'

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Sends a password-reset link to the account's email. Public (no session) —
 * reached from the "Quên mật khẩu?" link on the login page.
 *
 * Per product choice this endpoint gives explicit feedback (a small internal
 * coaching tool where UX clarity matters more than hiding which emails are
 * registered): a 404 when no account matches, so the user knows they mistyped.
 */
export async function POST(request: Request) {
  let email: string
  try {
    const body = await request.json()
    email = String(body.email ?? '').trim().toLowerCase()
  } catch {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 400 })
  }

  if (!looksLikeEmail(email)) {
    return Response.json({ error: 'Vui lòng nhập địa chỉ email hợp lệ.' }, { status: 400 })
  }

  // Look up the account by email (service-role bypasses RLS).
  let profile: { id: string; email: string | null; full_name: string | null } | null
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .eq('email', email)
      .maybeSingle()
    profile = data
  } catch (err) {
    console.error('[forgot-password] Lookup failed:', err)
    return Response.json({ error: 'Lỗi hệ thống. Vui lòng thử lại sau.' }, { status: 500 })
  }

  // No account with this email → tell the user plainly.
  if (!profile?.id || !profile.email) {
    return Response.json(
      { error: 'Email này chưa có tài khoản trong hệ thống. Vui lòng kiểm tra lại.' },
      { status: 404 },
    )
  }

  // Send the reset link.
  const origin = new URL(request.url).origin
  const token = signResetToken(profile.id, profile.email)
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`
  const { subject, html } = buildPasswordResetEmail({
    fullName: profile.full_name ?? null,
    resetUrl,
  })
  const result = await sendEmail({ to: profile.email, subject, html })

  if (!result.sent) {
    console.error('[forgot-password] Reset email not sent:', result.skipped ?? result.error)
    return Response.json(
      { error: 'Không gửi được email. Vui lòng liên hệ quản trị viên hoặc thử lại sau.' },
      { status: 502 },
    )
  }

  return Response.json({ ok: true })
}
