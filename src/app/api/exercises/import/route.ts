import { createClient } from '@/lib/supabase/server'
import { requireContentAuthor } from '@/lib/auth'

/**
 * POST /api/exercises/import
 * ──────────────────────────
 * Bulk-adds exercises to Kho bài tập from a sheet parsed client-side.
 * Body: { rows: [{ name, movement_pattern_id?, type?, optimal_rep_min?,
 *                  optimal_rep_max?, description?, muscle_groups?, video_url? }] }
 *
 * Name collisions are resolved by SKIPPING, never overwriting: a name already in
 * the library keeps whatever a coach curated by hand (type, vùng rep, nhóm cơ,
 * link kỹ thuật), because a spreadsheet is the less trustworthy of the two.
 *
 * NOTE: this used to be a single `upsert(..., { onConflict: 'name' })`, which
 * fails outright — `exercises.name` has no unique constraint (see schema.sql),
 * so Postgres rejects the ON CONFLICT clause with 42P10. Matching by name in
 * application code keeps the endpoint working without a DB migration, and
 * without a unique index that existing duplicate names would block anyway.
 */
export async function POST(request: Request) {
  let profile
  try { profile = await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const rows: Array<Record<string, unknown>> = Array.isArray(body.rows) ? body.rows : []

  if (rows.length === 0) {
    return Response.json({ error: 'No rows provided' }, { status: 400 })
  }

  if (rows.length > 500) {
    return Response.json({ error: 'Max 500 rows per import' }, { status: 400 })
  }

  const VALID_TYPES = ['compound', 'machine', 'cable', 'bodyweight', 'dumbbell', 'resistance_band']

  const supabase = await createClient()

  // ── Existing names ──────────────────────────────────────────────────────────
  const { data: libraryRows, error: libraryError } = await supabase
    .from('exercises')
    .select('name')

  if (libraryError) {
    return Response.json({ error: libraryError.message }, { status: 500 })
  }

  const existingNames = new Set(
    (libraryRows ?? []).map(ex => String(ex.name).trim().toLowerCase()),
  )

  // ── Split into "create" and "skip" ──────────────────────────────────────────
  // `seen` also dedupes within the file itself, so a sheet listing the same name
  // twice creates one entry rather than two identical library rows.
  const seen = new Set<string>()
  const skipped: string[] = []
  const records: Record<string, unknown>[] = []

  for (const [i, row] of rows.entries()) {
    const name = String(row.name ?? '').trim()
    if (!name) {
      return Response.json({ error: `Dòng ${i + 1}: thiếu tên bài tập` }, { status: 400 })
    }

    const key = name.toLowerCase()
    if (existingNames.has(key) || seen.has(key)) {
      skipped.push(name)
      continue
    }
    seen.add(key)

    const type = VALID_TYPES.includes(String(row.type ?? ''))
      ? (row.type as string)
      : 'compound'

    const muscle_groups = Array.isArray(row.muscle_groups)
      ? row.muscle_groups
      : typeof row.muscle_groups === 'string' && row.muscle_groups.trim()
        ? row.muscle_groups.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []

    records.push({
      name,
      movement_pattern_id: row.movement_pattern_id || null,
      type,
      optimal_rep_min: Number(row.optimal_rep_min) || 5,
      optimal_rep_max: Number(row.optimal_rep_max) || 20,
      description: row.description ? String(row.description).trim() : null,
      muscle_groups,
      video_url: row.video_url ? String(row.video_url).trim() : null,
      created_by: profile.id,
    })
  }

  // Every name in the sheet already exists — nothing to write, but not an error.
  if (records.length === 0) {
    return Response.json({
      imported: 0,
      skipped: skipped.length,
      skipped_names: skipped,
      exercises: [],
    }, { status: 200 })
  }

  const { data, error } = await supabase
    .from('exercises')
    .insert(records)
    .select('id, name')

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({
    imported: data?.length ?? 0,
    skipped: skipped.length,
    skipped_names: skipped,
    exercises: data,
  }, { status: 201 })
}
