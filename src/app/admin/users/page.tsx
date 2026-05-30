import { createClient } from '@/lib/supabase/server'
import type { Profile, TrainingBlock } from '@/types'
import { UsersManager } from './_components/UsersManager'

export const metadata = { title: 'Quản lý Học viên' }
export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const supabase = await createClient()

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  const { data: blocks } = await supabase
    .from('training_blocks')
    .select('id, name')
    .order('name')

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Quản trị viên / HLV</p>
        <h1 className="text-2xl font-bold text-ink">Quản lý Học viên</h1>
      </div>

      <UsersManager
        users={(users ?? []) as Profile[]}
        blocks={(blocks ?? []) as TrainingBlock[]}
      />
    </div>
  )
}
