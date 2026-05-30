import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

/**
 * POST /api/exercises/import
 * Body: JSON array of exercise rows parsed from Excel/CSV on the client.
 * [{ name, movement_pattern_id?, type?, optimal_rep_min?, optimal_rep_max?, description?, muscle_groups? }]
 */
export async function POST(request: Request) {
  try { await requireAdmin() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const rows: Array<Record<string, unknown>> = Array.isArray(body.rows) ? body.rows : []

  if (rows.length === 0) {
    return Response.json({ error: 'No rows provided' }, { status: 400 })
  }

  if (rows.length > 500) {
    return Response.json({ error: 'Max 500 rows per import' }, { status: 400 })
  }

  const VALID_TYPES = ['compound', 'machine', 'cable', 'bodyweight', 'dumbbell']

  const records = rows.map((row, i) => {
    const name = String(row.name ?? '').trim()
    if (!name) throw new Error(`Row ${i + 1}: name is required`)

    const type = VALID_TYPES.includes(String(row.type ?? ''))
      ? (row.type as string)
      : 'compound'

    const muscle_groups = Array.isArray(row.muscle_groups)
      ? row.muscle_groups
      : typeof row.muscle_groups === 'string' && row.muscle_groups.trim()
        ? row.muscle_groups.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []

    return {
      name,
      movement_pattern_id: row.movement_pattern_id || null,
      type,
      optimal_rep_min: Number(row.optimal_rep_min) || 5,
      optimal_rep_max: Number(row.optimal_rep_max) || 20,
      description: row.description ? String(row.description).trim() : null,
      muscle_groups,
    }
  })

  const supabase = await createClient()

  // Upsert by name to avoid duplicates
  const { data, error } = await supabase
    .from('exercises')
    .upsert(records, { onConflict: 'name', ignoreDuplicates: false })
    .select('id, name')

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({
    imported: data?.length ?? 0,
    exercises: data,
  }, { status: 201 })
}
