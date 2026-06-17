import { requireContentAuthor } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { PhaseType, RepRange } from '@/types'

/**
 * Resolve a non-colliding block name. If `desired` already exists, strip any
 * trailing " (n)" suffix to get the base, then append the lowest free
 * " (2)", " (3)", … so copies/duplicates stay distinguishable.
 */
function resolveUniqueName(desired: string, existing: { name: string }[]): string {
  const names = new Set(existing.map(b => b.name))
  if (!names.has(desired)) return desired
  const base = desired.replace(/\s*\(\d+\)$/, '')
  let n = 2
  while (names.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

/**
 * Deep-copy an existing training block into a brand-new block owned by `userId`.
 * Copies phases → phase_exercises → workout_days → day_exercises, regenerating
 * every primary key and every split_days day-key so the copy is fully
 * independent of the source (no shared rows, no UNIQUE(day_key) collision).
 *
 * Uses the service-role client because workout_days / day_exercises may lack RLS
 * policies (see /api/phases/[id]/commit-days). The caller is already verified as
 * a content author and the new block's created_by is set explicitly, so
 * ownership is preserved: the copy belongs to whoever created it.
 */
async function copyBlock(
  sourceId: string,
  newName: string,
  description: string | null,
  userId: string,
): Promise<Response> {
  const db = createAdminClient()

  // ── Source block ───────────────────────────────────────────────────────────
  const { data: src, error: srcErr } = await db
    .from('training_blocks')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (srcErr || !src) {
    return Response.json({ error: 'Khối tập nguồn không tồn tại.' }, { status: 404 })
  }

  // ── New block ────────────────────────────────────────────────────────────
  const { data: block, error: blockErr } = await db
    .from('training_blocks')
    .insert({
      name:             newName,
      description:       description ?? src.description ?? null,
      total_mesocycles: src.total_mesocycles ?? 3,
      created_by:       userId,
    })
    .select()
    .single()

  if (blockErr || !block) {
    return Response.json({ error: blockErr?.message ?? 'Không thể tạo khối tập.' }, { status: 400 })
  }

  // ── Phases (regenerate ids + split_days day-keys) ──────────────────────────
  const { data: srcPhases } = await db
    .from('phases')
    .select('*')
    .eq('block_id', sourceId)

  const phaseIdMap  = new Map<string, string>()   // old phase id → new phase id
  const dayKeyMap   = new Map<string, string>()   // old day_key  → new day_key

  if (srcPhases && srcPhases.length > 0) {
    const phaseRows = srcPhases.map(p => {
      const newPhaseId = crypto.randomUUID()
      phaseIdMap.set(p.id, newPhaseId)

      const { id: _id, created_at: _ca, block_id: _bid, split_days, ...rest } = p
      void _id; void _ca; void _bid
      const newSplitDays = Array.isArray(split_days)
        ? split_days.map((d: { id: string }) => {
            const newKey = crypto.randomUUID()
            dayKeyMap.set(d.id, newKey)
            return { ...d, id: newKey }
          })
        : (split_days ?? [])

      return { ...rest, id: newPhaseId, block_id: block.id, split_days: newSplitDays }
    })

    const { error: phaseErr } = await db.from('phases').insert(phaseRows)
    if (phaseErr) {
      // Roll back the orphan block so a failed copy doesn't leave an empty shell.
      await db.from('training_blocks').delete().eq('id', block.id)
      return Response.json({ error: `Không thể sao chép giai đoạn: ${phaseErr.message}` }, { status: 400 })
    }
  }

  // ── Phase exercises (remap phase_id + day_id) ──────────────────────────────
  const peIdMap = new Map<string, string>()   // old phase_exercise id → new id

  if (phaseIdMap.size > 0) {
    const { data: srcPEs } = await db
      .from('phase_exercises')
      .select('*')
      .in('phase_id', [...phaseIdMap.keys()])

    if (srcPEs && srcPEs.length > 0) {
      const peRows = srcPEs.map(pe => {
        const newId = crypto.randomUUID()
        peIdMap.set(pe.id, newId)
        const { id: _id, created_at: _ca, phase_id, day_id, ...rest } = pe
        void _id; void _ca
        return {
          ...rest,
          id:       newId,
          phase_id: phaseIdMap.get(phase_id),
          day_id:   day_id != null ? (dayKeyMap.get(day_id) ?? null) : null,
        }
      })

      const { error: peErr } = await db.from('phase_exercises').insert(peRows)
      if (peErr) {
        await db.from('training_blocks').delete().eq('id', block.id)
        return Response.json({ error: `Không thể sao chép bài tập: ${peErr.message}` }, { status: 400 })
      }
    }
  }

  // ── workout_days + day_exercises (relational mirror — best-effort) ─────────
  // These tables were created by hand in Supabase and may drift / lack columns.
  // The reload source of truth is phase_exercises.day_id (already copied above),
  // so a failure here must not fail the whole copy.
  try {
    if (phaseIdMap.size > 0) {
      const { data: srcDays } = await db
        .from('workout_days')
        .select('*')
        .in('phase_id', [...phaseIdMap.keys()])

      if (srcDays && srcDays.length > 0) {
        const dayIdMap = new Map<string, string>()   // old workout_day id → new id
        const dayRows = srcDays.map(wd => {
          const newId = crypto.randomUUID()
          dayIdMap.set(wd.id, newId)
          const { id: _id, created_at: _ca, phase_id, program_id: _pid, day_key, ...rest } = wd
          void _id; void _ca; void _pid
          return {
            ...rest,
            id:         newId,
            phase_id:   phaseIdMap.get(phase_id),
            program_id: block.id,
            day_key:    dayKeyMap.get(day_key) ?? crypto.randomUUID(),
          }
        })

        const { error: daysErr } = await db.from('workout_days').insert(dayRows)
        if (daysErr) {
          console.error('copyBlock workout_days insert error:', daysErr)
        } else {
          const { data: srcDE } = await db
            .from('day_exercises')
            .select('*')
            .in('workout_day_id', srcDays.map(d => d.id))

          if (srcDE && srcDE.length > 0) {
            const deRows = srcDE
              .map(de => {
                const { id: _id, created_at: _ca, workout_day_id, phase_exercise_id, ...rest } = de
                void _id; void _ca
                return {
                  ...rest,
                  workout_day_id:    dayIdMap.get(workout_day_id),
                  phase_exercise_id: peIdMap.get(phase_exercise_id),
                }
              })
              .filter(r => r.workout_day_id && r.phase_exercise_id)

            if (deRows.length > 0) {
              const { error: deErr } = await db.from('day_exercises').insert(deRows)
              if (deErr) console.error('copyBlock day_exercises insert error:', deErr)
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('copyBlock relational-mirror copy failed (non-fatal):', err)
  }

  // ── Return the new block with its phases (same shape as a fresh create) ────
  const { data: fullBlock } = await db
    .from('training_blocks')
    .select('*, phases(*)')
    .eq('id', block.id)
    .single()

  return Response.json({ block: fullBlock }, { status: 201 })
}

const PRESETS: Record<string, {
  name: string
  phase_type: PhaseType
  duration_weeks: number
  frequency_per_week: number
  rep_ranges: RepRange[]
  target_set_reduction_factor: number
  includes_deload: boolean
  max_rir: number | null
  max_weight_percent: number | null
}[]> = {
  classic_3_meso: [
    {
      name: 'Meso 1 — Foundation',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 2,
      rep_ranges: [{ min: 5, max: 10 }],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Meso 2 — Accumulation',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 3,
      rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Meso 3 — Intensification',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 4,
      rep_ranges: [
        { min: 5, max: 10 },
        { min: 10, max: 20, exercise_type: 'machine' },
        { min: 20, max: 30, exercise_type: 'cable' },
      ],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Maintenance',
      phase_type: 'maintenance',
      duration_weeks: 3,
      frequency_per_week: 2,
      rep_ranges: [{ min: 5, max: 10 }],
      target_set_reduction_factor: 0.333,
      includes_deload: true,
      max_rir: null,
      max_weight_percent: null,
    },
  ],
  active_rest_block: [
    {
      name: 'Meso 1 — Foundation',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 2,
      rep_ranges: [{ min: 5, max: 10 }],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Meso 2 — Accumulation',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 3,
      rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Meso 3 — Intensification',
      phase_type: 'training',
      duration_weeks: 4,
      frequency_per_week: 4,
      rep_ranges: [
        { min: 5, max: 10 },
        { min: 10, max: 20, exercise_type: 'machine' },
        { min: 20, max: 30, exercise_type: 'cable' },
      ],
      target_set_reduction_factor: 1.0,
      includes_deload: false,
      max_rir: null,
      max_weight_percent: null,
    },
    {
      name: 'Active Rest',
      phase_type: 'active_rest',
      duration_weeks: 2,
      frequency_per_week: 2,
      rep_ranges: [],
      target_set_reduction_factor: 0.5,
      includes_deload: false,
      max_rir: 10,
      max_weight_percent: 0.5,
    },
  ],
}

/** GET /api/programs — list all training blocks */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('training_blocks')
    .select('*, phases(*)')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ blocks: data })
}

/** POST /api/programs — create a training block (optionally with preset phases) */
export async function POST(request: Request) {
  let profile
  try {
    profile = await requireContentAuthor()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, description, preset, copy_from } = body

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })

  // Use the session-based client — admin RLS policy (is_admin()) allows writes
  const supabase = await createClient()

  // ── Name de-duplication ───────────────────────────────────────────────────
  // Blocks are shared-read, so this lists every block's name. A colliding name
  // gets the lowest free " (n)" suffix; a unique name is saved as-is.
  const { data: existingNames } = await supabase.from('training_blocks').select('name')
  const uniqueName = resolveUniqueName(name.trim(), existingNames ?? [])

  // ── Copy mode ─────────────────────────────────────────────────────────────
  // Deep-copy an existing block (phases + exercises + day config) into a new
  // block owned by the current user.
  if (copy_from) {
    return copyBlock(copy_from, uniqueName, description ?? null, profile.id)
  }

  // Create block
  const { data: block, error: blockError } = await supabase
    .from('training_blocks')
    .insert({ name: uniqueName, description, created_by: profile.id, total_mesocycles: 3 })
    .select()
    .single()

  if (blockError) return Response.json({ error: blockError.message }, { status: 400 })

  // Create phases from preset
  if (preset && PRESETS[preset]) {
    const phaseRows = PRESETS[preset].map((ph, idx) => ({
      ...ph,
      block_id: block.id,
      phase_order: idx + 1,
    }))

    const { error: phaseError } = await supabase.from('phases').insert(phaseRows)
    if (phaseError) {
      // Don't fail — block was created, phases might be added later
      console.error('Phase insert error:', phaseError)
    }
  }

  // Return block with phases
  const { data: fullBlock } = await supabase
    .from('training_blocks')
    .select('*, phases(*)')
    .eq('id', block.id)
    .single()

  return Response.json({ block: fullBlock }, { status: 201 })
}
