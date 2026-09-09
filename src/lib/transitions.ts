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

/** The columns `autoAdvancePhaseIfExpired` needs, for a program read by user id. */
// One literal string on purpose: supabase-js derives the row type from the
// select text, and a concatenated string widens every column to `unknown`.
const PROGRAM_SELECT = 'id, block_id, current_phase_id, phase_start_date, current_phase:phases(name, duration_weeks, phase_order)'

/**
 * Reads a user's active program and rolls it over when the current meso has run
 * its course.
 *
 * Call this BEFORE the page reads the program it is about to render: the render
 * query then sees the already-advanced row, so no page needs a second "refresh"
 * read, and the week counter can never be drawn past its meso ("Tuần 3/2").
 *
 * Pass `client` when the caller has no session for that user — the public guest
 * route and the coach looking at a student both use the service-role client.
 */
export async function autoAdvanceUserProgram(
  userId: string,
  client?: AdvanceClient,
): Promise<AdvanceResult> {
  const supabase = client ?? (await createClient())

  const { data, error } = await supabase
    .from('user_programs')
    .select(PROGRAM_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.current_phase_id || !data.phase_start_date) return NO_CHANGE

  const phase = data.current_phase as unknown as
    { name: string; duration_weeks: number; phase_order: number } | null
  if (!phase) return NO_CHANGE

  return autoAdvancePhaseIfExpired(
    {
      id: data.id,
      block_id: data.block_id,
      current_phase_id: data.current_phase_id,
      phase_start_date: data.phase_start_date,
      current_phase: phase,
    },
    supabase,
  )
}

/**
 * Called by the Vercel Cron job — advances all expired programs across all users.
 *
 * This is the ONLY rollover an athlete who never opens the app can get — the
 * per-page advance cannot run for them. Reachability matters as much as the
 * logic: `src/proxy.ts` must keep `/api/cron/` public, otherwise every nightly
 * run is answered with 401 and no meso ever rolls over by itself.
 */
export async function batchAdvanceExpiredPhases(): Promise<{
  checked: number
  advanced: number
  completed: number
}> {
  const admin = createAdminClient()

  const { data: activePrograms } = await admin
    .from('user_programs')
    .select(PROGRAM_SELECT)
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
