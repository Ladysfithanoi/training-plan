import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
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

/**
 * Normalise a session row so the client always sees a consistent shape:
 * when migration-004 columns are absent (null), decode survey + suggestion
 * from the notes fallback encoding instead.
 */
function normaliseSession<T extends Partial<WorkoutSession>>(session: T): T {
  if (!session) return session
  const hasRealSuggestion = session.next_week_suggestion != null
  const hasRealSurvey     = session.survey_performance != null

  if (!hasRealSuggestion) {
    const decoded = extractSuggestionFromNotes(session.notes)
    if (decoded) session.next_week_suggestion = decoded
  }
  if (!hasRealSurvey) {
    const sv = extractSurveyFromNotes(session.notes)
    if (sv) {
      session.survey_performance = sv.performance
      session.survey_rir_feel    = sv.rir_feel
      session.survey_recovery    = sv.recovery
    }
  }
  return session
}

// ── Ownership guard ────────────────────────────────────────────────────────────
async function guardSession(sessionId: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('workout_sessions')
    .select('id, user_id, phase_id')
    .eq('id', sessionId)
    .eq('user_id', profile.id)
    .maybeSingle()

  return { profile, supabase, session }
}

/**
 * GET /api/coach/sessions/[sessionId]
 * Fetch a session with all its logged sets (for "continue" flow).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  let guard
  try { guard = await guardSession(sessionId) } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!guard.session) return Response.json({ error: 'Buổi tập không tồn tại' }, { status: 404 })

  const { data, error } = await guard.supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(*, exercise:exercises(*))')
    .eq('id', sessionId)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ session: normaliseSession(data as Partial<WorkoutSession>) })
}

/**
 * PATCH /api/coach/sessions/[sessionId]
 * Update session status, notes, survey answers, autoregulation suggestion.
 *
 * Prefers the dedicated migration-004 columns. If those columns don't exist
 * yet (live DB on the base schema), it gracefully retries with survey +
 * suggestion encoded into the `notes` column so nothing is lost.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  let guard
  try { guard = await guardSession(sessionId) } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!guard.session) return Response.json({ error: 'Buổi tập không tồn tại' }, { status: 404 })

  const body = await request.json().catch(() => ({}))

  // ── Base columns (always exist) ────────────────────────────────────────────
  const base: Record<string, unknown> = {}
  if (body.status           !== undefined) base.status           = body.status
  if (body.notes            !== undefined) base.notes            = body.notes
  if (body.overall_rir      !== undefined) base.overall_rir      = body.overall_rir
  if (body.duration_minutes !== undefined) base.duration_minutes = body.duration_minutes
  if (body.session_date     !== undefined) base.session_date     = body.session_date

  // ── Migration-004 columns (preferred) ──────────────────────────────────────
  const meta: Record<string, unknown> = {}
  if (body.survey_performance   !== undefined) meta.survey_performance   = body.survey_performance
  if (body.survey_rir_feel      !== undefined) meta.survey_rir_feel      = body.survey_rir_feel
  if (body.survey_recovery      !== undefined) meta.survey_recovery      = body.survey_recovery
  if (body.next_week_suggestion !== undefined) meta.next_week_suggestion = body.next_week_suggestion

  // ── Attempt 1: write real columns ──────────────────────────────────────────
  let result = await guard.supabase
    .from('workout_sessions')
    .update({ ...base, ...meta })
    .eq('id', sessionId)
    .eq('user_id', guard.profile.id)
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
    result = await guard.supabase
      .from('workout_sessions')
      .update({ ...base, notes: fallbackNotes })
      .eq('id', sessionId)
      .eq('user_id', guard.profile.id)
      .select()
      .single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ session: normaliseSession(result.data as Partial<WorkoutSession>) })
}

/**
 * DELETE /api/coach/sessions/[sessionId]
 * Hard-delete a session and all its logged sets (cascade in DB).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  let guard
  try { guard = await guardSession(sessionId) } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!guard.session) return Response.json({ error: 'Buổi tập không tồn tại' }, { status: 404 })

  const { error } = await guard.supabase
    .from('workout_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', guard.profile.id)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ ok: true })
}
