import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/**
 * Verify the caller may mutate this exercise.
 * Admins may edit anything; coaches only rows they created.
 * Returns null when allowed, or a Response to short-circuit with.
 */
async function guardOwnership(id: string) {
  let profile
  try {
    profile = await requireContentAuthor()
  } catch {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  if (profile.role === 'admin') return { profile }

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('exercises')
    .select('created_by')
    .eq('id', id)
    .maybeSingle()

  if (!row) return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  if (row.created_by !== profile.id) {
    return {
      error: Response.json(
        { error: 'Bạn chỉ có thể sửa/xoá bài tập do chính mình tạo.' },
        { status: 403 },
      ),
    }
  }
  return { profile }
}

/** PATCH /api/exercises/[id] — update exercise (owner or admin) */
export async function PATCH(request: Request, ctx: RouteContext<'/api/exercises/[id]'>) {
  const { id } = await ctx.params
  const guard = await guardOwnership(id)
  if (guard.error) return guard.error

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

/** DELETE /api/exercises/[id] — delete exercise (owner or admin) */
export async function DELETE(_req: Request, ctx: RouteContext<'/api/exercises/[id]'>) {
  const { id } = await ctx.params
  const guard = await guardOwnership(id)
  if (guard.error) return guard.error

  const supabase = await createClient()
  const { error } = await supabase.from('exercises').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
