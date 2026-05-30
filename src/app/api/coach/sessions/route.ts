import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/sessions
 * Lists the coach's own recent workout sessions (last 20).
 */
export async function GET() {
  let profile
  try { profile = await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)')
    .eq('user_id', profile.id)
    .order('session_date', { ascending: false })
    .limit(20)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ sessions: data })
}

/**
 * POST /api/coach/sessions
 * Creates a new in-progress workout session for the coach.
 *
 * Body: { phase_id?: string, user_program_id?: string }
 */
export async function POST(request: Request) {
  let profile
  try { profile = await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('workout_sessions')
    .insert({
      user_id:        profile.id,
      phase_id:       body.phase_id       ?? null,
      user_program_id: body.user_program_id ?? null,
      session_date:   new Date().toISOString().split('T')[0],
      status:         'in_progress',
      notes:          null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ session: { ...data, sets: [] } }, { status: 201 })
}
