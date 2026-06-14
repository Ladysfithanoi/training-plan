import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/** True when an error is PostgREST/Postgres reporting a missing column (e.g. week_type). */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST204' || err.code === '42703' || !!err.message?.includes('week_type')
}

/**
 * POST /api/phases
 * Create a new blank phase (meso) for an existing training block.
 *
 * Body:
 *   block_id          string  required
 *   name              string  required
 *   phase_type        'training' | 'maintenance' | 'active_rest'  default 'training'
 *   duration_weeks    number  default 4
 *   frequency_per_week number  default 3
 *
 * Returns: { phase: Phase }
 */
export async function POST(request: Request) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const {
    block_id,
    name,
    phase_type        = 'training',
    duration_weeks    = 4,
    frequency_per_week = 3,
  } = body as Record<string, unknown>

  if (!block_id || typeof block_id !== 'string') {
    return Response.json({ error: 'block_id is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Determine the next phase_order for this block (max + 1)
  const { data: existing } = await supabase
    .from('phases')
    .select('phase_order')
    .eq('block_id', block_id)
    .order('phase_order', { ascending: false })
    .limit(1)

  const nextOrder = ((existing?.[0]?.phase_order as number | undefined) ?? 0) + 1

  // Always-present columns (base schema + migration 002 split config)
  const base = {
    block_id,
    name:                      name.trim(),
    phase_type:                phase_type ?? 'training',
    phase_order:               nextOrder,
    duration_weeks:            Number(duration_weeks)     || 4,
    frequency_per_week:        Number(frequency_per_week) || 3,
    rep_ranges:                [{ min: 8, max: 12 }],
    target_set_reduction_factor: 1.0,
    includes_deload:           false,
    max_rir:                   null,
    max_weight_percent:        null,
    split_type:                null,
    split_days:                [],
  }

  // Attempt 1: include the migration-006 week_type column.
  let result = await supabase.from('phases').insert({ ...base, week_type: 'standard' }).select('*').single()

  // Attempt 2: column not deployed yet → insert base only.
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase.from('phases').insert(base).select('*').single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ phase: result.data }, { status: 201 })
}
