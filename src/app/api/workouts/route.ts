import { createClient } from '@/lib/supabase/server'

/** GET /api/workouts — list user's sessions */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') ?? '20')
  const page = parseInt(searchParams.get('page') ?? '1')
  const offset = (page - 1) * limit

  const { data, count, error } = await supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('session_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ sessions: data, count, page, limit })
}

/** POST /api/workouts — create a new session */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const { data, error } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: user.id,
      phase_id: body.phase_id ?? null,
      user_program_id: body.user_program_id ?? null,
      session_date: body.session_date ?? new Date().toISOString().split('T')[0],
      status: body.status ?? 'planned',
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ session: data }, { status: 201 })
}
