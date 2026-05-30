import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

/** PATCH /api/exercises/[id] — update exercise (admin only) */
export async function PATCH(request: Request, ctx: RouteContext<'/api/exercises/[id]'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()
  const supabase = await createClient()

  const updatePayload: Record<string, unknown> = {}
  if (body.name !== undefined) updatePayload.name = body.name
  if (body.movement_pattern_id !== undefined) updatePayload.movement_pattern_id = body.movement_pattern_id
  if (body.type !== undefined) updatePayload.type = body.type
  if (body.optimal_rep_min !== undefined) updatePayload.optimal_rep_min = body.optimal_rep_min
  if (body.optimal_rep_max !== undefined) updatePayload.optimal_rep_max = body.optimal_rep_max
  if (body.description !== undefined) updatePayload.description = body.description
  if (body.muscle_groups !== undefined) updatePayload.muscle_groups = body.muscle_groups

  const { data, error } = await supabase
    .from('exercises')
    .update(updatePayload)
    .eq('id', id)
    .select('*, movement_pattern:movement_patterns(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ exercise: data })
}

/** DELETE /api/exercises/[id] — delete exercise (admin only) */
export async function DELETE(_req: Request, ctx: RouteContext<'/api/exercises/[id]'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const supabase = await createClient()

  const { error } = await supabase.from('exercises').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
