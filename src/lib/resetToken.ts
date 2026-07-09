// Stateless, signed password-reset tokens — server-only.
//
// A reset link must prove "the person holding this link asked to reset THIS
// account, recently" without us storing anything in the DB (keeps the flow
// migration-free, consistent with the app deploying from main). We do that with
// an HMAC-SHA256 signature over a small payload {userId, email, exp}, keyed by
// the service-role key (a secret only the server knows). Tamper with any field
// and the signature no longer matches; wait too long and `exp` fails.
//
// Trade-off: the token stays valid until it expires (it is not single-use),
// so we keep the window short (1 hour). Good enough for a small coaching app;
// if single-use is ever required, store a nonce on the profile and check it.

import { createHmac, timingSafeEqual } from 'crypto'

const TTL_MS = 60 * 60 * 1000 // 1 hour

type Payload = { u: string; e: string; x: number }

/** The signing secret. Server-only; never sent to the browser. */
function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — cannot sign reset tokens.')
  return key
}

function sign(dataB64: string): string {
  return createHmac('sha256', secret()).update(dataB64).digest('base64url')
}

/** Mints a reset token for a user. `${payload}.${signature}`, both base64url. */
export function signResetToken(userId: string, email: string): string {
  const payload: Payload = { u: userId, e: email, x: Date.now() + TTL_MS }
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${dataB64}.${sign(dataB64)}`
}

/**
 * Verifies a reset token. Returns { userId, email } when the signature is valid
 * and the token hasn't expired; otherwise null. Never throws on bad input.
 */
export function verifyResetToken(token: string | null | undefined): { userId: string; email: string } | null {
  if (!token || typeof token !== 'string') return null
  const [dataB64, sig] = token.split('.')
  if (!dataB64 || !sig) return null

  try {
    // Constant-time signature compare (guard against length-mismatch throw).
    const expected = sign(dataB64)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8')) as Payload
    if (!payload?.u || !payload?.e || typeof payload.x !== 'number') return null
    if (Date.now() > payload.x) return null // expired

    return { userId: payload.u, email: payload.e }
  } catch {
    return null
  }
}
