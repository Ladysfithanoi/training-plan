import { createClient, createAdminClient } from './supabase/server'
import { isPhaseExpired } from './utils'

export interface AdvanceResult {
  advanced: boolean
  completed: boolean
  nextPhaseName: string | null
}

/**
 * Checks if the user's current phase has expired and advances it automatically.
 * Returns what happened so the calling page can show the right banner.
 */
export async function autoAdvancePhaseIfExpired(program: {
  id: string
  block_id: string
  current_phase_id: string
  phase_start_date: string
  current_phase: { duration_weeks: number; phase_order: number; name: string } | null
}): Promise<AdvanceResult> {
  if (!program.current_phase || !program.phase_start_date) {
    return { advanced: false, completed: false, nextPhaseName: null }
  }

  if (!isPhaseExpired(program.phase_start_date, program.current_phase.duration_weeks)) {
    return { advanced: false, completed: false, nextPhaseName: null }
  }

  // Use session-based client — user can update their own program (RLS: user_id = auth.uid())
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

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
    await supabase
      .from('user_programs')
      .update({ status: 'completed' })
      .eq('id', program.id)
    return { advanced: true, completed: true, nextPhaseName: null }
  }

  // Advance to the next phase
  await supabase
    .from('user_programs')
    .update({ current_phase_id: nextPhase.id, phase_start_date: today })
    .eq('id', program.id)

  return { advanced: true, completed: false, nextPhaseName: nextPhase.name }
}

/**
 * Called by the Vercel Cron job — advances all expired programs across all users.
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
  const today = new Date().toISOString().split('T')[0]

  for (const prog of activePrograms) {
    const phase = prog.current_phase as any
    if (!phase || !prog.phase_start_date) continue
    if (!isPhaseExpired(prog.phase_start_date, phase.duration_weeks)) continue

    const { data: nextPhase } = await admin
      .from('phases')
      .select('id, name')
      .eq('block_id', prog.block_id)
      .gt('phase_order', phase.phase_order)
      .order('phase_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!nextPhase) {
      await admin.from('user_programs').update({ status: 'completed' }).eq('id', prog.id)
      completed++
    } else {
      await admin
        .from('user_programs')
        .update({ current_phase_id: nextPhase.id, phase_start_date: today })
        .eq('id', prog.id)
      advanced++
    }
  }

  return { checked: activePrograms.length, advanced, completed }
}
