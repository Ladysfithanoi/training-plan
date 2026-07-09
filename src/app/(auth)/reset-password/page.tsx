import { Suspense } from 'react'
import { ResetPasswordForm } from './_components/ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <div className="rounded-2xl bg-white border border-ink/8 shadow-sm p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          Khôi phục tài khoản
        </p>
        <h1 className="text-2xl font-bold text-ink">Đặt lại mật khẩu</h1>
        <p className="text-sm text-ink/50 mt-1">
          Chọn mật khẩu mới cho tài khoản của bạn (tối thiểu 8 ký tự).
        </p>
      </div>

      {/* useSearchParams() must sit under a Suspense boundary in the App Router. */}
      <Suspense fallback={<p className="text-sm text-ink/50">Đang tải…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
