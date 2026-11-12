/**
 * Gemini client with API-key rotation — SERVER ONLY (reads the keys with the
 * service-role client; never import this from a client component).
 *
 * Keys live in the `gemini_api_keys` table (migration 015). Each call takes the
 * active key that was used longest ago (round-robin). When Google answers
 * "quota exceeded" or rejects the key, that key is put on a cooldown and the
 * next one is tried, so one exhausted key never blocks the feature.
 *
 * Uses the Interactions API (the endpoint Google recommends for new projects):
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 */

import { createAdminClient } from '@/lib/supabase/server'

const ENDPOINT     = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const API_REVISION = '2026-05-20'

/** Override with the GEMINI_MODEL env var (e.g. when Google retires this one). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

/** How long a key is skipped after each kind of failure. */
const COOLDOWN_RATE_LIMIT_MS  = 90 * 1000            // per-minute limit
const COOLDOWN_DAILY_QUOTA_MS = 6 * 60 * 60 * 1000   // per-day quota
const COOLDOWN_REJECTED_MS    = 60 * 60 * 1000       // invalid / unauthorised key

const PER_ATTEMPT_TIMEOUT_MS = 45_000
/** Don't start another attempt with less than this left before the deadline. */
const MIN_TIME_FOR_ATTEMPT_MS = 8_000

/** An error whose message is safe (and meant) to be shown to the coach. */
export class GeminiError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

interface KeyRow {
  id:             string
  label:          string | null
  api_key:        string
  use_count:      number | null
  cooldown_until: string | null
}

interface GenerateOptions {
  system: string
  prompt: string
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>
  /** Total time budget across all key attempts. */
  budgetMs?: number
}

/** Pull a readable message out of an error response body. */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    const msg = parsed.error?.message ?? parsed.message
    if (msg) return msg.slice(0, 300)
  } catch { /* not JSON — fall through */ }
  return body.slice(0, 300)
}

/** The generated text of a completed interaction. */
function outputText(data: unknown): string {
  const steps = (data as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return ''
  const parts: string[] = []
  for (const step of steps as { type?: string; content?: unknown }[]) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue
    for (const item of step.content as { type?: string; text?: unknown }[]) {
      if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    }
  }
  return parts.join('')
}

/**
 * Ask Gemini for a JSON answer matching `schema`, rotating through the stored
 * API keys. Resolves to the parsed JSON; throws GeminiError otherwise.
 */
