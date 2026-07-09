// Server-only email helper built directly on Resend's HTTP API — no SDK
// dependency, so it adds nothing to the bundle and runs in any Node API route.
//
// Sending is intentionally best-effort: every caller must treat a failed or
// skipped send as a non-event and never let it break the main flow (e.g. an
// account is still created even if the welcome email can't go out). When
// RESEND_API_KEY / EMAIL_FROM are unset (local dev, preview) every call is a
// silent no-op.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** App / brand name used in subject lines and email chrome. */
const BRAND = 'Kế hoạch Tập luyện'

/**
 * Loose email-format check — enough to skip obvious placeholders so we don't
 * fire off (and pay for) sends to addresses that clearly aren't real mailboxes.
 * We can't verify a mailbox actually exists; Resend simply bounces if it doesn't.
 */
export function looksLikeEmail(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

type SendResult = { sent: boolean; skipped?: string; error?: string }

/** Low-level send. Returns a result object instead of throwing. */
export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.EMAIL_FROM

  // Not configured → quietly do nothing. Keeps dev/preview from erroring.
  if (!apiKey || !from) return { sent: false, skipped: 'email-not-configured' }
  // Bogus / placeholder recipient → skip ("Nếu email đó không tồn tại thì
  // không gửi gì hết, đỡ phải lọc").
  if (!looksLikeEmail(opts.to)) return { sent: false, skipped: 'invalid-recipient' }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[sendEmail] Resend rejected:', res.status, detail)
      return { sent: false, error: `resend-${res.status}` }
    }
    return { sent: true }
  } catch (err) {
    console.error('[sendEmail] Network error:', err)
    return { sent: false, error: 'network' }
  }
}

/**
 * Builds the welcome email for a STAFF-side account (coach / admin / trial).
 * These accounts log in at the real login page with email + password. The email
 * carries the login URL, their email (login id) and the auto-generated password,
 * with a nudge to change it after first sign-in. `roleLabel` is the Vietnamese
 * label shown in the subject/heading (e.g. "Huấn luyện viên", "Trải nghiệm").
 */
export function buildStaffWelcomeEmail(opts: {
  fullName: string | null
  email: string
  password: string
  loginUrl: string
  roleLabel: string
}): { subject: string; html: string } {
  const name = opts.fullName?.trim() || 'bạn'
  const roleLabel = opts.roleLabel
  const subject = `Tài khoản ${roleLabel} ${BRAND} của bạn đã sẵn sàng`

  const html = `
  <div style="margin:0;padding:24px;background:#f5f5f0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e3da;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5b7d5b;font-weight:600;">${BRAND}</p>
          <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#1c1c1a;">Chào ${escapeHtml(name)}, bạn đã được thêm làm ${roleLabel} 🎉</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 32px 0;font-size:15px;line-height:1.65;color:#3a3a35;">
          <p style="margin:0 0 16px;">Một tài khoản <strong>${escapeHtml(roleLabel)}</strong> trên hệ thống <strong>${BRAND}</strong> vừa được tạo cho bạn. Đăng nhập bằng thông tin bên dưới để bắt đầu quản lý học viên và giáo án.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f3;border:1px solid #e3e7d6;border-radius:10px;">
            <tr><td style="padding:14px 18px;font-size:14px;color:#3a3a35;">
              <p style="margin:0 0 6px;"><span style="color:#6b6b63;">Email đăng nhập:</span> <strong>${escapeHtml(opts.email)}</strong></p>
              <p style="margin:0;"><span style="color:#6b6b63;">Mật khẩu tạm:</span> <strong style="font-family:'Courier New',monospace;">${escapeHtml(opts.password)}</strong></p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 32px 8px;">
          <a href="${opts.loginUrl}" style="display:inline-block;background:#5b7d5b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Đăng nhập ngay →</a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 32px 0;font-size:13px;line-height:1.6;color:#6b6b63;">
          <p style="margin:0 0 6px;">Hoặc mở liên kết: <a href="${opts.loginUrl}" style="color:#5b7d5b;word-break:break-all;">${opts.loginUrl}</a></p>
          <p style="margin:10px 0 0;">Vì lý do bảo mật, hãy <strong>đổi mật khẩu</strong> sau lần đăng nhập đầu tiên (mở menu tài khoản ở chân thanh điều hướng bên trái → “Đổi mật khẩu”).</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 28px;border-top:1px solid #eeeee7;">
          <p style="margin:18px 0 0;font-size:12px;color:#9a9a90;">Bạn nhận được email này vì có người đã tạo tài khoản ${escapeHtml(roleLabel.toLowerCase())} cho bạn tại <a href="${stripScheme(opts.loginUrl).replace(/\/login$/, '')}" style="color:#9a9a90;">${stripScheme(opts.loginUrl).replace(/\/login$/, '')}</a>. Nếu bạn không mong đợi email này, có thể bỏ qua nó.</p>
        </td>
      </tr>
    </table>
  </div>`

  return { subject, html }
}

/** Minimal HTML-escape for interpolated user text (names). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Drops the protocol for nicer display (https://x.com → x.com). */
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
