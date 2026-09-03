import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'
import { insertPhaseExercises } from '@/lib/phaseExerciseInsert'

const PE_SELECT = '*, exercise:exercises(*, movement_pattern:movement_patterns(*))'

/**
 * POST /api/phases/[id]/weeks   body: { week: number }
 *
 * "Customise" a week by cloning every BASE row (week_number IS NULL) of the
 * phase into new rows tagged week_number = week. Idempotent: if the week is
 * already customised it just returns the existing override rows.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: phaseId } = await ctx.params
  let week: number
  try {
    const body = await request.json()
    week = Number(body.week)
  } catch {
    return Response.json({ error: 'Body phải là JSON' }, { status: 400 })
  }
  if (!Number.isInteger(week) || week < 1) {
    return Response.json({ error: 'week phải là số nguyên ≥ 1' }, { status: 400 })
  }

  const supabase = await createClient()

  // Load every row of the phase; split base vs this week in JS so a not-yet-
  // migrated week_number column can't break the query.
  const { data: allRows, error: fetchErr } = await supabase
    .from('phase_exercises')
    .select('*')
    .eq('phase_id', phaseId)

  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })

  const rows = allRows ?? []
  const alreadyCustom = rows.some(r => (r.week_number ?? null) === week)

  if (!alreadyCustom) {
    const baseRows = rows.filter(r => (r.week_number ?? null) === null)
    if (baseRows.length > 0) {
      // Strip identity / timestamp columns; carry everything else, tagging the week.
      const cloneRows = baseRows.map(r => {
        const { id, created_at, exercise, ...rest } = r as Record<string, unknown>
        void id; void created_at; void exercise
        return { ...rest, week_number: week }
      })

      // Retries without whichever optional column the DB lacks, one at a time.
      // week_number is never dropped here — without it the "copy" would land in
      // the base scope and silently duplicate the Gốc program instead.
      const { error: insertErr } = await insertPhaseExercises(
        async r => (await supabase.from('phase_exercises').insert(r)).error,
        cloneRows as Record<string, unknown>[],
      )
      if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 })
    }
  }

  // Return the full phase rows (joined) so the client can refresh in one trip.
  const { data, error } = await supabase
    .from('phase_exercises')
    .select(PE_SELECT)
    .eq('phase_id', phaseId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ exercises: data ?? [] }, { status: alreadyCustom ? 200 : 201 })
}

/**
 * DELETE /api/phases/[id]/weeks?week=N
 *
 * "Reset" a week: delete its override rows so it falls back to the base program.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: phaseId } = await ctx.params
  const week = Number(new URL(request.url).searchParams.get('week'))
  if (!Number.isInteger(week) || week < 1) {
    return Response.json({ error: 'week phải là số nguyên ≥ 1' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('phase_exercises')
    .delete()
    .eq('phase_id', phaseId)
    .eq('week_number', week)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data } = await supabase
    .from('phase_exercises')
    .select(PE_SELECT)
    .eq('phase_id', phaseId)

  return Response.json({ exercises: data ?? [] })
}
