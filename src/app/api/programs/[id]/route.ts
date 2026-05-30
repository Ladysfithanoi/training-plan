import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/** GET /api/programs/[id] */
export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/programs/[id]'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('training_blocks')
    .select('*, phases(*)')
    .eq('id', id)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ block: data })
}

/** PATCH /api/programs/[id] */
export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/programs/[id]'>,
) {
  try {
    await requireAdmin()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('training_blocks')
    .update({ name: body.name, description: body.description })
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ block: data })
}

/** DELETE /api/programs/[id] */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/programs/[id]'>,
) {
  try {
    await requireAdmin()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const supabase = await createClient()

  const { error } = await supabase.from('training_blocks').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
