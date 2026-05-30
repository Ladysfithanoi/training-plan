import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import Link from 'next/link'
import { Suspense } from 'react'
import { LiveWorkoutFeed } from './_components/LiveWorkoutFeed'

export const metadata = { title: 'Bảng điều khiển HLV' }
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()

  const [
    { count: userCount },
    { count: blockCount },
    { count: sessionCount },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
    supabase.from('training_blocks').select('*', { count: 'exact', head: true }),
    supabase.from('workout_sessions').select('*', { count: 'exact', head: true }),
  ])

  const stats = [
    { label: 'Học viên', value: userCount ?? 0, href: '/admin/users', accent: 'herb' as const },
    { label: 'Khối tập luyện', value: blockCount ?? 0, href: '/admin/programs', accent: 'slate' as const },
    { label: 'Buổi tập đã ghi', value: sessionCount ?? 0, href: null, accent: 'amber' as const },
  ]

  const quickLinks = [
    {
      href: '/admin/users',
      label: 'Quản lý Học viên',
      description: 'Tạo tài khoản và cấp giáo án tập luyện',
      icon: '👤',
    },
    {
      href: '/admin/programs',
      label: 'Thiết kế Chương trình',
      description: 'Xây dựng các khối tập và chu kỳ tập luyện',
      icon: '📋',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Quản trị</p>
        <h1 className="text-2xl font-bold text-ink">Bảng điều khiển HLV</h1>
      </div>

      {/* Thống kê */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map(stat => (
          <Card key={stat.label} accent={stat.accent}>
            <CardHeader>
              <CardTitle>{stat.label}</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-3xl font-bold font-mono text-ink tabular-nums">{stat.value}</p>
              {stat.href && (
                <Link href={stat.href} className="text-xs text-amber hover:underline mt-1 inline-block">
                  Quản lý →
                </Link>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Thao tác nhanh */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50 mb-4">Thao tác nhanh</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {quickLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-start gap-4 rounded-xl bg-white border border-ink/8 px-5 py-4 hover:border-ink/20 hover:shadow-sm transition-all group"
            >
              <span className="text-2xl">{link.icon}</span>
              <div>
                <p className="font-semibold text-ink group-hover:text-amber transition-colors">
                  {link.label}
                </p>
                <p className="text-sm text-ink/50 mt-0.5">{link.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Live workout feed */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Hoạt động tập luyện gần đây
          </h2>
          <Link
            href="/admin/users"
            className="text-xs text-amber hover:underline"
          >
            Tất cả học viên →
          </Link>
        </div>
        <Suspense fallback={
          <div className="rounded-xl border border-ink/8 bg-white px-5 py-8 flex items-center justify-center gap-2 text-sm text-ink/35">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/15 border-t-ink/40" />
            Đang tải...
          </div>
        }>
          <LiveWorkoutFeed />
        </Suspense>
      </div>
    </div>
  )
}
