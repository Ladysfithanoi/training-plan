import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

/** GET /api/movement-patterns — list all */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('movement_patterns')
    .select('*')
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ patterns: data })
}

/** POST /api/movement-patterns — create (admin only) */
export async function POST(request: Request) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  if (!body.name?.trim()) {
    return Response.json({ error: 'Name is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('movement_patterns')
    .insert({ name: body.name.trim(), description: body.description ?? null })
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ pattern: data }, { status: 201 })
}
