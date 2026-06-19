import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listAnnouncements } from '@/lib/announcements.server'
import { ANNOUNCEMENT_MAX_VISIBLE } from '@/lib/announcements'
import { AnnouncementBoard } from '@/components/announcements/AnnouncementBoard'

export const metadata = { title: 'Bảng tin' }
export const dynamic = 'force-dynamic'

export default async function BangTinPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Bảng tin is for staff (HLV). Students never reach the link, but guard the
  // direct URL too.
  const isStaff = profile?.role === 'admin' || profile?.role === 'coach' || profile?.role === 'trial'
  const isAdmin = profile?.role === 'admin'
  if (!isStaff) redirect('/dashboard')

  const announcements = await listAnnouncements(ANNOUNCEMENT_MAX_VISIBLE)

  return (
    <div className="space-y-7">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber/12 text-amber">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink">Bảng tin</h1>
          <p className="text-sm text-ink/50 mt-1">
            Tính năng & chương trình tập mới nhất dành cho Huấn luyện viên.
          </p>
        </div>
      </div>

      {/* ── Board / empty state ────────────────────────────────────────────── */}
      {announcements.length > 0 ? (
        <AnnouncementBoard items={announcements} />
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-6 py-16 text-center">
          <span className="text-5xl opacity-20" role="img" aria-label="Bảng tin trống">📣</span>
          <p className="mt-4 text-sm font-semibold text-ink">Chưa có tin nào</p>
          <p className="mt-1 text-xs text-ink/45">
            {isAdmin
              ? 'Vào mục “Cập nhật” trên thanh bên để đăng tin mới.'
              : 'Quản trị viên sẽ đăng tin mới tại đây.'}
          </p>
        </div>
      )}
    </div>
  )
}
