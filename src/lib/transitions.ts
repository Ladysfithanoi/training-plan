import { createClient, createAdminClient } from './supabase/server'
import { isPhaseExpired } from './utils'
import { todayISO } from './date'

export interface AdvanceResult {
  advanced: boolean
  completed: boolean
  nextPhaseName: string | null
}

const NO_CHANGE: AdvanceResult = { advanced: false, completed: false, nextPhaseName: null }

/** Minimal Supabase client surface used by the advance logic. */
type AdvanceClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>

/**
 * Checks if the user's current phase has expired and advances it automatically.
 * Returns what happened so the calling page can show the right banner.
 *
 * Pass a `client` when calling from a context without a user session (e.g. the
 * public guest route, which uses the service-role admin client). When omitted,
 * a session-based client is used and RLS lets the user update their own program.
 *
 * A write that fails (RLS, network) reports `advanced: false` rather than
 * pretending the rollover happened — otherwise the caller re-reads the very
 * same stale row and silently renders an overrun week counter ("Tuần 5/4").
 */
export async function autoAdvancePhaseIfExpired(
  program: {
    id: string
    block_id: string
    current_phase_id: string
    phase_start_date: string
    current_phase: { duration_weeks: number; phase_order: number; name: string } | null
  },
  client?: AdvanceClient,
): Promise<AdvanceResult> {
  if (!program.current_phase || !program.phase_start_date) return NO_CHANGE

  if (!isPhaseExpired(program.phase_start_date, program.current_phase.duration_weeks)) {
    return NO_CHANGE
  }

  // Default to the session-based client — user can update their own program (RLS: user_id = auth.uid())
  const supabase = client ?? (await createClient())
  const today = todayISO()

  // Find the next phase in the block
  const { data: nextPhase } = await supabase
    .from('phases')
    .select('id, name, phase_order')
    .eq('block_id', program.block_id)
    .gt('phase_order', program.current_phase.phase_order)
    .order('phase_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextPhase) {
    // No more phases — program is complete
    const { error } = await supabase
      .from('user_programs')
      .update({ status: 'completed' })
      .eq('id', program.id)
    if (error) {
      console.error('autoAdvancePhaseIfExpired: complete failed —', error.message)
      return NO_CHANGE
    }
    return { advanced: true, completed: true, nextPhaseName: null }
  }

  // Advance to the next phase
  const { error } = await supabase
    .from('user_programs')
    .update({ current_phase_id: nextPhase.id, phase_start_date: today })
    .eq('id', program.id)
  if (error) {
    console.error('autoAdvancePhaseIfExpired: advance failed —', error.message)
    return NO_CHANGE
  }

  return { advanced: true, completed: false, nextPhaseName: nextPhase.name }
}

/**
 * Called by the Vercel Cron job — advances all expired programs across all users.
 *
 * A safety net only: every training page advances its own program on load, so
 * an athlete who opens the app never waits for the nightly run.
 */
export async function batchAdvanceExpiredPhases(): Promise<{
  checked: number
  advanced: number
  completed: number
}> {
  const admin = createAdminClient()

  const { data: activePrograms } = await admin
    .from('user_programs')
    .select('id, block_id, current_phase_id, phase_start_date, current_phase:phases(name, duration_weeks, phase_order)')
    .eq('status', 'active')
    .not('current_phase_id', 'is', null)
    .not('phase_start_date', 'is', null)

  if (!activePrograms?.length) return { checked: 0, advanced: 0, completed: 0 }

  let advanced = 0
  let completed = 0

  for (const prog of activePrograms) {
    const phase = prog.current_phase as unknown as
      { name: string; duration_weeks: number; phase_order: number } | null
    if (!phase || !prog.phase_start_date || !prog.current_phase_id) continue

    const result = await autoAdvancePhaseIfExpired(
      {
        id: prog.id,
        block_id: prog.block_id,
        current_phase_id: prog.current_phase_id,
        phase_start_date: prog.phase_start_date,
        current_phase: phase,
      },
      admin,
    )

    if (result.completed) completed++
    else if (result.advanced) advanced++
  }

  return { checked: activePrograms.length, advanced, completed }
}
