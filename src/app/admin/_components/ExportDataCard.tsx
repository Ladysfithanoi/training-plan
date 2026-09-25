'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Admin-only: tải toàn bộ dữ liệu (chương trình tập, kho bài tập, học viên,
 * nhật ký tập…) thành một file JSON để sao lưu hoặc chuyển sang app mới.
 */
export function ExportDataCard() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/export', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Lỗi máy chủ (${res.status})`)
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'training-plan-backup.json'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl bg-white border border-ink/8 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <span className="text-2xl">💾</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink">Tải toàn bộ dữ liệu (JSON)</p>
        <p className="text-sm text-ink/50 mt-0.5">
          Chương trình tập, kho bài tập, học viên, lịch sử buổi tập và bảng tin — dùng để sao lưu
          hoặc chuyển sang app mới. Mật khẩu tài khoản không nằm trong file.
        </p>
        {error && <p className="text-sm text-danger mt-2">{error}</p>}
      </div>
      <Button onClick={handleExport} loading={loading} className="shrink-0">
        {loading ? 'Đang xuất...' : 'Tải file JSON'}
      </Button>
    </div>
  )
}
