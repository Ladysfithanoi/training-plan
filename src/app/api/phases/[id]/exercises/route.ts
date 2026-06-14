import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

// Columns added by later migrations — may not exist on the live DB yet.
// 006: is_amrap, target_percentage_1rm   ·   008: sort_order
const OPTIONAL_COLUMNS = ['is_amrap', 'target_percentage_1rm', 'sort_order'] as const

/** True when an error is PostgREST/Postgres reporting a missing column. */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return OPTIONAL_COLUMNS.some(c => err.message?.includes(c))
}

const PE_SELECT = '*, exercise:exercises(*, movement_pattern:movement_patterns(*))'

/** GET /api/phases/[id]/exercises — list exercises assigned to a phase */
export async function GET(_req: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Attempt 1: order by the explicit drag-to-reorder position (migration 008).
  let { data, error } = await supabase
    .from('phase_exercises')
    .select(PE_SELECT)
    .eq('phase_id', id)
    .order('sort_order', { nullsFirst: false })
    .order('order_label', { nullsFirst: true })
    .order('created_at')

  // Attempt 2: sort_order column not deployed yet → fall back to the old order.
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from('phase_exercises')
      .select(PE_SELECT)
      .eq('phase_id', id)
      .order('order_label', { nullsFirst: true })
      .order('created_at'))
  }

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ exercises: data })
}

/** POST /api/phases/[id]/exercises — add an exercise to a phase */
export async function POST(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()

  if (!body.exercise_id) {
    return Response.json({ error: 'exercise_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

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

  // Best-effort: append the new exercise to the end of its (phase, day) by
  // computing the next sort_order. Tolerates the column not existing yet.
  let nextSortOrder: number | undefined
  {
    let q = supabase.from('phase_exercises').select('sort_order').eq('phase_id', id)
    q = base.day_id ? q.eq('day_id', base.day_id) : q.is('day_id', null)
    const { data: rows, error } = await q
    if (!error && rows) {
      nextSortOrder = rows.reduce((m, r) => Math.max(m, (r.sort_order as number | null) ?? 0), 0) + 1
    }
  }

  // Optional columns (migration 006 + 008) — may not be deployed.
  const optional = {
    is_amrap:              body.is_amrap              ?? false,
    target_percentage_1rm: body.target_percentage_1rm ?? null,
    ...(nextSortOrder !== undefined ? { sort_order: nextSortOrder } : {}),
  }

  // Attempt 1: insert with optional columns.
  let result = await supabase.from('phase_exercises').insert({ ...base, ...optional }).select(PE_SELECT).single()

  // Attempt 2: those columns don't exist yet → insert base only.
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase.from('phase_exercises').insert(base).select(PE_SELECT).single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ exercise: result.data }, { status: 201 })
}

/**
 * PATCH /api/phases/[id]/exercises?phase_exercise_id=<uuid>
 * Inline-update any writable field on a specific phase_exercise row.
 */
export async function PATCH(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises'>) {
  try { await requireContentAuthor() } catch {
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
  // Return the joined exercise so the client can refresh the row after an
  // exercise swap (new name / type / movement pattern come back in one trip).
  const sel = PE_SELECT

  // Numeric fields — cast before storing
  const numericFields = [
    'target_sets', 'target_rep_min', 'target_rep_max', 'rir_target',
    // migration 006
    'target_percentage_1rm',
    // migration 008
    'sort_order',
  ]
  // String fields — store as-is (null clears the value)
  const stringFields = ['notes', 'day_id', 'order_label', 'loading_style']
  // Boolean fields (migration 006)
  const booleanFields = ['is_amrap']

  const patch: Record<string, unknown> = {}
  // exercise_id — swapping the underlying exercise. Required NOT NULL, so only
  // apply when a truthy value is supplied (never allow it to be cleared).
  if (body.exercise_id) patch.exercise_id = body.exercise_id
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
    .select(sel)
    .single()

  // Attempt 2: optional (migration 006/008) columns missing → drop them and retry.
  if (result.error && isMissingColumnError(result.error)) {
    const stripped = { ...patch }
    for (const c of OPTIONAL_COLUMNS) delete stripped[c]

    if (Object.keys(stripped).length > 0) {
      result = await supabase
        .from('phase_exercises')
        .update(stripped)
        .eq('id', phaseExerciseId)
        .eq('phase_id', id)
        .select(sel)
        .single()
    } else {
      // Only migration-006 fields were requested — nothing left to persist;
      // return the current row so the UI doesn't error.
      result = await supabase
        .from('phase_exercises')
        .select(sel)
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
  try { await requireContentAuthor() } catch {
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
