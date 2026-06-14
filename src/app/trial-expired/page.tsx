'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function TrialExpiredPage() {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-dvh bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl bg-white border border-ink/8 shadow-sm p-8 text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-full bg-amber/10 flex items-center justify-center">
          <svg className="h-7 w-7 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-ink">Phiên trải nghiệm đã kết thúc</h1>
        <p className="text-sm text-ink/55 mt-2 leading-relaxed">
          Tài khoản trải nghiệm của bạn đã hết thời gian sử dụng hoặc đã được tạm ngưng.
          Vui lòng liên hệ quản trị viên để được kích hoạt lại.
        </p>
        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-xl bg-ink text-paper text-sm font-semibold py-3 hover:bg-ink/90 transition-colors"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  )
}
