import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { trialIsActive } from '@/lib/trial'

/**
 * Next.js 16 Proxy (formerly Middleware).
 * Handles auth session refresh, route protection, and admin guarding.
 */
export async function proxy(request: NextRequest) {
  // Guard: skip if Supabase env vars are not configured (e.g. during build)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  // Refresh session — do NOT remove this call
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Public paths that never need authentication
  const isPublicPath =
    path.startsWith('/login') ||
    // Password recovery — reached without a session (user forgot their password).
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/api/auth') ||
    // Magic-link guest program view + its API — validated by token, not a session.
    // Recipients (students) must reach these WITHOUT logging in.
    path.startsWith('/p/') ||
    path.startsWith('/api/p/') ||
    // Landing page shown to a trial account whose window has ended.
    path.startsWith('/trial-expired') ||
    path.startsWith('/_next') ||
    path.startsWith('/favicon')

  // Unauthenticated access to a protected path.
  if (!user && !isPublicPath) {
    // API routes must answer with JSON — never redirect a fetch() to the HTML
    // login page. A 307 → /login makes the browser follow into an HTML
    // document, which surfaces in the client as a cryptic "Failed to fetch" or
    // a JSON-parse error instead of a usable message. Return 401 so the caller
    // can show "phiên đã hết hạn, đăng nhập lại".
    if (path.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Phiên đăng nhập đã hết hạn. Vui lòng tải lại trang và đăng nhập lại.' },
        { status: 401 },
      )
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from /login
  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // For any authenticated request to a protected path we need the caller's role
  // (and, for trial accounts, their activation window). Fetched once and reused
  // by both the trial gate and the staff-only /admin guard below.
  if (user && !isPublicPath) {
    // Select `role` alone first — it always exists. The trial window columns
    // are added by migration 008, which (per project convention) is run by hand
    // AFTER this code deploys; selecting them unconditionally here would error
    // for everyone during that gap. So we only fetch them when role === 'trial',
    // which can't happen until the migration has run anyway.
    const { data: base } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = base?.role

    // ── Trial (Trải nghiệm) gate ──────────────────────────────────────────────
    // A trial account whose 5-hour window elapsed, or that an admin switched
    // off, may no longer use the app at all.
    if (role === 'trial') {
      const { data: trial } = await supabase
        .from('profiles')
        .select('role, trial_active, trial_expires_at')
        .eq('id', user.id)
        .single()

      if (trial && !trialIsActive(trial)) {
        if (path.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'Phiên trải nghiệm đã kết thúc. Vui lòng liên hệ quản trị viên để được kích hoạt lại.' },
            { status: 403 },
          )
        }
        const url = request.nextUrl.clone()
        url.pathname = '/trial-expired'
        url.search = ''
        return NextResponse.redirect(url)
      }
    }

    // ── Staff-only guard (admin, coach/HLV, or active trial) ──────────────────
    if (path.startsWith('/admin')) {
      if (role !== 'admin' && role !== 'coach' && role !== 'trial') {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match every path EXCEPT static files and _next internals.
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
