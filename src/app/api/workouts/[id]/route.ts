import { createClient } from '@/lib/supabase/server'

/** GET /api/workouts/[id] */
export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/workouts/[id]'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(*, exercise:exercises(*))')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ session: data })
}

/** PATCH /api/workouts/[id] — update session (status, notes, RIR, duration) */
export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/workouts/[id]'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const { data, error } = await supabase
    .from('workout_sessions')
    .update({
      status:               body.status,
      duration_minutes:     body.duration_minutes     ?? null,
      overall_rir:          body.overall_rir          ?? null,
      notes:                body.notes                ?? null,
      // Post-workout autoregulation survey (migration 004)
      survey_performance:   body.survey_performance   ?? null,
      survey_rir_feel:      body.survey_rir_feel      ?? null,
      survey_recovery:      body.survey_recovery      ?? null,
      next_week_suggestion: body.next_week_suggestion ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ session: data })
}

/** DELETE /api/workouts/[id] */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/workouts/[id]'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('workout_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
