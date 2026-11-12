/**
 * POST /api/programs/ai/create
 * ─────────────────────────────────────────────────────────────────────────────
 * "Tạo bằng AI", step 2: save the plan the coach just previewed as a real
 * training block — block → phases (with their split config) → phase_exercises,
 * then the relational workout_days / day_exercises mirror.
 *
 * The plan comes back from the browser, so it is validated again here and every
 * exercise id is checked against Kho bài tập before anything is written.
 *
 * Uses the service-role client for the same reason copyBlock does
 * (workout_days / day_exercises may lack RLS policies). The caller is verified
 * as a content author and created_by is set explicitly, so the new block
 * belongs to whoever created it.
 *
 * Body:     { plan: AiPlan }
 * Response: { block: TrainingBlock & { phases: Phase[] } }   (201)
 */

import { requireContentAuthor } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveUniqueName } from '@/lib/blockName'
import { insertPhaseExercises } from '@/lib/phaseExerciseInsert'
import { orderLabelFor, phaseTypeDefaults, sanitizePlan } from '@/lib/aiBlock'

/** True when an error is PostgREST/Postgres reporting a missing column. */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST204' || err.code === '42703' || !!err.message?.includes('week_type')
}

export async function POST(request: Request) {
  let profile
  try { profile = await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const db = createAdminClient()

  // ── Re-validate the plan against the real exercise library ─────────────────
  const { data: exerciseRows, error: libErr } = await db.from('exercises').select('id, name')
  if (libErr) return Response.json({ error: libErr.message }, { status: 500 })
  const library = new Map((exerciseRows ?? []).map(e => [e.id as string, e.name as string]))

  const { plan } = sanitizePlan((body as { plan?: unknown }).plan, entry => {
    const id = String(entry.exercise_id ?? '')
    const name = library.get(id)
    return name ? { id, name } : null
  })

  if (!plan) {
    return Response.json({ error: 'Khối tập không hợp lệ. Hãy tạo lại bằng AI.' }, { status: 400 })
  }

  // ── Block ──────────────────────────────────────────────────────────────────
  const { data: existingNames } = await db.from('training_blocks').select('name')
  const name = resolveUniqueName(plan.name, existingNames ?? [])
  const trainingPhases = plan.phases.filter(p => p.phase_type === 'training').length

  const { data: block, error: blockErr } = await db
    .from('training_blocks')
    .insert({
      name,
      description:      plan.description,
      total_mesocycles: trainingPhases || plan.phases.length,
      created_by:       profile.id,
    })
    .select()
    .single()

  if (blockErr || !block) {
    return Response.json({ error: blockErr?.message ?? 'Không thể tạo khối tập.' }, { status: 400 })
  }

  /** Remove the half-built block so a failed create never leaves an empty shell. */
  const rollback = () => db.from('training_blocks').delete().eq('id', block.id)

  // ── Phases (ids generated here so exercises + days can reference them) ─────
  const phases = plan.phases.map((p, idx) => {
    const id = crypto.randomUUID()
    const splitDays = p.days.map(d => ({ id: crypto.randomUUID(), type: d.type, label: d.label }))
    return { id, plan: p, splitDays, order: idx + 1 }
  })

  const phaseRows = phases.map(({ id, plan: p, splitDays, order }) => ({
    id,
    block_id:           block.id,
    name:               p.name,
    phase_type:         p.phase_type,
    phase_order:        order,
    duration_weeks:     p.duration_weeks,
    frequency_per_week: p.frequency_per_week,
    rep_ranges:         p.rep_ranges,
    ...phaseTypeDefaults(p.phase_type),
    // A phase without sessions (e.g. a bare active-rest phase) has no split yet.
    split_type:         splitDays.length > 0 ? p.split_type : null,
    split_days:         splitDays,
  }))

  // Attempt 1: include the migration-006 week_type column; attempt 2: without.
  let phaseRes = await db.from('phases').insert(phaseRows.map(r => ({ ...r, week_type: 'standard' })))
  if (phaseRes.error && isMissingColumnError(phaseRes.error)) {
    phaseRes = await db.from('phases').insert(phaseRows)
  }
  if (phaseRes.error) {
    await rollback()
    return Response.json({ error: `Không thể tạo giai đoạn: ${phaseRes.error.message}` }, { status: 400 })
  }

  // ── Phase exercises (base rows — apply to every week of the meso) ──────────
  const peRows: Record<string, unknown>[] = []
  for (const { id: phaseId, plan: p, splitDays } of phases) {
    p.days.forEach((day, dayIdx) => {
      day.exercises.forEach((ex, exIdx) => {
        peRows.push({
          id:             crypto.randomUUID(),
          phase_id:       phaseId,
          exercise_id:    ex.exercise_id,
          target_sets:    ex.sets,
          target_rep_min: ex.rep_min,
          target_rep_max: ex.rep_max,
          rir_target:     ex.rir,
          notes:          ex.note,
          day_of_week:    null,
          day_id:         splitDays[dayIdx].id,
          order_label:    orderLabelFor(exIdx),
          loading_style:  'horizontal',
          // Optional columns — insertPhaseExercises drops any the DB lacks.
          sort_order:            exIdx + 1,
          is_amrap:              false,
          target_percentage_1rm: null,
          is_warmup:             false,
          week_number:           null,
        })
      })
    })
  }

  if (peRows.length > 0) {
    const { error: peErr } = await insertPhaseExercises(
      async rows => (await db.from('phase_exercises').insert(rows)).error,
      peRows,
    )
    if (peErr) {
      await rollback()
      return Response.json({ error: `Không thể ghi bài tập: ${peErr.message ?? ''}` }, { status: 400 })
    }
  }

  // ── workout_days + day_exercises (relational mirror — best-effort) ─────────
  // Same rows POST /api/phases/[id]/commit-days writes when the coach presses
  // "Lưu cấu hình giáo án". phase_exercises.day_id (written above) is the source
  // of truth, so a failure here must not fail the whole create.
  try {
    const dayRows = phases.flatMap(({ id: phaseId, splitDays }) =>
      splitDays.map((day, idx) => ({
        phase_id:   phaseId,
        program_id: block.id,
        day_key:    day.id,
        type:       day.type,
        label:      day.label,
        day_order:  idx,
      })),
    )

    if (dayRows.length > 0) {
      const { data: savedDays, error: daysErr } = await db
        .from('workout_days')
        .upsert(dayRows, { onConflict: 'day_key' })
        .select('id, day_key')

      if (daysErr) {
        console.error('[ai/create] workout_days upsert error:', daysErr)
      } else {
        const dayKeyToId = new Map((savedDays ?? []).map(d => [d.day_key as string, d.id as string]))
        const deRows = peRows
          .map(pe => ({
            workout_day_id:    dayKeyToId.get(pe.day_id as string),
            phase_exercise_id: pe.id,
            order_label:       pe.order_label,
            loading_style:     pe.loading_style,
          }))
          .filter(r => r.workout_day_id)

        if (deRows.length > 0) {
          const { error: deErr } = await db
            .from('day_exercises')
            .upsert(deRows, { onConflict: 'workout_day_id,phase_exercise_id' })
          if (deErr) console.error('[ai/create] day_exercises upsert error:', deErr)
        }
      }
    }
  } catch (err) {
    console.error('[ai/create] relational-mirror write failed (non-fatal):', err)
  }

  // ── Return the new block with its phases (same shape as a normal create) ───
  const { data: fullBlock } = await db
    .from('training_blocks')
    .select('*, phases(*)')
    .eq('id', block.id)
    .single()

  return Response.json({ block: fullBlock }, { status: 201 })
}
