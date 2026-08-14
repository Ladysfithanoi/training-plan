import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/**
 * POST /api/phases/[id]/exercises/import
 * ──────────────────────────────────────
 * Bulk-adds a training day's exercises from a parsed Excel/CSV sheet.
 *
 * Two things happen per row, in this order:
 *   1. The exercise name is resolved against Kho bài tập (exercises table),
 *      case-insensitively. A name that already exists is reused untouched —
 *      the sheet never overwrites a library entry's type / rep zone / muscle
 *      groups, because those are curated by hand.
 *   2. A name that does NOT exist yet is created with ONLY its name; every
 *      other column keeps its DB default so the coach can fill them in later
 *      from Thư viện.
 *
 * Then one phase_exercises row is inserted per sheet row, pinned to the given
 * day_id and week scope.
 *
 * Body: {
 *   day_id?: string | null,
 *   week_number?: number | null,
 *   rows: [{ name, target_sets?, target_rep_min?, target_rep_max?, rir_target?,
 *            order_label?, loading_style?, is_warmup?, notes? }]
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

const MAX_ROWS = 200

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
  target_sets?: unknown
  target_rep_min?: unknown
  target_rep_max?: unknown
  rir_target?: unknown
  order_label?: unknown
  loading_style?: unknown
  is_warmup?: unknown
  notes?: unknown
}

/** Clamp a spreadsheet cell to a sane integer, falling back when it's junk. */
function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function POST(request: Request, ctx: RouteContext<'/api/phases/[id]/exercises/import'>) {
  let profile
  try { profile = await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: phaseId } = await ctx.params
  const body = await request.json().catch(() => ({}))

  const rawRows: ImportRow[] = Array.isArray(body.rows) ? body.rows : []
  const rows = rawRows.filter(r => String(r?.name ?? '').trim().length > 0)

  if (rows.length === 0) {
    return Response.json({ error: 'Không có dòng bài tập hợp lệ.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return Response.json({ error: `Tối đa ${MAX_ROWS} bài tập mỗi lần nhập.` }, { status: 400 })
  }

  const dayId: string | null = body.day_id ?? null
  const weekNumber: number | null =
    body.week_number == null ? null : (Number(body.week_number) || null)

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

  // Names in the sheet that the library has never seen. Deduped case-insensitively
  // so a sheet listing "Squat" twice only ever creates one library entry.
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

  // ── 3. Continue the day's existing STT / sort_order sequence ────────────────
  // Fetch every row of this phase+day and narrow to the week scope in JS, so a
  // DB without the week_number column (migration 011) still behaves sensibly.
  let existingCount  = 0
  let nextSortOrder  = 1
  {
    let q = supabase.from('phase_exercises').select('*').eq('phase_id', phaseId)
    q = dayId ? q.eq('day_id', dayId) : q.is('day_id', null)
    const { data: existing, error } = await q
    if (!error && existing) {
      const scoped = existing.filter(pe => {
        const w = (pe as { week_number?: number | null }).week_number ?? null
        return w === weekNumber
      })
      existingCount = scoped.length
      nextSortOrder = existing.reduce(
        (max, pe) => Math.max(max, ((pe as { sort_order?: number | null }).sort_order) ?? 0),
        0,
      ) + 1
    }
  }

  // ── 4. Build the phase_exercises records ────────────────────────────────────
  const base = rows.map((row, i) => {
    const exerciseId = byName.get(String(row.name).trim().toLowerCase())!
    const repMin = toInt(row.target_rep_min, 8, 1, 100)
    const repMax = toInt(row.target_rep_max, 12, 1, 100)
    const explicitLabel = String(row.order_label ?? '').trim().toUpperCase()

    return {
      phase_id:       phaseId,
      exercise_id:    exerciseId,
      target_sets:    toInt(row.target_sets, 3, 1, 20),
      target_rep_min: Math.min(repMin, repMax),
      target_rep_max: Math.max(repMin, repMax),
      rir_target:     toInt(row.rir_target, 2, 0, 10),
      notes:          String(row.notes ?? '').trim() || null,
      day_of_week:    null,
      day_id:         dayId,
      order_label:    explicitLabel || horizontalLabel(existingCount + i),
      loading_style:  row.loading_style === 'vertical' ? 'vertical' : 'horizontal',
    }
  })

  const optional = rows.map((row, i) => ({
    is_amrap:              false,
    target_percentage_1rm: null,
    is_warmup:             Boolean(row.is_warmup),
    week_number:           weekNumber,
    sort_order:            nextSortOrder + i,
  }))

  const records = base.map((b, i) => ({ ...b, ...optional[i] }))

  // ── 5. Insert, tolerating a DB without the optional columns ─────────────────
  let result = await supabase.from('phase_exercises').insert(records).select(PE_SELECT)

  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase.from('phase_exercises').insert(base).select(PE_SELECT)
  }

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }

  return Response.json({
    added: result.data?.length ?? 0,
    created_exercises: createdExercises,
    exercises: result.data,
  }, { status: 201 })
}
