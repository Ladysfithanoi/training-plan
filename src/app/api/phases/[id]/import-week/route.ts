import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'
import { droppedColumnsNote, insertPhaseExercises } from '@/lib/phaseExerciseInsert'

/**
 * POST /api/phases/[id]/import-week
 * ─────────────────────────────────
 * Fills EVERY buổi tập of ONE week from a single workbook.
 *
 * It sits between the two importers that already existed:
 *   • /exercises/import  → one buổi of one week
 *   • this route         → every buổi of one week   ← nothing else is touched
 *   • /import-program    → every buổi of every week (rewrites the whole meso)
 *
 * The client has already read the file and grouped its rows, so the payload
 * arrives fully resolved:
 *
 *   • split_days — the day slots the meso should end up with. Days that already
 *     exist come back with their existing id (their other weeks stay pinned);
 *     session names the file introduces arrive with a fresh client UUID.
 *   • rows[]     — every row of the week, each tagged with its day_id.
 *
 * Week storage follows migration 011: week_number = N for a week tab, NULL for
 * the "Gốc" set. `mode: 'replace'` therefore only clears rows of THAT scope —
 * every other week of the meso is left exactly as it was, which is the whole
 * point of importing one week at a time.
 *
 * Exercise names behave like the other importers: an existing Kho bài tập entry
 * is reused untouched, an unknown name is created with ONLY its name.
 *
 * The caller finishes the job by POSTing the split config to /commit-days —
 * that endpoint owns workout_days / day_exercises.
 *
 * Body: {
 *   week_number: number | null,             // null = Gốc
 *   mode?: 'replace' | 'append',            // default 'replace' (this week only)
 *   split_type?: 'fullbody' | 'upper_lower' | 'ppl',
 *   split_days: [{ id, type, label }],
 *   rows: [{ day_id, name, target_sets?, target_rep_min?, target_rep_max?,
 *            rir_target?, order_label?, loading_style?, is_warmup?, notes? }]
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
const MAX_DAYS = 14
const MAX_ROWS = 400

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

  // null → the base ("Gốc") scope; 1..52 → that week's override rows.
  let weekNumber: number | null = null
  if (body.week_number != null) {
    const n = Math.round(Number(body.week_number))
    if (!Number.isInteger(n) || n < 1 || n > 52) {
      return Response.json({ error: 'week_number phải là số nguyên 1–52 hoặc null (Gốc).' }, { status: 400 })
    }
    weekNumber = n
  }

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

  const rows: ImportRow[] = (Array.isArray(body.rows) ? body.rows : [])
    .filter((r: ImportRow) => String(r?.name ?? '').trim().length > 0)

  if (rows.length === 0) {
    return Response.json({ error: 'Tệp không có dòng bài tập hợp lệ.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return Response.json({ error: `Tối đa ${MAX_ROWS} dòng mỗi lần nhập (tệp có ${rows.length}).` }, { status: 400 })
  }

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

  // Names the library has never seen, deduped case-insensitively so a name
  // repeated in several buổi only creates one library entry.
  const newNames: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = String(row.name).trim()
    const key  = name.toLowerCase()
    if (byName.has(key) || seen.has(key)) continue
    seen.add(key)
    newNames.push(name)
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

  // ── 3. Clear THIS week only (replace mode) ──────────────────────────────────
  // The file describes the whole week, so the default is a clean slate for that
  // scope — and only that scope. day_exercises rows cascade away with their
  // phase_exercise (migration 009).
  if (mode === 'replace') {
    const scoped = supabase.from('phase_exercises').delete().eq('phase_id', phaseId)
    const { error: wipeError } = await (weekNumber == null
      ? scoped.is('week_number', null)
      : scoped.eq('week_number', weekNumber))

    if (wipeError) {
      if (!isMissingColumnError(wipeError)) {
        return Response.json({ error: wipeError.message }, { status: 400 })
      }
      // No week_number column (pre-migration 011): the phase has exactly one
      // scope, so "Gốc" means every row — but a specific week cannot exist.
      if (weekNumber != null) {
        return Response.json(
          { error: 'Cơ sở dữ liệu chưa hỗ trợ giáo án theo tuần (thiếu cột week_number).' },
          { status: 400 },
        )
      }
      const { error: wipeAllError } = await supabase
        .from('phase_exercises')
        .delete()
        .eq('phase_id', phaseId)
      if (wipeAllError) {
        return Response.json({ error: wipeAllError.message }, { status: 400 })
      }
    }
  }

  // ── 4. Continue existing STT / sort_order sequences ─────────────────────────
  // Keyed by day_id so each buổi of this week continues its own A/B/C run.
  // Empty after a wipe, which is exactly what replace mode wants.
  const counts = new Map<string, number>()
  let nextSortOrder = 1
  {
    const { data: existing } = await supabase
      .from('phase_exercises')
      .select('*')
      .eq('phase_id', phaseId)
    for (const pe of existing ?? []) {
      const row = pe as { week_number?: number | null; day_id?: string | null; sort_order?: number | null }
      nextSortOrder = Math.max(nextSortOrder, (row.sort_order ?? 0) + 1)
      if ((row.week_number ?? null) !== weekNumber) continue
      const key = row.day_id ?? 'none'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  // ── 5. Build every phase_exercises record ───────────────────────────────────
  const base: Record<string, unknown>[]     = []
  const optional: Record<string, unknown>[] = []
  let sortOrder = nextSortOrder

  for (const row of rows) {
    const exerciseId = byName.get(String(row.name).trim().toLowerCase())
    if (!exerciseId) continue   // unreachable: step 2 created every missing name

    // A day_id the payload invented but never declared would orphan the row —
    // pin those to the first day instead so nothing silently disappears.
    const rawDayId = typeof row.day_id === 'string' ? row.day_id : null
    const dayId    = rawDayId && dayIdSet.has(rawDayId) ? rawDayId : splitDays[0].id

    const repMin = toInt(row.target_rep_min, 8, 1, 100)
    const repMax = toInt(row.target_rep_max, 12, 1, 100)
    const explicitLabel = String(row.order_label ?? '').trim().toUpperCase()

    const index = counts.get(dayId) ?? 0
    counts.set(dayId, index + 1)

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
      week_number:           weekNumber,
      sort_order:            sortOrder++,
    })
  }

  const records = base.map((b, i) => ({ ...b, ...optional[i] }))

  // ── 6. Insert, tolerating a DB without the optional columns ─────────────────
  // Degrades one COLUMN at a time (see lib/phaseExerciseInsert) so every row
  // still lands; a missing week_number stops the import instead of dumping this
  // week's rows into the base scope.
  const { error: insertError, dropped } = await insertPhaseExercises(
    async rows => (await supabase.from('phase_exercises').insert(rows)).error,
    records,
  )

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 400 })
  }

  // ── 7. Sync the phase's split config ────────────────────────────────────────
  // The file may have introduced brand-new buổi tập; they must land on the phase
  // before the caller's commit-days call so a failure surfaces as an import error
  // rather than a half-saved config.
  const phasePatch: Record<string, unknown> = { split_days: splitDays }
  if (body.split_type) phasePatch.split_type = body.split_type

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
    week:              weekNumber,
    days:              splitDays.length,
    created_exercises: createdExercises,
    phase,
    exercises:         allRows ?? [],
  }, { status: 201 })
}
