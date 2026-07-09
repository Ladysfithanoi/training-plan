import { ForgotPasswordForm } from './_components/ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-2xl bg-white border border-ink/8 shadow-sm p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          Khôi phục tài khoản
        </p>
        <h1 className="text-2xl font-bold text-ink">Quên mật khẩu</h1>
        <p className="text-sm text-ink/50 mt-1">
          Nhập email đăng nhập của bạn. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu tới hộp thư đó.
        </p>
      </div>

      <ForgotPasswordForm />
    </div>
  )
}
