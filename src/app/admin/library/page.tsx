import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LibraryTabs } from './_components/LibraryTabs'

export const metadata = { title: 'Thư viện Tập luyện' }
export const dynamic = 'force-dynamic'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const [{ data: patterns }, { data: exercises }] = await Promise.all([
    supabase.from('movement_patterns').select('*').order('name'),
    supabase.from('exercises').select('*, movement_pattern:movement_patterns(*)').order('name'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Quản trị HLV</p>
        <h1 className="text-2xl font-bold text-ink">Thư viện Tập luyện</h1>
        <p className="text-sm text-ink/50 mt-1">Quản lý các chuỗi chuyển động và danh mục bài tập.</p>
      </div>

      <LibraryTabs
        initialPatterns={patterns ?? []}
        initialExercises={(exercises as any[]) ?? []}
      />
    </div>
  )
}
