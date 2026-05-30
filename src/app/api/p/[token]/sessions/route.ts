import { createAdminClient } from '@/lib/supabase/server'
import { resolveGuestToken } from '@/lib/guestToken'

/** GET /api/p/[token]/sessions — list sessions for the guest athlete */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const userId = await resolveGuestToken(token)
  if (!userId) return Response.json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)')
    .eq('user_id', userId)
    .order('session_date', { ascending: false })
    .limit(10)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ sessions: data })
}

/** POST /api/p/[token]/sessions — create a new workout session for the guest athlete */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const userId = await resolveGuestToken(token)
  if (!userId) return Response.json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }, { status: 404 })

  const body = await request.json()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('workout_sessions')
    .insert({
      user_id: userId,
      phase_id: body.phase_id ?? null,
      user_program_id: body.user_program_id ?? null,
      session_date: body.session_date ?? new Date().toISOString().split('T')[0],
      status: 'in_progress',
      notes: null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ session: data }, { status: 201 })
}
