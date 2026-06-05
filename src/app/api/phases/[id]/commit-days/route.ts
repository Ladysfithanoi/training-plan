/**
 * POST /api/phases/[id]/commit-days
 * ─────────────────────────────────────────────────────────────────────────────
 * Triggered when the coach clicks "Lưu cấu hình giáo án".
 *
 * This endpoint does THREE things atomically in order:
 *
 *   1. Updates phases.split_type + phases.split_days (keeps the JSONB in sync
 *      with the dedicated relational tables below).
 *
 *   2. Upserts one row per split day into `workout_days`:
 *        • program_id  → training_blocks.id   (phases.block_id)
 *        • phase_id    → phases.id
 *        • day_key     → the UUID stored in split_days[].id (stable identity)
 *        • type / label / day_order from the coach's configuration
 *      Conflict target: (phase_id, day_key) — assumes a UNIQUE constraint.
 *      Rows whose day_key is no longer in the current split are deleted.
 *
 *   3. Upserts one row per assigned exercise into `day_exercises`:
 *        • workout_day_id    → workout_days.id  (resolved via day_key map)
 *        • phase_exercise_id → phase_exercises.id
 *        • order_label / loading_style from the coach's current STT config
 *      Conflict target: (workout_day_id, phase_exercise_id).
 *
 * Uses the service-role admin client so it bypasses RLS on the new tables
 * (which may not have policies yet). The caller must still be staff
 * (requireStaff), and — because RLS is bypassed — coach→own-block ownership is
 * verified explicitly before any DB writes happen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Request body schema:
 * {
 *   split_type:      'fullbody' | 'upper_lower' | 'ppl'
 *   split_days:      Array<{ id: string; type: string; label: string }>
 *   phase_exercises: Array<{
 *     id:           string   // phase_exercise UUID
 *     day_id:       string | null
 *     order_label:  string | null
 *     loading_style:'horizontal' | 'vertical' | null
 *   }>
 * }
 *
 * Response body:
 * { ok: true, workout_days: number, day_exercises: number }
 */

import { createAdminClient } from '@/lib/supabase/server'
import { requireStaff }      from '@/lib/auth'

// ── Local types for the request payload ──────────────────────────────────────

interface SplitDayPayload {
  id:    string
  type:  string
  label: string
}

interface PhaseExercisePayload {
  id:           string
  day_id:       string | null
  order_label:  string | null
  loading_style: string | null
}

interface CommitDaysBody {
  split_type:      string
  split_days:      SplitDayPayload[]
  phase_exercises: PhaseExercisePayload[]
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  let profile
  try { profile = await requireStaff() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: phaseId } = await ctx.params

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: CommitDaysBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { split_type, split_days, phase_exercises = [] } = body

  if (!split_type) {
    return Response.json({ error: 'split_type is required' }, { status: 400 })
  }

  // ── Normalise split_days ──────────────────────────────────────────────────
  // Guard against null / undefined / non-array values so we always write a
  // valid JSON array to the phases.split_days JSONB column (NOT NULL DEFAULT '[]').
  // Each element is explicitly mapped to { id, type, label } — the exact shape
  // the column expects — to strip any extra prototype or React-state properties.
  const safeSplitDays: SplitDayPayload[] = Array.isArray(split_days)
    ? split_days
        .filter((d): d is SplitDayPayload => !!d && typeof d.id === 'string')
        .map(d => ({ id: d.id, type: d.type ?? '', label: d.label ?? '' }))
    : []

  // Use the admin client so new tables without RLS policies are accessible.
  const db = createAdminClient()

  // ── Step 1: Resolve program_id from the phase's parent training_block ─────
  //
  // "programs" does NOT exist as a table. The primary training-plan table
  // is `training_blocks`. workout_days.program_id references training_blocks.id,
  // reached via phases.block_id.
  //
  const { data: phase, error: phaseErr } = await db
    .from('phases')
    .select('id, block_id')
    .eq('id', phaseId)
    .single()

  if (phaseErr || !phase) {
    return Response.json({ error: 'Phase not found' }, { status: 404 })
  }

  const programId = phase.block_id   // → training_blocks.id

  // ── Ownership guard ───────────────────────────────────────────────────────
  // This route uses the service-role client (bypasses RLS), so coach→own-block
  // ownership must be checked explicitly. Admins may edit any block.
  if (profile.role !== 'admin') {
    const { data: block } = await db
      .from('training_blocks')
      .select('created_by')
      .eq('id', programId)
      .maybeSingle()
    if (!block || block.created_by !== profile.id) {
      return Response.json(
        { error: 'Bạn chỉ có thể chỉnh sửa giáo án do chính mình tạo.' },
        { status: 403 },
      )
    }
  }

