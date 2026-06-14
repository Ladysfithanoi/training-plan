import { requireContentAuthor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Verify the caller may mutate this training block (giáo án).
 * Admins may edit anything; coaches only blocks they created.
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
    .from('training_blocks')
    .select('created_by')
    .eq('id', id)
    .maybeSingle()

  if (!row) return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  if (row.created_by !== profile.id) {
    return {
      error: Response.json(
        { error: 'Bạn chỉ có thể sửa/xoá giáo án do chính mình tạo.' },
        { status: 403 },
      ),
    }
  }
  return { profile }
}

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
  const { id } = await ctx.params
  const guard = await guardOwnership(id)
  if (guard.error) return guard.error

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
  const { id } = await ctx.params
  const guard = await guardOwnership(id)
  if (guard.error) return guard.error

  const supabase = await createClient()

  const { error } = await supabase.from('training_blocks').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
