'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Có lỗi xảy ra. Vui lòng thử lại.')
        setLoading(false)
        return
      }
      setSent(true)
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.')
    }
    setLoading(false)
  }

  // After a successful request we show a neutral confirmation that never
  // discloses whether the address was actually registered.
  if (sent) {
    return (
      <div className="space-y-5">
        <p className="rounded-lg bg-herb/8 border border-herb/25 px-4 py-3 text-sm text-herb font-medium">
          Nếu email <strong>{email}</strong> tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt
          lại mật khẩu. Vui lòng kiểm tra hộp thư (kể cả mục Spam/Quảng cáo). Liên kết hết hạn sau 1 giờ.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm font-medium text-amber hover:underline"
        >
          ← Quay lại đăng nhập
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="Địa chỉ Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="coach@example.com"
        error={error ?? undefined}
      />

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Gửi liên kết đặt lại
      </Button>

      <Link
        href="/login"
        className="block text-center text-sm font-medium text-ink/55 hover:text-ink"
      >
        ← Quay lại đăng nhập
      </Link>
    </form>
  )
}
