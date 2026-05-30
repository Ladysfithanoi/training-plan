import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

/** DELETE /api/admin/users/[id] */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/admin/users/[id]'>,
) {
  try {
    await requireAdmin()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const admin = createAdminClient()

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}

/** PATCH /api/admin/users/[id] — update name / role */
export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/admin/users/[id]'>,
) {
  try {
    await requireAdmin()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('profiles')
    .update({ full_name: body.full_name, role: body.role })
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ profile: data })
}
