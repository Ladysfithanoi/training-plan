import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'
import { droppedColumnsNote, insertPhaseExercises } from '@/lib/phaseExerciseInsert'

/**
 * POST /api/phases/[id]/import-program
 * ────────────────────────────────────
 * Fills an ENTIRE meso from a multi-sheet workbook in one shot: each sheet of
 * the Excel file is one training week, and a "Buổi tập" column inside a sheet
 * splits its rows into training days.
 *
 * This is the meso-level sibling of /exercises/import (which fills exactly one
 * day of one week). The client has already done all the reading + grouping, so
 * the payload arrives fully resolved:
 *
 *   • split_days — the day slots the meso should end up with. Days the coach
 *     already had are passed back with their existing id (so their exercises
 *     stay pinned); brand-new session names arrive with a fresh client UUID.
 *   • weeks[]    — one entry per sheet, rows already tagged with a day_id.
 *
 * Week storage follows migration 011:
 *   • rows of week W  → phase_exercises with week_number = W (override rows)
 *   • rows of base_week are ALSO written with week_number = NULL (base rows) so
 *     "Gốc" is never empty and any week past the last sheet still resolves to a
 *     sensible program (see lib/phaseWeeks.resolveWeekExercises).
 *
 * Exercise names behave exactly like the single-day import: an existing Kho bài
 * tập entry is reused untouched, an unknown name is created with ONLY its name.
 *
 * The caller finishes the job by POSTing the returned split config to
 * /commit-days — that endpoint owns workout_days / day_exercises.
 *
 * Body: {
 *   mode?: 'replace' | 'append',            // default 'replace'
 *   split_type: 'fullbody' | 'upper_lower' | 'ppl',
 *   split_days: [{ id, type, label }],
 *   base_week?: number,                     // default 1
 *   set_duration?: boolean,                 // sync phases.duration_weeks to sheet count
 *   set_frequency?: boolean,                // sync phases.frequency_per_week to day count
 *   weeks: [{ week: number, rows: ImportRow[] }]
 * }
 */

// Columns added by later migrations — may not exist on the live DB yet.
// 006: is_amrap, target_percentage_1rm · 008: sort_order · 011: week_number · 012: is_warmup
const OPTIONAL_COLUMNS = ['is_amrap', 'target_percentage_1rm', 'sort_order', 'week_number', 'is_warmup'] as const

/** True when an error is PostgREST/Postgres reporting a missing column. */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return OPTIONAL_COLUMNS.some(c => err.message?.includes(c))
}

const PE_SELECT = '*, exercise:exercises(*, movement_pattern:movement_patterns(*))'

/** Hard ceilings — a spreadsheet typo should never turn into a 10k-row insert. */
const MAX_WEEKS = 26
const MAX_DAYS  = 14
const MAX_ROWS  = 1200

/**
 * Horizontal STT label for the nth exercise of a day
 * (0 → 'A', 1 → 'B', … 25 → 'Z', 26 → 'A2', …). Mirrors the builder's
 * computeHorizontalLabel so imported rows continue the same sequence.
 */
function horizontalLabel(index: number): string {
  const letter = index % 26
  const cycle  = Math.floor(index / 26)
  return cycle > 0
    ? `${String.fromCharCode(65 + letter)}${cycle + 1}`
    : String.fromCharCode(65 + letter)
}

interface ImportRow {
  name: string
  day_id?: unknown
  target_sets?: unknown
  target_rep_min?: unknown
  target_rep_max?: unknown
  rir_target?: unknown
  order_label?: unknown
  loading_style?: unknown
  is_warmup?: unknown
  notes?: unknown
}

interface WeekPayload {
  week: number
  rows: ImportRow[]
}

interface SplitDayPayload {
  id:    string
  type:  string
  label: string
}

