import { createAdminClient } from '@/lib/supabase/server'
import { resolveGuestToken } from '@/lib/guestToken'
import {
  encodeNotesWithMeta, extractSuggestionFromNotes, extractSurveyFromNotes,
} from '@/lib/sessionNotes'
import type { WorkoutSession } from '@/types'

// Columns added by migration 004 — may not exist on the live DB yet.
const MIGRATION_004_COLUMNS = [
  'survey_performance', 'survey_rir_feel', 'survey_recovery', 'next_week_suggestion',
] as const

function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42703') return true
  return MIGRATION_004_COLUMNS.some(c => err.message?.includes(c))
}

/** Normalise a session row: decode survey + suggestion from notes when the
 *  migration-004 columns are absent, so the client sees a consistent shape. */
function normaliseSession<T extends Partial<WorkoutSession>>(session: T): T {
  if (!session) return session
  if (session.next_week_suggestion == null) {
    const decoded = extractSuggestionFromNotes(session.notes)
    if (decoded) session.next_week_suggestion = decoded
  }
  if (session.survey_performance == null) {
    const sv = extractSurveyFromNotes(session.notes)
    if (sv) {
      session.survey_performance = sv.performance
      session.survey_rir_feel    = sv.rir_feel
      session.survey_recovery    = sv.recovery
    }
  }
  return session
}

/** GET /api/p/[token]/sessions/[sessionId] — fetch a session with all logged sets */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const userId = await resolveGuestToken(token)
  if (!userId) return Response.json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('workout_sessions')
    .select('*, sets:workout_sets(*, exercise:exercises(*))')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Buổi tập không tồn tại' }, { status: 404 })
  return Response.json({ session: normaliseSession(data as Partial<WorkoutSession>) })
}

/**
 * PATCH /api/p/[token]/sessions/[sessionId] — update session status / notes / survey.
 * Prefers migration-004 columns; falls back to encoding survey + suggestion into
 * the `notes` column when those columns don't exist on the live DB.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const userId = await resolveGuestToken(token)
  if (!userId) return Response.json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }, { status: 404 })

  const body = await request.json()
  const admin = createAdminClient()

  // ── Base columns (always exist) ────────────────────────────────────────────
  const base: Record<string, unknown> = {}
  if (body.status           !== undefined) base.status           = body.status
  if (body.notes            !== undefined) base.notes            = body.notes
  if (body.overall_rir      !== undefined) base.overall_rir      = body.overall_rir
  if (body.duration_minutes !== undefined) base.duration_minutes = body.duration_minutes

  // ── Migration-004 columns (preferred) ──────────────────────────────────────
  const meta: Record<string, unknown> = {}
  if (body.survey_performance   !== undefined) meta.survey_performance   = body.survey_performance
  if (body.survey_rir_feel      !== undefined) meta.survey_rir_feel      = body.survey_rir_feel
  if (body.survey_recovery      !== undefined) meta.survey_recovery      = body.survey_recovery
  if (body.next_week_suggestion !== undefined) meta.next_week_suggestion = body.next_week_suggestion

  // ── Attempt 1: write real columns ──────────────────────────────────────────
  let result = await admin
    .from('workout_sessions')
    .update({ ...base, ...meta })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select()
    .single()

  // ── Attempt 2: columns missing → encode meta into notes, retry safe ────────
  if (result.error && Object.keys(meta).length > 0 && isMissingColumnError(result.error)) {
    const fallbackNotes = encodeNotesWithMeta({
      userNotes:  (body.notes ?? null) as string | null,
      suggestion: (body.next_week_suggestion ?? null) as string | null,
      survey: {
        performance: body.survey_performance ?? undefined,
        rir_feel:    body.survey_rir_feel    ?? undefined,
        recovery:    body.survey_recovery    ?? undefined,
      },
    })
    result = await admin
      .from('workout_sessions')
      .update({ ...base, notes: fallbackNotes })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select()
      .single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ session: normaliseSession(result.data as Partial<WorkoutSession>) })
}
