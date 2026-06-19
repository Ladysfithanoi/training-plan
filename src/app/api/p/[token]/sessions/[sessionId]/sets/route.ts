import { createAdminClient } from '@/lib/supabase/server'
import { resolveGuestToken } from '@/lib/guestToken'
import { computeE1RM, checkDoubleProgression } from '@/lib/progression'
import type { DoubleProgressionHint } from '@/types'

// ── Helper — validate token + session ownership ───────────────────────────────
async function resolveSession(token: string, sessionId: string) {
  const userId = await resolveGuestToken(token)
  if (!userId) return { userId: null, session: null }

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('workout_sessions')
    .select('id, phase_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  return { userId, session }
}

/** POST /api/p/[token]/sessions/[sessionId]/sets — log a set */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const { session } = await resolveSession(token, sessionId)
  if (!session) return Response.json({ error: 'Liên kết không hợp lệ hoặc buổi tập không tồn tại' }, { status: 404 })

  const body = await request.json()
  const admin = createAdminClient()

  // ── Auto-calculate RPE from RIR ────────────────────────────────────────────
  const rir: number | null = body.rir ?? null
  const rpe: number | null = rir != null ? 10 - rir : null

  // ── Fetch exercise type + phase prescription in parallel ───────────────────
  const [exerciseRes, phaseExRes] = await Promise.all([
    admin.from('exercises').select('type').eq('id', body.exercise_id).maybeSingle(),
    session.phase_id
      ? admin
          .from('phase_exercises')
          .select('target_rep_min, target_rep_max, rir_target')
          .eq('phase_id', session.phase_id)
          .eq('exercise_id', body.exercise_id)
          // Per-week (migration 011): base + override rows may both match — cap
          // to one so maybeSingle never throws on a customised week.
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const exercise = exerciseRes.data
  const phaseEx = phaseExRes.data

  // ── Compute estimated 1RM (Brzycki + RIR) ─────────────────────────────────
  const estimated1rm: number | null =
    !body.is_warmup && body.weight_kg != null && body.actual_reps != null && rir != null
      ? computeE1RM(body.weight_kg, body.actual_reps, rir)
      : null

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

  // ── Insert set — graceful fallback if estimated_1rm column is missing ──────
  let insertResult = await admin
    .from('workout_sets')
    .insert({ ...basePayload, estimated_1rm: estimated1rm })
    .select('*, exercise:exercises(*)')
    .single()

  if (
    insertResult.error &&
    (insertResult.error.code === '42703' || insertResult.error.message?.includes('estimated_1rm'))
  ) {
    insertResult = await admin
      .from('workout_sets')
      .insert(basePayload)
      .select('*, exercise:exercises(*)')
      .single()
  }

  const { data, error } = insertResult
  if (error) return Response.json({ error: error.message }, { status: 400 })

  // ── Double-progression check ───────────────────────────────────────────────
  let hint: DoubleProgressionHint | null = null
  if (!body.is_warmup && exercise && phaseEx && body.actual_reps != null) {
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

/** GET /api/p/[token]/sessions/[sessionId]/sets */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const { session } = await resolveSession(token, sessionId)
  if (!session) return Response.json({ error: 'Liên kết không hợp lệ hoặc buổi tập không tồn tại' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('workout_sets')
    .select('*, exercise:exercises(*)')
    .eq('session_id', sessionId)
    .order('set_number', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ sets: data })
}

/** PATCH /api/p/[token]/sessions/[sessionId]/sets?set_id=<uuid> */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const { session } = await resolveSession(token, sessionId)
  if (!session) return Response.json({ error: 'Liên kết không hợp lệ hoặc buổi tập không tồn tại' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const setId = searchParams.get('set_id')
  if (!setId) return Response.json({ error: 'set_id query param required' }, { status: 400 })

  const admin = createAdminClient()
  const body = await request.json()

  const { data: currentSet } = await admin
    .from('workout_sets')
    .select('weight_kg, actual_reps, rir, is_warmup')
    .eq('id', setId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (!currentSet) return Response.json({ error: 'Set not found' }, { status: 404 })

  const newWeight   = body.weight_kg   !== undefined ? body.weight_kg   : currentSet.weight_kg
  const newReps     = body.actual_reps !== undefined ? body.actual_reps : currentSet.actual_reps
  const newRir      = body.rir         !== undefined ? body.rir         : currentSet.rir
  const newIsWarmup = body.is_warmup   !== undefined ? body.is_warmup   : currentSet.is_warmup
  const newRpe      = newRir != null ? 10 - newRir : null
  const newE1rm     = !newIsWarmup && newWeight != null && newReps != null && newRir != null
    ? computeE1RM(newWeight, newReps, newRir) : null

  const patch: Record<string, unknown> = {
    weight_kg: newWeight, actual_reps: newReps, rir: newRir,
    rpe: newRpe, is_warmup: newIsWarmup,
  }
  if (body.notes !== undefined) patch.notes = body.notes

  // ── Update set — graceful fallback if estimated_1rm column is missing ──────
  let updateResult = await admin
    .from('workout_sets')
    .update({ ...patch, estimated_1rm: newE1rm })
    .eq('id', setId)
    .eq('session_id', sessionId)
    .select('*, exercise:exercises(*)')
    .single()

  if (
    updateResult.error &&
    (updateResult.error.code === '42703' || updateResult.error.message?.includes('estimated_1rm'))
  ) {
    updateResult = await admin
      .from('workout_sets')
      .update(patch)
      .eq('id', setId)
      .eq('session_id', sessionId)
      .select('*, exercise:exercises(*)')
      .single()
  }

  const { data, error } = updateResult
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ set: data })
}

/** DELETE /api/p/[token]/sessions/[sessionId]/sets?set_id=<uuid> */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params
  const { session } = await resolveSession(token, sessionId)
  if (!session) return Response.json({ error: 'Liên kết không hợp lệ hoặc buổi tập không tồn tại' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const setId = searchParams.get('set_id')
  if (!setId) return Response.json({ error: 'set_id query param required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('workout_sets')
    .delete()
    .eq('id', setId)
    .eq('session_id', sessionId)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
