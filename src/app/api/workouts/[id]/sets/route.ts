import { createClient } from '@/lib/supabase/server'
import { computeE1RM, checkDoubleProgression } from '@/lib/progression'
import type { DoubleProgressionHint } from '@/types'

/** POST /api/workouts/[id]/sets — log a set for a session */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workouts/[id]/sets'>,
) {
  const { id: sessionId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify session ownership AND capture phase_id for progression checks
  const { data: session } = await supabase
    .from('workout_sessions')
    .select('id, phase_id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json()

  // ── Auto-calculate RPE from RIR ────────────────────────────────────────────
  const rir: number | null = body.rir ?? null
  const rpe: number | null = rir != null ? 10 - rir : null

  // ── Fetch exercise type + phase prescription in parallel ───────────────────
  // Both are needed for progression checks; neither blocks the insert path.
  const [exerciseRes, phaseExRes] = await Promise.all([
    supabase
      .from('exercises')
      .select('type')
      .eq('id', body.exercise_id)
      .maybeSingle(),
    session.phase_id
      ? supabase
          .from('phase_exercises')
          .select('target_rep_min, target_rep_max, rir_target')
          .eq('phase_id', session.phase_id)
          .eq('exercise_id', body.exercise_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const exercise = exerciseRes.data
  const phaseEx = phaseExRes.data

  // ── Compute estimated 1RM (Brzycki + RIR) ─────────────────────────────────
  // Only for working sets that have all three required values.
  const estimated1rm: number | null =
    !body.is_warmup &&
    body.weight_kg != null &&
    body.actual_reps != null &&
    rir != null
      ? computeE1RM(body.weight_kg, body.actual_reps, rir)
      : null

  // ── Insert the set ─────────────────────────────────────────────────────────
  const basePayload = {
    session_id: sessionId,
    exercise_id: body.exercise_id,
    set_number: body.set_number,
    target_reps: body.target_reps ?? null,
    actual_reps: body.actual_reps,
    weight_kg: body.weight_kg ?? null,
    rir,
    rpe,
    is_warmup: body.is_warmup ?? false,
    notes: body.notes ?? null,
  }

  let insertResult = await supabase
    .from('workout_sets')
    .insert({ ...basePayload, estimated_1rm: estimated1rm })
    .select('*, exercise:exercises(*)')
    .single()

  // Graceful fallback: if the estimated_1rm column doesn't exist yet
  // (migration 001_add_estimated_1rm.sql not yet applied), retry without it
  // so set logging always works even on un-migrated databases.
  if (
    insertResult.error &&
    (insertResult.error.code === '42703' ||                      // PostgreSQL: undefined_column
      insertResult.error.message?.includes('estimated_1rm'))
  ) {
    console.warn('[sets/POST] estimated_1rm column missing — retrying without it. Run migration 001.')
    insertResult = await supabase
      .from('workout_sets')
      .insert(basePayload)
      .select('*, exercise:exercises(*)')
      .single()
  }

  const { data, error } = insertResult
  if (error) return Response.json({ error: error.message }, { status: 400 })

  // ── Check double progression (isolation / machine / cable / dumbbell) ──────
  let hint: DoubleProgressionHint | null = null
  if (
    !body.is_warmup &&
    exercise &&
    phaseEx &&
    body.actual_reps != null
  ) {
    hint = checkDoubleProgression({
      setNumber: body.set_number,
      actualReps: body.actual_reps,
      targetRepMax: phaseEx.target_rep_max,
      rir,
      rirTarget: phaseEx.rir_target,
      weightKg: body.weight_kg ?? null,
      exerciseType: exercise.type,
    })
  }

  return Response.json({ set: data, hint, estimatedOneRm: estimated1rm }, { status: 201 })
}

/** GET /api/workouts/[id]/sets — list sets for a session */
export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/workouts/[id]/sets'>,
) {
  const { id: sessionId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('workout_sets')
    .select('*, exercise:exercises(*)')
    .eq('session_id', sessionId)
    .order('set_number', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ sets: data })
}

/**
 * PATCH /api/workouts/[id]/sets?set_id=<uuid>
 * Update a single logged set — re-computes rpe and estimated_1rm automatically.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/workouts/[id]/sets'>,
) {
  const { id: sessionId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const setId = searchParams.get('set_id')
  if (!setId) return Response.json({ error: 'set_id query param required' }, { status: 400 })

  // Verify ownership via session
  const { data: session } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json()

  // Fetch current set values so we can merge and recompute e1RM
  const { data: currentSet } = await supabase
    .from('workout_sets')
    .select('weight_kg, actual_reps, rir, is_warmup')
    .eq('id', setId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (!currentSet) return Response.json({ error: 'Set not found' }, { status: 404 })

  // Merge incoming patch with current values
  const newWeight   = body.weight_kg    !== undefined ? body.weight_kg    : currentSet.weight_kg
  const newReps     = body.actual_reps  !== undefined ? body.actual_reps  : currentSet.actual_reps
  const newRir      = body.rir          !== undefined ? body.rir          : currentSet.rir
  const newIsWarmup = body.is_warmup    !== undefined ? body.is_warmup    : currentSet.is_warmup

  // Recompute rpe and e1RM from merged values
  const newRpe = newRir != null ? 10 - newRir : null
  const newE1rm = !newIsWarmup && newWeight != null && newReps != null && newRir != null
    ? computeE1RM(newWeight, newReps, newRir)
    : null

  const patch: Record<string, unknown> = {
    weight_kg:      newWeight,
    actual_reps:    newReps,
    rir:            newRir,
    rpe:            newRpe,
    is_warmup:      newIsWarmup,
    estimated_1rm:  newE1rm,
  }
  if (body.notes !== undefined) patch.notes = body.notes

  const { data, error } = await supabase
    .from('workout_sets')
    .update(patch)
    .eq('id', setId)
    .eq('session_id', sessionId)
    .select('*, exercise:exercises(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ set: data })
}

/**
 * DELETE /api/workouts/[id]/sets?set_id=<uuid>
 * Remove a single logged set from a session.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/workouts/[id]/sets'>,
) {
  const { id: sessionId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const setId = searchParams.get('set_id')
  if (!setId) return Response.json({ error: 'set_id query param required' }, { status: 400 })

  // Verify ownership via session
  const { data: session } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })

  const { error } = await supabase
    .from('workout_sets')
    .delete()
    .eq('id', setId)
    .eq('session_id', sessionId)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
