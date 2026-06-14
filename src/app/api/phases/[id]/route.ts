import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/** True when an error is PostgREST/Postgres reporting a missing column (e.g. week_type). */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST204' || err.code === '42703' || !!err.message?.includes('week_type')
}

/** GET /api/phases/[id] — fetch a single phase with its exercises */
export async function GET(_req: Request, ctx: RouteContext<'/api/phases/[id]'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('phases')
    .select('*, phase_exercises(*, exercise:exercises(*, movement_pattern:movement_patterns(*)))')
    .eq('id', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 404 })
  return Response.json({ phase: data })
}

/** PATCH /api/phases/[id] — update a phase (admin only) */
export async function PATCH(request: Request, ctx: RouteContext<'/api/phases/[id]'>) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await request.json()
  const supabase = await createClient()

  const updatePayload: Record<string, unknown> = {}
  if (body.name !== undefined) updatePayload.name = body.name
  if (body.duration_weeks !== undefined) updatePayload.duration_weeks = body.duration_weeks
  if (body.frequency_per_week !== undefined) updatePayload.frequency_per_week = body.frequency_per_week
  if (body.rep_ranges !== undefined) updatePayload.rep_ranges = body.rep_ranges
  if (body.phase_type !== undefined) updatePayload.phase_type = body.phase_type
  if (body.target_set_reduction_factor !== undefined) updatePayload.target_set_reduction_factor = body.target_set_reduction_factor
  if (body.includes_deload !== undefined) updatePayload.includes_deload = body.includes_deload
  if (body.max_rir !== undefined) updatePayload.max_rir = body.max_rir
  if (body.max_weight_percent !== undefined) updatePayload.max_weight_percent = body.max_weight_percent
  // Training split configuration (migration 002)
  // split_days is JSONB NOT NULL DEFAULT '[]' — always coerce to a plain array
  // of { id, type, label } objects so JSON serialisation never passes null /
  // undefined / prototype-chain noise to the Supabase PostgREST schema cache.
  if (body.split_type !== undefined) updatePayload.split_type = body.split_type
  // Week type / training stimulus character (migration 006)
  if (body.week_type !== undefined) updatePayload.week_type = body.week_type
  if (body.split_days !== undefined) {
    updatePayload.split_days = Array.isArray(body.split_days)
      ? (body.split_days as Array<{ id: string; type: string; label: string }>)
          .filter(d => d && typeof d.id === 'string')
          .map(d => ({ id: d.id, type: d.type ?? '', label: d.label ?? '' }))
      : []
  }

  // Attempt 1: update with all requested fields.
  let result = await supabase
    .from('phases')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single()

  // Attempt 2: migration-006 week_type column missing → drop it and retry.
  if (result.error && 'week_type' in updatePayload && isMissingColumnError(result.error)) {
    const stripped = { ...updatePayload }
    delete stripped.week_type
    if (Object.keys(stripped).length > 0) {
      result = await supabase.from('phases').update(stripped).eq('id', id).select('*').single()
    } else {
      result = await supabase.from('phases').select('*').eq('id', id).single()
    }
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 400 })
  return Response.json({ phase: result.data })
}

/** DELETE /api/phases/[id] — delete a phase (admin only) */
export async function DELETE(_req: Request, ctx: RouteContext<'/api/phases/[id]'>) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const supabase = await createClient()

  const { error } = await supabase.from('phases').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return new Response(null, { status: 204 })
}
