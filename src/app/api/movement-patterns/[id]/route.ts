import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

/** PATCH /api/movement-patterns/[id] */
export async function PATCH(request: Request, ctx: RouteContext<'/api/movement-patterns/[id]'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('movement_patterns')
    .update({ name: body.name, description: body.description ?? null })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ pattern: data })
}

/** DELETE /api/movement-patterns/[id] */
export async function DELETE(_req: Request, ctx: RouteContext<'/api/movement-patterns/[id]'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const supabase = await createClient()

  const { error } = await supabase
    .from('movement_patterns')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
