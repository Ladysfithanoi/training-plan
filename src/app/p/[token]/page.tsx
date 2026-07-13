import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveGuestToken } from '@/lib/guestToken'
import { autoAdvancePhaseIfExpired } from '@/lib/transitions'
import { currentWeekInPhase, weekOfDateInPhase } from '@/lib/utils'
import { extractSuggestionFromNotes } from '@/lib/sessionNotes'
import { GuestTrainingView } from './_components/GuestTrainingView'
import type { PhaseExercise, WorkoutSession, WorkoutSet, UserProgram, WeekType } from '@/types'

export const metadata = { title: 'Chương trình Tập luyện' }

/** Public guest route — no Supabase auth required, validated by magic token only */
export default async function GuestProgramPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const userId = await resolveGuestToken(token)
  if (!userId) notFound()

  const admin = createAdminClient()

  // ── Athlete profile ────────────────────────────────────────────────────────
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) notFound()

  // ── Active user_program + current phase ───────────────────────────────────
  const { data: rawProgram } = await admin
    .from('user_programs')
    .select('*, block:training_blocks(*), current_phase:phases(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  let userProgram = rawProgram as (UserProgram & {
    block: { name: string } | null
    current_phase: {
      name: string
      duration_weeks: number
      frequency_per_week: number
      week_type: WeekType | null
      /** Split type key (e.g. 'push_pull_legs') or null when no split is configured. */
      split_type: string | null
      /** Ordered array of training-day objects for the current meso phase. */
      split_days: Array<{ id: string; type: string; label: string }>
    } | null
  }) | null

  // ── Tự động chuyển Meso khi giai đoạn hết hạn ─────────────────────────────
  // Uses the admin client (this is a public, session-less route) so the meso
  // rolls over instead of the week counter overrunning (e.g. "Tuần 5/4").
  let programCompleted = false
  if (userProgram?.current_phase && userProgram.phase_start_date && userProgram.current_phase_id) {
    const cp = userProgram.current_phase as typeof userProgram.current_phase & { phase_order: number }
    const result = await autoAdvancePhaseIfExpired(
      {
        id: userProgram.id,
        block_id: userProgram.block_id,
        current_phase_id: userProgram.current_phase_id,
        phase_start_date: userProgram.phase_start_date,
        current_phase: { duration_weeks: cp.duration_weeks, phase_order: cp.phase_order, name: cp.name },
      },
      admin,
    )
    if (result.advanced && result.completed) {
      // Last meso finished — the program is now `completed`. Drop the stale
      // active program so the week counter doesn't overrun ("Tuần 3/2"); the
      // view shows a completion notice instead.
      userProgram = null
      programCompleted = true
    } else if (result.advanced && !result.completed) {
      const { data: refreshed } = await admin
        .from('user_programs')
        .select('*, block:training_blocks(*), current_phase:phases(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()
      if (refreshed) userProgram = refreshed as typeof userProgram
    }
  }

  // ── Phase exercises ────────────────────────────────────────────────────────
  let phaseExercises: PhaseExercise[] = []
  if (userProgram?.current_phase_id) {
    const { data } = await admin
      .from('phase_exercises')
      .select('*, exercise:exercises(*)')
      .eq('phase_id', userProgram.current_phase_id)
    phaseExercises = (data ?? []) as PhaseExercise[]
  }

  // ── Completed sessions for the WHOLE current phase, bucketed by week ─────────
  // These are what make past weeks re-viewable: each week tab hydrates its grid
  // from the sessions logged in that week (derived from session_date vs.
  // phase_start_date). `select('*')` keeps this resilient to migration-004
  // columns being absent on the live DB.
  type WeekSessionRow = WorkoutSession & { week: number; sets: WorkoutSet[] }
  let weekSessions: WeekSessionRow[] = []
  if (userProgram?.current_phase_id && userProgram.phase_start_date) {
    const startDate = userProgram.phase_start_date
    const { data: phaseSessionRows } = await admin
      .from('workout_sessions')
      .select('*, sets:workout_sets(*)')
      .eq('user_id', userId)
      .eq('phase_id', userProgram.current_phase_id)
      .eq('status', 'completed')
      .order('session_date', { ascending: true })
    weekSessions = ((phaseSessionRows ?? []) as (WorkoutSession & { sets: WorkoutSet[] })[]).map(s => ({
      ...s,
      week: weekOfDateInPhase(startDate, s.session_date),
    }))
  }

  // ── Recent sessions (last 10) ──────────────────────────────────────────────
  const { data: recentRaw } = await admin
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)')
    .eq('user_id', userId)
    .order('session_date', { ascending: false })
    .limit(10)

  type SessionRow = Omit<WorkoutSession, 'sets'> & { sets: { count: number }[] }
  const recentSessions = (recentRaw ?? []) as SessionRow[]

  // ── Today's completed session with full set data (for synchronous hydration) ─
  type CompletedSessionWithSets = WorkoutSession & { sets: WorkoutSet[] }
  let todayCompletedSession: CompletedSessionWithSets | null = null
  {
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: todayRows } = await admin
      .from('workout_sessions')
      .select('*, sets:workout_sets(*)')
      .eq('user_id', userId)
      .eq('session_date', todayStr)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
    todayCompletedSession = ((todayRows ?? [])[0] ?? null) as CompletedSessionWithSets | null
  }

  // ── Previous session's autoregulation suggestion ───────────────────────────
  // Resilient to migration 004 not being deployed: select `*` and prefer the
  // real column, falling back to the notes-encoded suggestion.
  let prevSuggestion: string | null = null
  if (userProgram?.current_phase_id) {
    const { data: prevRows } = await admin
      .from('workout_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('phase_id', userProgram.current_phase_id)
      .eq('status', 'completed')
      .order('session_date', { ascending: false })
      .limit(5)

    for (const row of (prevRows ?? []) as WorkoutSession[]) {
      const suggestion = row.next_week_suggestion ?? extractSuggestionFromNotes(row.notes)
      if (suggestion) { prevSuggestion = suggestion; break }
    }
  }

  // ── Current week within the active phase ───────────────────────────────────
  const weekInPhase = userProgram?.phase_start_date
    ? currentWeekInPhase(userProgram.phase_start_date)
    : 1

  // Derive week_type from the current phase (migration 006)
  const phaseWeekType: WeekType = (userProgram?.current_phase?.week_type) ?? 'standard'

  // Split-day objects for the current meso — used by the spreadsheet matrix to render
  // day tabs and filter exercises strictly to the active training day.
  const phaseSplitDays = Array.isArray(userProgram?.current_phase?.split_days)
    ? (userProgram!.current_phase!.split_days as Array<{ id: string; type: string; label: string }>)
    : []

  return (
    <GuestTrainingView
      token={token}
      athleteName={profile.full_name ?? profile.email}
      userProgram={userProgram}
      phaseExercises={phaseExercises}
      phaseSplitDays={phaseSplitDays}
      weekInPhase={weekInPhase}
      recentSessions={recentSessions}
      weekSessions={weekSessions}
      prevSuggestion={prevSuggestion}
      phaseWeekType={phaseWeekType}
      todayCompletedSession={todayCompletedSession}
      programCompleted={programCompleted}
    />
  )
}
