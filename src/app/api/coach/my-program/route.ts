import { requireStaff } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/my-program
 * Returns the coach's own active user_program (with block + current_phase joined).
 */
export async function GET() {
  let profile
  try { profile = await requireStaff() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('user_programs')
    .select('*, block:training_blocks(*), current_phase:phases(*)')
    .eq('user_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ program: data ?? null })
}

/**
 * POST /api/coach/my-program
 * Activates a training block as the coach's personal program.
 *
 * Body: { block_id: string }
 *
 * - Pauses any previously active program for this coach.
 * - Sets current_phase to the first phase (by phase_order) of the selected block.
 * - Returns the newly created user_program with joins.
 */
export async function POST(request: Request) {
  let profile
  try { profile = await requireStaff() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { block_id } = body as Record<string, unknown>
  if (!block_id || typeof block_id !== 'string') {
    return Response.json({ error: 'block_id is required' }, { status: 400 })
  }

  // Use the service-role client: this writes the caller's OWN program
  // (user_id = profile.id, verified by requireStaff above). RLS on user_programs
  // has no self-insert policy — it only permits admins or coach→own-student rows —
  // so a coach/trial starting their personal program would otherwise hit
  // "new row violates row-level security policy". Ownership is enforced here.
  const supabase = createAdminClient()

  // Pause any existing active program for this coach
  await supabase
    .from('user_programs')
    .update({ status: 'paused' })
    .eq('user_id', profile.id)
    .eq('status', 'active')

  // Resolve the first phase of the chosen block
  const { data: firstPhase } = await supabase
    .from('phases')
    .select('id')
    .eq('block_id', block_id)
    .order('phase_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('user_programs')
    .insert({
      user_id:          profile.id,
      block_id,
      current_phase_id: firstPhase?.id ?? null,
      start_date:       today,
      phase_start_date: today,
      status:           'active',
      assigned_by:      profile.id,
    })
    .select('*, block:training_blocks(*), current_phase:phases(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ program: data }, { status: 201 })
}
