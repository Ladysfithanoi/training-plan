'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Profile } from '@/types'

interface AccountModalProps {
  profile: Profile
  open: boolean
  onClose: () => void
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  coach: 'Huấn luyện viên',
  user: 'Học viên',
  trial: 'Trải nghiệm',
}

/**
 * Account info + self-service password change, opened from the sidebar footer.
 * Available to every role except trial (Trải nghiệm).
 */
export function AccountModal({ profile, open, onClose }: AccountModalProps) {
  const supabase = createClient()

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function reset() {
    setPw('')
    setPw2('')
    setError(null)
    setSuccess(false)
    setSaving(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleChangePassword() {
    setError(null)
    setSuccess(false)

    if (pw.length < 8) {
      setError('Mật khẩu mới phải có tối thiểu 8 ký tự.')
      return
    }
    if (pw !== pw2) {
      setError('Mật khẩu nhập lại không khớp.')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: pw })
    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess(true)
    setPw('')
    setPw2('')
  }

  return (
    <Modal open={open} onClose={handleClose} title="Tài khoản của tôi">
      <div className="space-y-6">
        {/* ── Account info ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-ink/10 flex items-center justify-center text-base font-bold text-ink shrink-0">
            {profile.full_name?.[0]?.toUpperCase() ?? profile.email[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-ink leading-tight truncate">
              {profile.full_name ?? '—'}
            </p>
            <p className="text-sm text-ink/55 truncate">{profile.email}</p>
            <span className="mt-1 inline-flex items-center rounded-full bg-ink/8 px-2 py-0.5 text-[11px] font-semibold text-ink/70">
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>
          </div>
        </div>

        <div className="h-px bg-ink/8" />

        {/* ── Change password ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Đổi mật khẩu</h3>
            <p className="text-xs text-ink/45 mt-0.5">
              Nhập mật khẩu mới (tối thiểu 8 ký tự). Bấm biểu tượng con mắt để hiện/ẩn.
            </p>
          </div>

          <Input
            label="Mật khẩu mới"
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setSuccess(false) }}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <Input
            label="Nhập lại mật khẩu mới"
            type="password"
            value={pw2}
            onChange={e => { setPw2(e.target.value); setSuccess(false) }}
            placeholder="••••••••"
            autoComplete="new-password"
          />

          {error && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-lg bg-herb/8 border border-herb/25 px-3 py-2 text-sm text-herb font-medium">
              Đã đổi mật khẩu thành công.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              loading={saving}
              onClick={handleChangePassword}
              disabled={!pw || !pw2}
              className="flex-1"
            >
              Đổi mật khẩu
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              Đóng
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
