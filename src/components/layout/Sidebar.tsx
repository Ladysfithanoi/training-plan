'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types'
import { Logo } from './Logo'

interface NavItem {
  href:      string
  label:     string
  icon:      React.ReactNode
  adminOnly?: boolean
  /** Visually emphasise this item (amber + star) as the recommended starting point. */
  highlight?: boolean
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-4.5 w-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  )
}

// ─── Main nav (all users) ─────────────────────────────────────────────────────
// Items with adminOnly:true are only rendered for admin/coach accounts.
// "Lịch tập của tôi" replaces the old "Buổi tập / Nhật ký" slot —
// coaches get the full week/day/matrix view; the /workouts list is no longer
// surfaced as a primary nav item.
const navItems: NavItem[] = [
  {
    // Pinned to the top + highlighted with a star so every user knows to start here.
    href:      '/huong-dan',
    label:     'Hướng dẫn sử dụng',
    highlight: true,
    icon:      <Icon d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />,
  },
  {
    href:  '/dashboard',
    label: 'Bảng điều khiển',
    icon:  <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    // Promoted from admin section — coaches now land here for their personal
    // training log (week selector → day tabs → exercise matrix → survey).
    // Placed above "Chương trình của tôi" so staff reach their own schedule first.
    href:      '/admin/my-training',
    label:     'Lịch tập của tôi',
    adminOnly: true,
    icon:      <Icon d="M5 8.5V15.5M19 8.5V15.5M7.5 12H16.5M7.5 8.5a1.5 1.5 0 00-3 0v7a1.5 1.5 0 003 0M16.5 8.5a1.5 1.5 0 013 0v7a1.5 1.5 0 01-3 0" />,
  },
  {
    href:  '/programs',
    label: 'Chương trình của tôi',
    icon:  <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
  },
  {
    href:  '/progress',
    label: 'Tiến độ tập luyện',
    icon:  <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  },
]

// ─── Admin-only section ───────────────────────────────────────────────────────
// "Lịch tập của tôi" has been removed from here — it lives in the main nav now.
const adminNavItems: NavItem[] = [
  {
    href:      '/admin',
    label:     'Bảng điều khiển HLV',
    adminOnly: true,
    icon:      <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    href:      '/admin/users',
    label:     'Danh sách Học viên',
    adminOnly: true,
    icon:      <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
  {
    href:      '/admin/library',
    label:     'Kho bài tập',
    adminOnly: true,
    icon:      <Icon d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />,
  },
  {
    href:      '/admin/programs',
    label:     'Giáo án tập luyện',
    adminOnly: true,
    icon:      <Icon d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  },
]

interface SidebarProps {
  profile:  Profile
  onLogout: () => void
}

export function Sidebar({ profile, onLogout }: SidebarProps) {
  const pathname = usePathname()
  // Mobile drawer: hidden by default to give the page full width; the user opens
  // it from the floating button and it closes on navigation / backdrop / Esc.
  const [open, setOpen] = useState(false)

  // Close the drawer whenever the route changes (a nav link was tapped).
  useEffect(() => { setOpen(false) }, [pathname])

  // Close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const isAdmin  = profile.role === 'admin'
  // Staff = admin or coach (HLV); both get the management section.
  const isStaff  = profile.role === 'admin' || profile.role === 'coach'
  const staffSectionLabel = isAdmin ? 'Quản trị viên / HLV' : 'Huấn luyện viên'
  const roleLabel =
    profile.role === 'admin' ? 'Quản trị viên'
    : profile.role === 'coach' ? 'Huấn luyện viên'
    : 'Học viên'

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    if (href === '/admin')     return pathname === '/admin'
    return pathname.startsWith(href + '/') || pathname === href
  }

  return (
    <>
      {/* ── Mobile open button (floating, hidden when drawer is open) ─────────── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở menu"
        className={cn(
          'md:hidden fixed top-3 left-3 z-30 h-10 w-10 flex items-center justify-center rounded-xl border border-ink/10 bg-white/90 text-ink shadow-sm backdrop-blur transition-opacity',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* ── Backdrop (mobile only, when drawer is open) ──────────────────────── */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}

    <aside
      className={cn(
        'flex h-full flex-col w-64 md:w-58 shrink-0 border-r border-ink/8 bg-white',
        // Mobile: off-canvas drawer that slides in. Desktop: static in flow.
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:z-auto md:translate-x-0',
        open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
      )}
    >

      {/* ── Brand ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-5 py-[18px] border-b border-ink/8 overflow-hidden">
        <Logo className="h-8 w-8" />
        <span className="font-serif font-bold text-sm text-ink tracking-tight leading-tight whitespace-nowrap">
          Kế hoạch Tập luyện
        </span>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Đóng menu"
          className="md:hidden ml-auto h-8 w-8 flex items-center justify-center rounded-lg text-ink/40 hover:text-ink hover:bg-ink/6 transition-colors"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">

        {/* Main nav — skip adminOnly items for non-staff users */}
        {navItems
          .filter(item => !item.adminOnly || isStaff)
          .map(item => (
            <Link
              key={item.href}
              href={item.href}
              title={item.highlight ? `${item.label} — bắt đầu từ đây` : item.label}
              className={cn(
                'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150',
                isActive(item.href)
                  ? 'bg-ink text-paper'
                  : item.highlight
                    ? 'bg-amber/10 text-amber font-semibold ring-1 ring-amber/40 hover:bg-amber/15'
                    : 'text-ink/50 hover:text-ink hover:bg-ink/6',
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </Link>
          ))}

        {/* Staff section (admin or coach) */}
        {isStaff && (
          <>
            <div className="pt-4 pb-1 px-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber">
                {staffSectionLabel}
              </p>
            </div>
            {adminNavItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150',
                  isActive(item.href)
                    ? 'bg-ink text-paper'
                    : 'text-ink/50 hover:text-ink hover:bg-ink/6',
                )}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* ── User footer ──────────────────────────────────────────────────────── */}
      <div className="border-t border-ink/8 p-3">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="h-8 w-8 rounded-full bg-ink/10 flex items-center justify-center text-xs font-bold text-ink shrink-0">
            {profile.full_name?.[0]?.toUpperCase() ?? profile.email[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate leading-tight">
              {profile.full_name ?? profile.email}
            </p>
            <p className="text-[11px] text-ink/40 capitalize">
              {roleLabel}
            </p>
          </div>
        </div>

        <button
          onClick={onLogout}
          title="Đăng xuất"
          className="w-full flex items-center justify-start gap-2 text-xs font-medium text-ink/45 hover:text-danger transition-colors rounded-lg px-2 py-1.5 hover:bg-danger/6"
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span>Đăng xuất</span>
        </button>
      </div>

    </aside>
    </>
  )
}
