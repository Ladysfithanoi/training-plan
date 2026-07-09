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
 * Security: always responds { ok: true } regardless of whether the email
 * belongs to a real account, so the endpoint can't be used to probe which
 * addresses are registered. The actual email only goes out when a matching
 * profile with a valid address exists.
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

  // Look up the account by email (service-role bypasses RLS). Failures here are
  // swallowed into the generic success below so we never leak account existence.
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .eq('email', email)
      .maybeSingle()

    if (profile?.id && profile.email) {
      const origin = new URL(request.url).origin
      const token = signResetToken(profile.id, profile.email)
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`
      const { subject, html } = buildPasswordResetEmail({
        fullName: profile.full_name ?? null,
        resetUrl,
      })
      const result = await sendEmail({ to: profile.email, subject, html })
      if (!result.sent && result.error) {
        console.error('[forgot-password] Reset email failed:', result.error)
      }
    }
  } catch (err) {
    console.error('[forgot-password] Unexpected error:', err)
  }

  // Uniform response — do not reveal whether the address exists.
  return Response.json({ ok: true })
}
