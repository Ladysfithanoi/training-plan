import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentWeekInPhase } from '@/lib/utils'
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

  if (profile?.role !== 'admin' && profile?.role !== 'coach') redirect('/dashboard')

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

  const userProgram = rawProgram as ProgramWithJoins | null

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
        prevSuggestion={prevSuggestion}
        phaseWeekType={phaseWeekType}
        todayCompletedSession={forceSelector ? null : todayCompletedSession}
      />
    </div>
  )
}
