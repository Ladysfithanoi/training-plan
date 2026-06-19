import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listAnnouncements } from '@/lib/announcements.server'
import { ANNOUNCEMENT_MAX_ITEMS } from '@/lib/announcements'
import { AnnouncementsManager } from './_components/AnnouncementsManager'

export const metadata = { title: 'Cập nhật — Bảng tin' }
export const dynamic = 'force-dynamic'

export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }

  // Posting announcements is admin-only. Coaches/trial reach /admin via the
  // proxy but must not manage the board — bounce them to the dashboard.
  if (me?.role !== 'admin') redirect('/admin')

  const announcements = await listAnnouncements()

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          Quản trị viên
        </p>
        <h1 className="text-2xl font-bold text-ink">Cập nhật — Bảng tin</h1>
        <p className="text-sm text-ink/50 mt-1">
          Đăng tin về tính năng hoặc chương trình tập mới cho HLV. Mỗi tin tự xoá sau 48 giờ,
          lưu tối đa {ANNOUNCEMENT_MAX_ITEMS} tin và hiển thị 3 tin mới nhất ở “Hướng dẫn sử dụng”.
        </p>
      </div>

      <AnnouncementsManager initialItems={announcements} />
    </div>
  )
}
