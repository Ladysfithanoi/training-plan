import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { autoAdvancePhaseIfExpired } from '@/lib/transitions'
import { currentWeekInPhase, weekOfDateInPhase } from '@/lib/utils'
import type { TrainingBlock, PhaseExercise, UserProgram, WeekType, WorkoutSession, WorkoutSet } from '@/types'
import { extractSuggestionFromNotes } from '@/lib/sessionNotes'
import { CoachTrainingView } from './_components/CoachTrainingView'

export const metadata = { title: 'Lịch tập của tôi' }
export const dynamic = 'force-dynamic'

export default async function CoachMyTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ switch?: string }>
}) {
  const { switch: switchParam } = await searchParams
  const forceSelector = switchParam === '1'
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'coach' && profile?.role !== 'trial') redirect('/dashboard')

  // ── Active user_program for this coach ────────────────────────────────────
  const { data: rawProgram } = await supabase
    .from('user_programs')
    .select('*, block:training_blocks(*), current_phase:phases(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  type ProgramWithJoins = UserProgram & {
    block: { id: string; name: string } | null
    current_phase: {
      id: string
      name: string
      duration_weeks: number
      frequency_per_week: number
      week_type: WeekType | null
      split_type: string | null
      split_days: Array<{ id: string; type: string; label: string }>
    } | null
  }

  let userProgram = rawProgram as ProgramWithJoins | null

  // ── Tự động chuyển Meso khi giai đoạn hết hạn ─────────────────────────────
  // Without this the week counter runs past the meso's length (e.g. "Tuần 5/4")
  // and never rolls over to the next phase. Mirrors the athlete dashboard.
  if (userProgram?.current_phase && userProgram.phase_start_date && userProgram.current_phase_id) {
    const cp = userProgram.current_phase as ProgramWithJoins['current_phase'] & { phase_order: number }
    const result = await autoAdvancePhaseIfExpired({
      id: userProgram.id,
      block_id: userProgram.block_id,
      current_phase_id: userProgram.current_phase_id,
      phase_start_date: userProgram.phase_start_date,
      current_phase: { duration_weeks: cp.duration_weeks, phase_order: cp.phase_order, name: cp.name },
    })
    if (result.advanced && !result.completed) {
      const { data: refreshed } = await supabase
        .from('user_programs')
        .select('*, block:training_blocks(*), current_phase:phases(*)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      if (refreshed) userProgram = refreshed as ProgramWithJoins
    }
  }

  // ── Phase exercises (current phase only) ───────────────────────────────────
  let phaseExercises: PhaseExercise[] = []
  if (userProgram?.current_phase_id) {
    const { data } = await supabase
      .from('phase_exercises')
      .select('*, exercise:exercises(*)')
      .eq('phase_id', userProgram.current_phase_id)
    phaseExercises = (data ?? []) as PhaseExercise[]
  }

  // ── Derive phaseSplitDays ──────────────────────────────────────────────────
  const phaseSplitDays = Array.isArray(userProgram?.current_phase?.split_days)
    ? (userProgram!.current_phase!.split_days as Array<{ id: string; type: string; label: string }>)
    : []

  // ── All phases of the active block (for week timeline) ────────────────────
  type BlockPhase = {
    id: string
    name: string
    phase_order: number
    duration_weeks: number
    week_type: string | null
    split_days: Array<{ id: string; type: string; label: string }>
  }
  let blockPhases: BlockPhase[] = []
  if (userProgram?.block_id) {
    const { data: phasesData } = await supabase
      .from('phases')
      .select('id, name, phase_order, duration_weeks, week_type, split_days')
      .eq('block_id', userProgram.block_id)
      .order('phase_order', { ascending: true })
    blockPhases = (phasesData ?? []) as BlockPhase[]
  }

  // ── Current week within active phase ──────────────────────────────────────
  const weekInPhase = userProgram?.phase_start_date
    ? currentWeekInPhase(userProgram.phase_start_date)
    : 1

  // ── All training blocks (for CoachProgramSelector) ────────────────────────
  const { data: blocksRaw } = await supabase
    .from('training_blocks')
    .select('id, name, description, total_mesocycles, created_at, phases(id, duration_weeks, phase_order)')
    .order('created_at', { ascending: false })

  const availableBlocks = (blocksRaw ?? []) as TrainingBlock[]

  // ── Recent sessions for this coach (last 10) ──────────────────────────────
  const { data: recentRaw } = await supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)')
    .eq('user_id', user.id)
    .order('session_date', { ascending: false })
    .limit(10)

  type SessionRow = Omit<WorkoutSession, 'sets'> & { sets: { count: number }[] }
  const recentSessions = (recentRaw ?? []) as SessionRow[]

  // ── Today's completed session with full set data (for synchronous hydration) ─
  type CompletedSessionWithSets = WorkoutSession & { sets: WorkoutSet[] }
  let todayCompletedSession: CompletedSessionWithSets | null = null
  {
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: todayRows } = await supabase
      .from('workout_sessions')
      .select('*, sets:workout_sets(*)')
      .eq('user_id', user.id)
      .eq('session_date', todayStr)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
    todayCompletedSession = ((todayRows ?? [])[0] ?? null) as CompletedSessionWithSets | null
  }

  // ── Completed sessions for the WHOLE current phase, bucketed by week ─────────
  // Powers re-viewable past weeks + the per-exercise "previous week" reminder.
  // `select('*')` stays resilient to migration-004 columns being absent.
  type WeekSessionRow = WorkoutSession & { week: number; sets: WorkoutSet[] }
  let weekSessions: WeekSessionRow[] = []
  if (userProgram?.current_phase_id && userProgram.phase_start_date) {
    const startDate = userProgram.phase_start_date
    const { data: phaseSessionRows } = await supabase
      .from('workout_sessions')
      .select('*, sets:workout_sets(*)')
      .eq('user_id', user.id)
      .eq('phase_id', userProgram.current_phase_id)
      .eq('status', 'completed')
      .order('session_date', { ascending: true })
    weekSessions = ((phaseSessionRows ?? []) as (WorkoutSession & { sets: WorkoutSet[] })[]).map(s => ({
      ...s,
      week: weekOfDateInPhase(startDate, s.session_date),
    }))
  }

  // ── Previous autoregulation suggestion ────────────────────────────────────
  // Resilient to migration 004 not being deployed: select `*` (never errors on
  // missing columns) and prefer the real column, falling back to notes decoding.
  let prevSuggestion: string | null = null
  if (userProgram?.current_phase_id) {
    const { data: prevRows } = await supabase
      .from('workout_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('phase_id', userProgram.current_phase_id)
      .eq('status', 'completed')
      .order('session_date', { ascending: false })
      .limit(5)

    for (const row of (prevRows ?? []) as WorkoutSession[]) {
      const suggestion = row.next_week_suggestion ?? extractSuggestionFromNotes(row.notes)
      if (suggestion) { prevSuggestion = suggestion; break }
    }
  }

  const phaseWeekType: WeekType = (userProgram?.current_phase?.week_type) ?? 'standard'

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          Quản trị viên / HLV
        </p>
        <h1 className="text-2xl font-bold text-ink">Lịch tập của tôi</h1>
        <p className="text-sm text-ink/50 mt-1">
          Theo dõi và ghi nhận buổi tập cá nhân trong khối tập luyện.
        </p>
      </div>

      <CoachTrainingView
        userProgram={forceSelector ? null : userProgram}
        phaseExercises={phaseExercises}
        phaseSplitDays={phaseSplitDays}
        blockPhases={blockPhases}
        weekInPhase={weekInPhase}
        availableBlocks={availableBlocks}
        recentSessions={recentSessions}
        weekSessions={weekSessions}
        prevSuggestion={prevSuggestion}
        phaseWeekType={phaseWeekType}
        todayCompletedSession={forceSelector ? null : todayCompletedSession}
      />
    </div>
  )
}
