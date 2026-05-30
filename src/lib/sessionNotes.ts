/**
 * Session meta encoding helpers
 * ─────────────────────────────
 * Migration 004 adds dedicated columns to `workout_sessions`:
 *   survey_performance, survey_rir_feel, survey_recovery, next_week_suggestion
 *
 * Until that migration is deployed, the coach training view still needs the
 * autoregulation survey + recommendation to survive a refresh. As a transitional
 * fallback we encode them as ASCII-marked lines inside the existing `notes`
 * TEXT column. ASCII markers (not emoji) avoid surrogate-pair round-trip issues.
 *
 * Once migration 004 is live, real columns take priority and notes stays clean —
 * the API only falls back to this encoding when the real columns are missing.
 */

import type {
  SessionSurvey, SurveyPerformance, SurveyRirFeel, SurveyRecovery,
} from '@/types'

export const NOTE_SUGGESTION_PREFIX = '##SUGGESTION## '
export const NOTE_SURVEY_PREFIX     = '##SURVEY## '

/** True for any line that carries encoded meta (not user-authored note text). */
function isMetaLine(line: string): boolean {
  return line.includes(NOTE_SUGGESTION_PREFIX) || line.includes(NOTE_SURVEY_PREFIX)
}

/** Pull the recommendation string out of a notes blob, ignoring position/encoding. */
export function extractSuggestionFromNotes(notes: string | null | undefined): string {
  if (!notes) return ''
  for (const line of notes.split('\n')) {
    const idx = line.indexOf(NOTE_SUGGESTION_PREFIX)
    if (idx >= 0) return line.slice(idx + NOTE_SUGGESTION_PREFIX.length).trim()
  }
  return ''
}

/** Pull the survey triple out of a notes blob. Returns null if not all three present. */
export function extractSurveyFromNotes(notes: string | null | undefined): SessionSurvey | null {
  if (!notes) return null
  for (const line of notes.split('\n')) {
    const idx = line.indexOf(NOTE_SURVEY_PREFIX)
    if (idx < 0) continue
    const [perf, rir, rec] = line.slice(idx + NOTE_SURVEY_PREFIX.length).trim().split('/')
    if (!perf || !rir || !rec) continue
    return {
      performance: perf as SurveyPerformance,
      rir_feel:    rir  as SurveyRirFeel,
      recovery:    rec  as SurveyRecovery,
    }
  }
  return null
}

/** Strip all encoded meta lines, leaving only user-authored note text. */
export function stripMetaLines(notes: string | null | undefined): string {
  if (!notes) return ''
  return notes.split('\n').filter(l => !isMetaLine(l)).join('\n').trim()
}

/**
 * Build a notes blob that embeds survey + suggestion as meta lines on top of the
 * user's own notes. Used server-side as a fallback when migration 004 columns
 * are missing. Returns null when there is nothing at all to store.
 */
export function encodeNotesWithMeta(opts: {
  userNotes:   string | null | undefined
  suggestion:  string | null | undefined
  survey:      Partial<SessionSurvey> | null | undefined
}): string | null {
  const meta: string[] = []
  if (opts.suggestion) {
    meta.push(`${NOTE_SUGGESTION_PREFIX}${opts.suggestion}`)
  }
  const sv = opts.survey
  if (sv?.performance && sv?.rir_feel && sv?.recovery) {
    meta.push(`${NOTE_SURVEY_PREFIX}${sv.performance}/${sv.rir_feel}/${sv.recovery}`)
  }
  const clean = stripMetaLines(opts.userNotes)
  const lines = [...meta, ...(clean ? [clean] : [])]
  return lines.length ? lines.join('\n') : null
}
