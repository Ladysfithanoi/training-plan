'use client'

import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? ''

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Link opened without a token → nothing to reset.
  if (!token) {
    return (
      <div className="space-y-5">
        <p className="rounded-lg bg-danger/8 border border-danger/20 px-4 py-3 text-sm text-danger">
          Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu đặt lại mật khẩu một lần nữa.
        </p>
        <Link
          href="/forgot-password"
          className="block text-center text-sm font-medium text-amber hover:underline"
        >
          Yêu cầu liên kết mới
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (pw.length < 8) {
      setError('Mật khẩu mới phải có tối thiểu 8 ký tự.')
      return
    }
    if (pw !== pw2) {
      setError('Mật khẩu nhập lại không khớp.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Có lỗi xảy ra. Vui lòng thử lại.')
        setLoading(false)
        return
      }
      setDone(true)
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div className="space-y-5">
        <p className="rounded-lg bg-herb/8 border border-herb/25 px-4 py-3 text-sm text-herb font-medium">
          Đã đặt lại mật khẩu thành công. Bây giờ bạn có thể đăng nhập bằng mật khẩu mới.
        </p>
        <Link href="/login" className="block">
          <Button className="w-full" size="lg">
            Đến trang đăng nhập
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="Mật khẩu mới"
        type="password"
        autoComplete="new-password"
        required
        value={pw}
        onChange={e => setPw(e.target.value)}
        placeholder="••••••••"
      />
      <Input
        label="Nhập lại mật khẩu mới"
        type="password"
        autoComplete="new-password"
        required
        value={pw2}
        onChange={e => setPw2(e.target.value)}
        placeholder="••••••••"
        error={error ?? undefined}
      />

      <Button type="submit" loading={loading} className="w-full" size="lg" disabled={!pw || !pw2}>
        Đặt lại mật khẩu
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
