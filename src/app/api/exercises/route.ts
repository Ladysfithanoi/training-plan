import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/** GET /api/exercises — list all exercises */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const pattern = searchParams.get('pattern')
  const type = searchParams.get('type')
  const q = searchParams.get('q')

  let query = supabase
    .from('exercises')
    .select('*, movement_pattern:movement_patterns(*)')
    .order('name')

  if (pattern) query = query.eq('movement_pattern_id', pattern)
  if (type) query = query.eq('type', type)
  if (q) query = query.ilike('name', `%${q}%`)

  const { data, error } = await query

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ exercises: data })
}

/** POST /api/exercises — create an exercise (admin or coach) */
export async function POST(request: Request) {
  let profile
  try {
    profile = await requireContentAuthor()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('exercises')
    .insert({
      name: body.name,
      movement_pattern_id: body.movement_pattern_id ?? null,
      type: body.type ?? 'compound',
      optimal_rep_min: body.optimal_rep_min ?? 5,
      optimal_rep_max: body.optimal_rep_max ?? 20,
      description: body.description ?? null,
      muscle_groups: body.muscle_groups ?? [],
      created_by: profile.id,
    })
    .select('*, movement_pattern:movement_patterns(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ exercise: data }, { status: 201 })
}
