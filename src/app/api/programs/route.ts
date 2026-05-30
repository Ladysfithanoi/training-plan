import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { PhaseType, RepRange } from '@/types'

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
    profile = await requireAdmin()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, description, preset } = body

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })

  // Use the session-based client — admin RLS policy (is_admin()) allows writes
  const supabase = await createClient()

  // Create block
  const { data: block, error: blockError } = await supabase
    .from('training_blocks')
    .insert({ name, description, created_by: profile.id, total_mesocycles: 3 })
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