export async function generateGeminiJson(opts: GenerateOptions): Promise<unknown> {
  const deadline = Date.now() + (opts.budgetMs ?? 55_000)
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
  const db = createAdminClient()

  const { data, error } = await db
    .from('gemini_api_keys')
    .select('id, label, api_key, use_count, cooldown_until')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })

  if (error) {
    console.error('[gemini] cannot read gemini_api_keys:', error)
    throw new GeminiError(
      'Chưa đọc được bảng gemini_api_keys. Hãy chạy migration 015_add_gemini_api_keys.sql ' +
      'trong Supabase SQL editor rồi thêm API key Gemini vào bảng đó.',
      503,
    )
  }

  const keys = (data ?? []) as KeyRow[]
  if (keys.length === 0) {
    throw new GeminiError(
      'Chưa có API key Gemini nào đang bật. Thêm key vào bảng gemini_api_keys trong Supabase.',
      503,
    )
  }

  const now = Date.now()
  const ready = keys.filter(k => !k.cooldown_until || new Date(k.cooldown_until).getTime() <= now)
  if (ready.length === 0) {
    const soonest = Math.min(...keys.map(k => new Date(k.cooldown_until as string).getTime()))
    const minutes = Math.max(1, Math.ceil((soonest - now) / 60_000))
    throw new GeminiError(
      `Tất cả API key Gemini đều đang hết hạn mức. Thử lại sau khoảng ${minutes} phút.`,
      429,
    )
  }

  let lastProblem = ''
  let allRateLimited = true

  for (const key of ready) {
    const remaining = deadline - Date.now()
    if (remaining < MIN_TIME_FOR_ATTEMPT_MS) break

    const name = key.label || key.id.slice(0, 8)

    // Stamp the key BEFORE the call so a concurrent request picks another one.
    await db
      .from('gemini_api_keys')
      .update({ last_used_at: new Date().toISOString(), use_count: (key.use_count ?? 0) + 1 })
      .eq('id', key.id)

    const park = (ms: number, reason: string) =>
      db
        .from('gemini_api_keys')
        .update({ cooldown_until: new Date(Date.now() + ms).toISOString(), last_error: reason.slice(0, 500) })
        .eq('id', key.id)

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-goog-api-key': key.api_key,
          'Api-Revision':   API_REVISION,
        },
        body: JSON.stringify({
          model,
          input:              opts.prompt,
          system_instruction: opts.system,
          generation_config:  { thinking_level: 'low', max_output_tokens: 16000 },
          response_format:    { type: 'text', mime_type: 'application/json', schema: opts.schema },
          // Nothing to continue later — don't keep the conversation on Google's side.
          store: false,
        }),
        signal: AbortSignal.timeout(Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining - 2_000)),
      })
    } catch (err) {
      // Timeout or network failure — not this key's fault, just try the next.
      allRateLimited = false
      lastProblem = err instanceof Error && err.name === 'TimeoutError'
        ? 'Gemini phản hồi quá chậm'
        : 'không kết nối được tới Gemini'
      console.error(`[gemini] key "${name}" request failed:`, err)
      continue
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const message = errorMessage(bodyText)
      console.error(`[gemini] key "${name}" HTTP ${res.status}: ${message}`)

      if (res.status === 429) {
        const daily = /per day|daily|PerDay/i.test(bodyText)
        await park(daily ? COOLDOWN_DAILY_QUOTA_MS : COOLDOWN_RATE_LIMIT_MS, `429: ${message}`)
        lastProblem = 'hết hạn mức'
        continue
      }

      allRateLimited = false

      const keyRejected = res.status === 401 || res.status === 403 ||
        (res.status === 400 && /api[ _-]?key/i.test(bodyText))
      if (keyRejected) {
        await park(COOLDOWN_REJECTED_MS, `${res.status}: ${message}`)
        lastProblem = `key "${name}" bị từ chối`
        continue
      }

      if (res.status === 404) {
        throw new GeminiError(
          `Gemini không nhận model "${model}". Đặt biến môi trường GEMINI_MODEL sang một model còn dùng được.`,
        )
      }

      if (res.status >= 500) {
        lastProblem = `Gemini đang lỗi (${res.status})`
        continue
      }

      // Any other 4xx is a problem with the request itself — another key won't help.
      throw new GeminiError(`Gemini từ chối yêu cầu: ${message}`)
    }

    // ── Success path ──────────────────────────────────────────────────────────
    const payload: unknown = await res.json().catch(() => null)
    const status = (payload as { status?: string } | null)?.status
    if (!payload || status !== 'completed') {
      console.error(`[gemini] key "${name}" interaction status:`, status)
      throw new GeminiError(
        status === 'incomplete'
          ? 'AI trả lời chưa trọn vẹn (khối tập quá dài). Hãy giảm số meso hoặc số buổi rồi thử lại.'
          : 'AI không trả về kết quả. Vui lòng thử lại.',
      )
    }

    const text = outputText(payload).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      return JSON.parse(text)
    } catch {
      console.error(`[gemini] key "${name}" returned non-JSON output:`, text.slice(0, 300))
      throw new GeminiError('AI trả về dữ liệu không đúng định dạng. Vui lòng thử lại.')
    }
  }

  if (allRateLimited && lastProblem) {
    throw new GeminiError('Tất cả API key Gemini đều đang hết hạn mức. Vui lòng thử lại sau ít phút.', 429)
  }
  throw new GeminiError(
    `Không gọi được Gemini${lastProblem ? ` (${lastProblem})` : ''}. Vui lòng thử lại.`,
    lastProblem.startsWith('Gemini phản hồi quá chậm') ? 504 : 502,
  )
}
