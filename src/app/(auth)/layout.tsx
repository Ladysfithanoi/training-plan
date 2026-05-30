import type { Metadata } from 'next'
import { Logo } from '@/components/layout/Logo'

export const metadata: Metadata = {
  title: 'Đăng nhập',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo mark */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10" />
            <span className="text-xl font-bold text-ink tracking-tight">Kế hoạch Tập luyện</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
