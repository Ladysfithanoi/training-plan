import { createClient } from '@/lib/supabase/server'
import type { Profile, TrainingBlock } from '@/types'
import { UsersManager } from './_components/UsersManager'

export const metadata = { title: 'Quản lý Học viên' }
export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('id, role').eq('id', user.id).single()
    : { data: null }

  const isAdmin = me?.role === 'admin'

  // Admins see every profile; coaches only the students they created.
  let usersQuery = supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (!isAdmin && me) usersQuery = usersQuery.eq('created_by', me.id).eq('role', 'user')

  const { data: users } = await usersQuery

  const { data: blocks } = await supabase
    .from('training_blocks')
    .select('id, name')
    .order('name')

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          {isAdmin ? 'Quản trị viên / HLV' : 'Huấn luyện viên'}
        </p>
        <h1 className="text-2xl font-bold text-ink">
          {isAdmin ? 'Quản lý Học viên' : 'Học viên của tôi'}
        </h1>
      </div>

      <UsersManager
        users={(users ?? []) as Profile[]}
        blocks={(blocks ?? []) as TrainingBlock[]}
        isAdmin={isAdmin}
      />
    </div>
  )
}
