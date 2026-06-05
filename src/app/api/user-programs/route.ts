import { requireStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/** POST /api/user-programs — assign a training block to a user */
export async function POST(request: Request) {
  let profile
  try {
    profile = await requireStaff()
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { user_id, block_id, start_date, notes } = await request.json()

  if (!user_id || !block_id) {
    return Response.json({ error: 'user_id and block_id are required' }, { status: 400 })
  }

  // Use session-based client — RLS "Staff manage user programs" policy applies.
  const supabase = await createClient()

  // Coaches may only assign to students they created. (RLS also enforces this;
  // the explicit check gives a clearer error than a WITH-CHECK violation.)
  if (profile.role !== 'admin') {
    const { data: student } = await supabase
      .from('profiles')
      .select('created_by')
      .eq('id', user_id)
      .maybeSingle()
    if (!student || student.created_by !== profile.id) {
      return Response.json(
        { error: 'Bạn chỉ có thể giao giáo án cho học viên của mình.' },
        { status: 403 },
      )
    }
  }

  // Pause any existing active program for this user
  await supabase
    .from('user_programs')
    .update({ status: 'paused' })
    .eq('user_id', user_id)
    .eq('status', 'active')

  // Get the first phase of this block
  const { data: firstPhase } = await supabase
    .from('phases')
    .select('id')
    .eq('block_id', block_id)
    .order('phase_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  const effectiveStartDate = start_date ?? new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('user_programs')
    .insert({
      user_id,
      block_id,
      current_phase_id: firstPhase?.id ?? null,
      start_date: effectiveStartDate,
      phase_start_date: effectiveStartDate,
      status: 'active',
      notes: notes ?? null,
    })
    .select('*, block:training_blocks(*), current_phase:phases(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ program: data }, { status: 201 })
}
