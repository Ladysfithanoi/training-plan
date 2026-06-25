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
 * Builds the "your account is ready" welcome email: a friendly note telling the
 * athlete an account was created for them, plus their passwordless magic link
 * (the de-facto login link in this app — open it and you're in, no password).
 */
export function buildWelcomeEmail(opts: {
  fullName: string | null
  loginUrl: string
  siteUrl: string
}): { subject: string; html: string } {
  const name = opts.fullName?.trim() || 'bạn'
  const subject = `Tài khoản ${BRAND} của bạn đã sẵn sàng`

  const html = `
  <div style="margin:0;padding:24px;background:#f5f5f0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e3da;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5b7d5b;font-weight:600;">${BRAND}</p>
          <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#1c1c1a;">Chào ${escapeHtml(name)}, tài khoản của bạn đã được tạo 🎉</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 32px 0;font-size:15px;line-height:1.65;color:#3a3a35;">
          <p style="margin:0 0 16px;">Huấn luyện viên của bạn vừa tạo một tài khoản trên hệ thống <strong>${BRAND}</strong> để bạn theo dõi giáo án và ghi lại từng buổi tập.</p>
          <p style="margin:0 0 22px;">Bấm nút bên dưới để truy cập ngay — <strong>không cần mật khẩu</strong>, link này đã đăng nhập sẵn cho bạn:</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 8px;">
          <a href="${opts.loginUrl}" style="display:inline-block;background:#5b7d5b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Mở giáo án của tôi →</a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 32px 0;font-size:13px;line-height:1.6;color:#6b6b63;">
          <p style="margin:0 0 6px;">Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:</p>
          <p style="margin:0;word-break:break-all;"><a href="${opts.loginUrl}" style="color:#5b7d5b;">${opts.loginUrl}</a></p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 28px;border-top:1px solid #eeeee7;margin-top:16px;">
          <p style="margin:18px 0 0;font-size:12px;color:#9a9a90;">Bạn nhận được email này vì có người đã tạo tài khoản cho bạn tại <a href="${opts.siteUrl}" style="color:#9a9a90;">${stripScheme(opts.siteUrl)}</a>. Nếu bạn không mong đợi email này, có thể bỏ qua nó.</p>
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
