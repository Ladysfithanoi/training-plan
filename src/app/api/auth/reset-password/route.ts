import { createAdminClient } from '@/lib/supabase/server'
import { verifyResetToken } from '@/lib/resetToken'

/**
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 *
 * Completes a password reset: validates the signed token from the emailed link,
 * then sets the account's new password via the Admin Auth API. Public (no
 * session) — the token itself is the proof of identity.
 */
export async function POST(request: Request) {
  let token: string, password: string
  try {
    const body = await request.json()
    token = String(body.token ?? '')
    password = String(body.password ?? '')
  } catch {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 400 })
  }

  if (password.length < 8) {
    return Response.json({ error: 'Mật khẩu mới phải có tối thiểu 8 ký tự.' }, { status: 400 })
  }

  const verified = verifyResetToken(token)
  if (!verified) {
    return Response.json(
      { error: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu lại.' },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(verified.userId, { password })
    if (error) {
      console.error('[reset-password] updateUserById failed:', error)
      return Response.json({ error: 'Không thể đặt lại mật khẩu. Vui lòng thử lại.' }, { status: 500 })
    }
  } catch (err) {
    console.error('[reset-password] Unexpected error:', err)
    return Response.json({ error: 'Không thể đặt lại mật khẩu. Vui lòng thử lại.' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
