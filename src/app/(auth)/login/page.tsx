import { LoginForm } from './_components/LoginForm'

export default function LoginPage() {
  return (
    <div className="rounded-2xl bg-white border border-ink/8 shadow-sm p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          Chào mừng trở lại
        </p>
        <h1 className="text-2xl font-bold text-ink">Đăng nhập vào tài khoản</h1>
        <p className="text-sm text-ink/50 mt-1">
          Nhập thông tin đăng nhập để truy cập bảng điều khiển tập luyện.
        </p>
      </div>

      <LoginForm />
    </div>
  )
}
