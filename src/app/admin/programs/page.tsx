import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { TrainingBlock, Exercise, MovementPattern } from '@/types'
import { ProgramsWorkspace } from './_components/ProgramsWorkspace'

export const metadata = { title: 'Thiết kế Chương trình' }
export const dynamic = 'force-dynamic'

export default async function AdminProgramsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'coach') redirect('/dashboard')
  const isAdmin = profile?.role === 'admin'

  const [{ data: blocks }, { data: exercises }, { data: patterns }] = await Promise.all([
    supabase
      .from('training_blocks')
      .select('*, phases(*)')
      .order('created_at', { ascending: false }),
    supabase
      .from('exercises')
      .select('*, movement_pattern:movement_patterns(*)')
      .order('name'),
    supabase
      .from('movement_patterns')
      .select('*')
      .order('name'),
  ])

  // Each block carries its own phases[] — ProgramsWorkspace passes them to both
  // child sections so block-context is always derived from the same data source.
  const typedBlocks = (blocks ?? []) as (TrainingBlock & { phases: import('@/types').Phase[] })[]

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Quản trị viên / HLV</p>
        <h1 className="text-2xl font-bold text-ink">Thiết kế Chương trình</h1>
        <p className="text-sm text-ink/50 mt-1">
          Thiết kế các khối tập với chu kỳ phân hóa, sau đó thêm bài tập vào từng giai đoạn.
        </p>
      </div>

      <ProgramsWorkspace
        blocks={typedBlocks}
        exercises={(exercises ?? []) as Exercise[]}
        patterns={(patterns ?? []) as MovementPattern[]}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  )
}