/** Clamp a spreadsheet cell to a sane integer, falling back when it's junk. */
function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let profile
  try { profile = await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: phaseId } = await ctx.params
  const body = await request.json().catch(() => ({}))

  // ── 0. Validate the payload ─────────────────────────────────────────────────
  const mode: 'replace' | 'append' = body.mode === 'append' ? 'append' : 'replace'

  const splitDays: SplitDayPayload[] = Array.isArray(body.split_days)
    ? (body.split_days as SplitDayPayload[])
        .filter(d => !!d && typeof d.id === 'string')
        .map(d => ({ id: d.id, type: d.type ?? 'other', label: d.label ?? '' }))
    : []

  if (splitDays.length === 0) {
    return Response.json({ error: 'Không xác định được buổi tập nào trong tệp.' }, { status: 400 })
  }
  if (splitDays.length > MAX_DAYS) {
    return Response.json({ error: `Tối đa ${MAX_DAYS} buổi tập mỗi giáo án.` }, { status: 400 })
  }

  const dayIdSet = new Set(splitDays.map(d => d.id))

  const weeks: WeekPayload[] = (Array.isArray(body.weeks) ? body.weeks : [])
    .map((w: { week?: unknown; rows?: unknown }) => ({
      week: Math.round(Number(w?.week)),
      rows: (Array.isArray(w?.rows) ? w.rows : [])
        .filter((r: ImportRow) => String(r?.name ?? '').trim().length > 0),
    }))
    .filter((w: WeekPayload) => Number.isInteger(w.week) && w.week >= 1 && w.rows.length > 0)
    .sort((a: WeekPayload, b: WeekPayload) => a.week - b.week)

  if (weeks.length === 0) {
    return Response.json({ error: 'Tệp không có tuần nào chứa bài tập hợp lệ.' }, { status: 400 })
  }
  if (weeks.length > MAX_WEEKS) {
    return Response.json({ error: `Tối đa ${MAX_WEEKS} tuần mỗi lần nhập.` }, { status: 400 })
  }

  const totalRows = weeks.reduce((n, w) => n + w.rows.length, 0)
  if (totalRows > MAX_ROWS) {
    return Response.json({ error: `Tối đa ${MAX_ROWS} dòng mỗi lần nhập (tệp có ${totalRows}).` }, { status: 400 })
  }

  // The week whose rows are duplicated into the base (week_number NULL) scope.
  const requestedBaseWeek = Math.round(Number(body.base_week))
  const baseWeek = weeks.some(w => w.week === requestedBaseWeek)
    ? requestedBaseWeek
    : weeks[0].week

  const supabase = await createClient()

  // ── 1. Resolve names against Kho bài tập ────────────────────────────────────
  const { data: libraryRows, error: libraryError } = await supabase
    .from('exercises')
    .select('id, name')

  if (libraryError) {
    return Response.json({ error: libraryError.message }, { status: 500 })
  }

  /** lowercase name → exercise id */
  const byName = new Map<string, string>()
  for (const ex of libraryRows ?? []) {
    byName.set(String(ex.name).trim().toLowerCase(), ex.id as string)
  }

  // Names the library has never seen, deduped case-insensitively across ALL weeks
  // so a name repeated in every sheet only creates one library entry.
  const newNames: string[] = []
  const seen = new Set<string>()
  for (const week of weeks) {
    for (const row of week.rows) {
      const name = String(row.name).trim()
      const key  = name.toLowerCase()
      if (byName.has(key) || seen.has(key)) continue
      seen.add(key)
      newNames.push(name)
    }
  }

  // ── 2. Create the missing ones — NAME ONLY ──────────────────────────────────
  // Everything else (type, rep zone, muscle groups, video) keeps its DB default;
  // the coach fills those in by hand from Thư viện afterwards.
  let createdExercises: { id: string; name: string }[] = []
  if (newNames.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from('exercises')
      .insert(newNames.map(name => ({ name, created_by: profile.id })))
      .select('id, name')

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 })
    }

    createdExercises = (inserted ?? []) as { id: string; name: string }[]
    for (const ex of createdExercises) {
      byName.set(ex.name.trim().toLowerCase(), ex.id)
    }
  }

  // ── 3. Clear the meso (replace mode) ────────────────────────────────────────
  // A whole-program import describes the meso in full, so the default is a clean
  // slate. day_exercises rows cascade away with their phase_exercise (mig 009).
  if (mode === 'replace') {
    const { error: wipeError } = await supabase
      .from('phase_exercises')
      .delete()
      .eq('phase_id', phaseId)
    if (wipeError) {
      return Response.json({ error: wipeError.message }, { status: 400 })
    }
  }

  // ── 4. Continue existing STT / sort_order sequences (append mode) ───────────
  // Keyed by `${week_number}|${day_id}` so each (week, day) bucket continues its
  // own A/B/C run. Empty after a wipe, which is exactly what replace mode wants.
  const counts = new Map<string, number>()
  let nextSortOrder = 1
  if (mode === 'append') {
    const { data: existing } = await supabase
      .from('phase_exercises')
      .select('*')
      .eq('phase_id', phaseId)
    for (const pe of existing ?? []) {
      const row = pe as { week_number?: number | null; day_id?: string | null; sort_order?: number | null }
      const key = `${row.week_number ?? 'base'}|${row.day_id ?? 'none'}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      nextSortOrder = Math.max(nextSortOrder, (row.sort_order ?? 0) + 1)
    }
  }

  // ── 5. Build every phase_exercises record ───────────────────────────────────
  // One pass per (scope, week): the base scope repeats baseWeek's rows so "Gốc"
  // mirrors the first imported week, then each sheet becomes its own override.
  interface Scope { week: number | null; rows: ImportRow[] }
  const scopes: Scope[] = [
    { week: null, rows: weeks.find(w => w.week === baseWeek)!.rows },
    ...weeks.map(w => ({ week: w.week as number | null, rows: w.rows })),
  ]

  const base: Record<string, unknown>[]     = []
  const optional: Record<string, unknown>[] = []
  let sortOrder = nextSortOrder

  for (const scope of scopes) {
    for (const row of scope.rows) {
      const exerciseId = byName.get(String(row.name).trim().toLowerCase())
      if (!exerciseId) continue   // unreachable: step 2 created every missing name

      // A day_id the payload invented but never declared would orphan the row —
      // pin those to the first day instead so nothing silently disappears.
      const rawDayId = typeof row.day_id === 'string' ? row.day_id : null
      const dayId    = rawDayId && dayIdSet.has(rawDayId) ? rawDayId : splitDays[0].id

      const repMin = toInt(row.target_rep_min, 8, 1, 100)
      const repMax = toInt(row.target_rep_max, 12, 1, 100)
      const explicitLabel = String(row.order_label ?? '').trim().toUpperCase()

      const key   = `${scope.week ?? 'base'}|${dayId}`
      const index = counts.get(key) ?? 0
      counts.set(key, index + 1)

      base.push({
        phase_id:       phaseId,
        exercise_id:    exerciseId,
        target_sets:    toInt(row.target_sets, 3, 1, 20),
        target_rep_min: Math.min(repMin, repMax),
        target_rep_max: Math.max(repMin, repMax),
        rir_target:     toInt(row.rir_target, 2, 0, 10),
        notes:          String(row.notes ?? '').trim() || null,
        day_of_week:    null,
        day_id:         dayId,
        order_label:    explicitLabel || horizontalLabel(index),
        loading_style:  row.loading_style === 'vertical' ? 'vertical' : 'horizontal',
      })

      optional.push({
        is_amrap:              false,
        target_percentage_1rm: null,
        is_warmup:             Boolean(row.is_warmup),
        week_number:           scope.week,
        sort_order:            sortOrder++,
      })
    }
  }

  const records = base.map((b, i) => ({ ...b, ...optional[i] }))

  // ── 6. Insert, tolerating a DB without the optional columns ─────────────────
  // Degrades one COLUMN at a time (see lib/phaseExerciseInsert): every row of
  // every week still lands. A DB with no week_number at all stops the import
  // rather than flattening the weeks into copies of the base program.
  const { error: insertError, dropped } = await insertPhaseExercises(
    async rows => (await supabase.from('phase_exercises').insert(rows)).error,
    records,
  )

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 400 })
  }

  // ── 7. Sync the phase's own configuration ───────────────────────────────────
  // split_type / split_days must land before the caller's commit-days call so a
  // failure here surfaces as an import error rather than a half-saved config.
  const phasePatch: Record<string, unknown> = {
    split_days: splitDays,
  }
  if (body.split_type) phasePatch.split_type = body.split_type
  if (body.set_duration)  phasePatch.duration_weeks     = weeks[weeks.length - 1].week
  if (body.set_frequency) phasePatch.frequency_per_week = splitDays.length

  const { data: phase, error: phaseError } = await supabase
    .from('phases')
    .update(phasePatch)
    .eq('id', phaseId)
    .select('*')
    .single()

  if (phaseError) {
    return Response.json({ error: phaseError.message }, { status: 400 })
  }

  // ── 8. Hand the caller the meso's full, ordered state ───────────────────────
  let { data: allRows, error: readError } = await supabase
    .from('phase_exercises')
    .select(PE_SELECT)
    .eq('phase_id', phaseId)
    .order('sort_order', { nullsFirst: false })
    .order('order_label', { nullsFirst: true })
    .order('created_at')

  if (readError && isMissingColumnError(readError)) {
    ({ data: allRows, error: readError } = await supabase
      .from('phase_exercises')
      .select(PE_SELECT)
      .eq('phase_id', phaseId)
      .order('order_label', { nullsFirst: true })
      .order('created_at'))
  }

  if (readError) {
    return Response.json({ error: readError.message }, { status: 500 })
  }

  return Response.json({
    added:             records.length,
    dropped_columns:   dropped,
    dropped_note:      droppedColumnsNote(dropped),
    weeks:             weeks.map(w => w.week),
    days:              splitDays.length,
    created_exercises: createdExercises,
    phase,
    exercises:         allRows ?? [],
  }, { status: 201 })
}
