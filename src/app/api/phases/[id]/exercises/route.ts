import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

// Columns added by migration 006 — may not exist on the live DB yet.
const MIGRATION_006_COLUMNS = ['is_amrap', 'target_percentage_1rm'] as const

/** True when an error is PostgREST/Postgres reporting a missing column. */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return MIGRATION_006_COLUMNS.some(c => err.message?.includes(c))
}

/** GET /api/phases/[id]/exercises — list exercises assigned to a phase */
export async function GET(_req: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('phase_exercises')
    .select('*, exercise:exercises(*, movement_pattern:movement_patterns(*))')
    .eq('phase_id', id)
    .order('order_label', { nullsFirst: true })
    .order('created_at')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ exercises: data })
}

/** POST /api/phases/[id]/exercises — add an exercise to a phase */
export async function POST(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()

  if (!body.exercise_id) {
    return Response.json({ error: 'exercise_id is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const sel = '*, exercise:exercises(*, movement_pattern:movement_patterns(*))'

  // Always-present columns (base schema + migration 005)
  const base = {
    phase_id:      id,
    exercise_id:   body.exercise_id,
    target_sets:   body.target_sets   ?? 3,
    target_rep_min: body.target_rep_min ?? 8,
    target_rep_max: body.target_rep_max ?? 12,
    rir_target:    body.rir_target    ?? 2,
    notes:         body.notes         ?? null,
    day_of_week:   body.day_of_week   ?? null,
    day_id:        body.day_id        ?? null,
    order_label:   body.order_label   ?? null,
    loading_style: body.loading_style ?? 'horizontal',
  }
  // Migration 006 columns (may not be deployed)
  const meta006 = {
    is_amrap:              body.is_amrap              ?? false,
    target_percentage_1rm: body.target_percentage_1rm ?? null,
  }

  // Attempt 1: insert with migration-006 columns.
  let result = await supabase.from('phase_exercises').insert({ ...base, ...meta006 }).select(sel).single()

  // Attempt 2: those columns don't exist yet → insert base only.
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase.from('phase_exercises').insert(base).select(sel).single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ exercise: result.data }, { status: 201 })
}

/**
 * PATCH /api/phases/[id]/exercises?phase_exercise_id=<uuid>
 * Inline-update any writable field on a specific phase_exercise row.
 */
export async function PATCH(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const phaseExerciseId = searchParams.get('phase_exercise_id')

  if (!phaseExerciseId) {
    return Response.json({ error: 'phase_exercise_id query param required' }, { status: 400 })
  }

  const body = await request.json()
  const supabase = await createClient()

  // Numeric fields — cast before storing
  const numericFields = [
    'target_sets', 'target_rep_min', 'target_rep_max', 'rir_target',
    // migration 006
    'target_percentage_1rm',
  ]
  // String fields — store as-is (null clears the value)
  const stringFields = ['notes', 'day_id', 'order_label', 'loading_style']
  // Boolean fields (migration 006)
  const booleanFields = ['is_amrap']

  const patch: Record<string, unknown> = {}
  for (const k of numericFields) {
    if (k in body) patch[k] = body[k] ?? null   // allow null to clear %1RM
  }
  for (const k of stringFields) {
    if (k in body) patch[k] = body[k] ?? null
  }
  for (const k of booleanFields) {
    if (k in body) patch[k] = Boolean(body[k])
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Attempt 1: update with all requested fields.
  let result = await supabase
    .from('phase_exercises')
    .update(patch)
    .eq('id', phaseExerciseId)
    .eq('phase_id', id)
    .select('*')
    .single()

  // Attempt 2: migration-006 columns missing → drop them and retry.
  if (result.error && isMissingColumnError(result.error)) {
    const stripped = { ...patch }
    for (const c of MIGRATION_006_COLUMNS) delete stripped[c]

    if (Object.keys(stripped).length > 0) {
      result = await supabase
        .from('phase_exercises')
        .update(stripped)
        .eq('id', phaseExerciseId)
        .eq('phase_id', id)
        .select('*')
        .single()
    } else {
      // Only migration-006 fields were requested — nothing left to persist;
      // return the current row so the UI doesn't error.
      result = await supabase
        .from('phase_exercises')
        .select('*')
        .eq('id', phaseExerciseId)
        .eq('phase_id', id)
        .single()
    }
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ exercise: result.data })
}

/** DELETE /api/phases/[id]/exercises?phase_exercise_id=<uuid> — remove from phase */
export async function DELETE(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const phaseExerciseId = searchParams.get('phase_exercise_id')

  if (!phaseExerciseId) {
    return Response.json({ error: 'phase_exercise_id query param required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('phase_exercises')
    .delete()
    .eq('id', phaseExerciseId)
    .eq('phase_id', id)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