  // ── Step 2: Persist split config back onto the phase (JSONB sync) ─────────
  // Use the sanitised safeSplitDays (plain objects, guaranteed array) so the
  // Supabase PostgREST serialiser never encounters undefined or prototype keys.
  const { error: patchErr } = await db
    .from('phases')
    .update({
      split_type,
      split_days: safeSplitDays,   // ← always a plain JSON-serialisable array
    })
    .eq('id', phaseId)

  if (patchErr) {
    return Response.json(
      { error: `Phase update failed: ${patchErr.message}` },
      { status: 500 },
    )
  }

  // ── Step 3: Upsert workout_days ───────────────────────────────────────────
  //
  // One row per coach-defined day slot.
  // Conflict target: 'day_key' — the single-column UNIQUE constraint that
  // was created directly in Supabase.  (The earlier composite key
  // 'phase_id,day_key' required a multi-column constraint that does not exist.)
  //
  const dayRows = safeSplitDays.map((day, idx) => ({
    phase_id:   phaseId,
    program_id: programId,   // → training_blocks.id
    day_key:    day.id,      // stable UUID — the unique conflict target
    type:       day.type,
    label:      day.label,
    day_order:  idx,
  }))

  const { data: upsertedDays, error: daysErr } = await db
    .from('workout_days')
    .upsert(dayRows, { onConflict: 'day_key' })   // matches the UNIQUE(day_key) index
    .select('id, day_key')

  if (daysErr) {
    return Response.json(
      { error: `workout_days upsert failed: ${daysErr.message}` },
      { status: 500 },
    )
  }

  // ── Step 4: Delete orphaned workout_days (days the coach removed) ─────────
  //
  // Fetch existing rows for this phase, then delete any whose day_key is no
  // longer present in the current split configuration.
  //
  const { data: existingDays } = await db
    .from('workout_days')
    .select('id, day_key')
    .eq('phase_id', phaseId)

  const activeDayKeySet = new Set(safeSplitDays.map(d => d.id))
  const orphanIds = (existingDays ?? [])
    .filter(wd => !activeDayKeySet.has(wd.day_key))
    .map(wd => wd.id)

  if (orphanIds.length > 0) {
    // Cascade-deletes associated day_exercises automatically (FK → ON DELETE CASCADE)
    await db.from('workout_days').delete().in('id', orphanIds)
  }

  // ── Step 5: Build day_key → workout_day.id lookup map ────────────────────
  const dayKeyToId: Record<string, string> = {}
  for (const wd of upsertedDays ?? []) {
    dayKeyToId[wd.day_key] = wd.id
  }

  // ── Step 6: Upsert day_exercises ──────────────────────────────────────────
  //
  // Only exercises that have been assigned to a day (day_id ≠ null) and
  // whose day_id resolves to a workout_day we just upserted.
  //
  const exercisesToCommit = phase_exercises.filter(
    pe => pe.day_id != null && dayKeyToId[pe.day_id] != null,
  )

  let committedExerciseCount = 0

  if (exercisesToCommit.length > 0) {
    const exerciseRows = exercisesToCommit.map(pe => ({
      workout_day_id:    dayKeyToId[pe.day_id!],
      phase_exercise_id: pe.id,
      order_label:       pe.order_label  ?? null,
      loading_style:     pe.loading_style ?? 'horizontal',
    }))

    const { error: exErr } = await db
      .from('day_exercises')
      .upsert(exerciseRows, { onConflict: 'workout_day_id,phase_exercise_id' })

    if (exErr) {
      return Response.json(
        { error: `day_exercises upsert failed: ${exErr.message}` },
        { status: 500 },
      )
    }

    committedExerciseCount = exerciseRows.length
  }

  // ── Step 7: Persist phase_exercises.day_id (source of truth on reload) ─────
  //
  // The builder reloads exercise→day assignment from phase_exercises.day_id, NOT
  // from day_exercises. Previously this column was never written here, so after a
  // split-type change (which regenerates day UUIDs) every exercise reloaded with
  // a day_id pointing at a now-deleted day → re-orphaned. Write the client's
  // current assignment back so the remap survives a reload.
  //
  // Only persist values that are either null (intentionally unassigned) or point
  // at a day that still exists in the saved config — never write a dangling UUID.
  const dayIdUpdates = phase_exercises.filter(
    pe => pe.day_id == null || activeDayKeySet.has(pe.day_id),
  )

  if (dayIdUpdates.length > 0) {
    const results = await Promise.all(dayIdUpdates.map(pe =>
      db.from('phase_exercises')
        .update({ day_id: pe.day_id })
        .eq('id', pe.id)
        .eq('phase_id', phaseId),
    ))
    const failed = results.find(r => r.error)
    if (failed?.error) {
      return Response.json(
        { error: `phase_exercises.day_id update failed: ${failed.error.message}` },
        { status: 500 },
      )
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────
  return Response.json({
    ok:            true,
    program_id:    programId,
    workout_days:  upsertedDays?.length   ?? 0,
    day_exercises: committedExerciseCount,
    orphans_removed: orphanIds.length,
  })
}
