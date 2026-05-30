import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/user-programs/[id]/advance
 * Advances the user's current phase to the next one in the block.
 * If there is no next phase, marks the program as completed.
 */
export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/user-programs/[id]/advance'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Load program (must belong to this user or requester is admin)
  const { data: program } = await supabase
    .from('user_programs')
    .select('*, current_phase:phases(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!program) return Response.json({ error: 'Program not found' }, { status: 404 })
  if (program.status !== 'active') {
    return Response.json({ error: 'Program is not active' }, { status: 400 })
  }

  const currentOrder = (program.current_phase as any)?.phase_order ?? 0

  // Find next phase
  const { data: nextPhase } = await supabase
    .from('phases')
    .select('*')
    .eq('block_id', program.block_id)
    .gt('phase_order', currentOrder)
    .order('phase_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  const today = new Date().toISOString().split('T')[0]

  if (!nextPhase) {
    // No more phases — mark program as completed
    await supabase
      .from('user_programs')
      .update({ status: 'completed' })
      .eq('id', id)

    return Response.json({ completed: true })
  }

  // Advance to next phase
  const { data: updated, error } = await supabase
    .from('user_programs')
    .update({
      current_phase_id: nextPhase.id,
      phase_start_date: today,
    })
    .eq('id', id)
    .select('*, current_phase:phases(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ program: updated })
}
