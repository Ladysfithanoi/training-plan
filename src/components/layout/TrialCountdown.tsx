'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface TrialCountdownProps {
  /** ISO timestamp when the trial window ends. */
  expiresAt: string | null | undefined
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Live 5-hour countdown shown in the sidebar for an active trial (Trải nghiệm)
 * account. When it hits zero it refreshes the route so the proxy re-evaluates
 * the session and redirects to /trial-expired.
 */
export function TrialCountdown({ expiresAt }: TrialCountdownProps) {
  const router = useRouter()
  const target = expiresAt ? new Date(expiresAt).getTime() : 0
  const [remaining, setRemaining] = useState(() => target - Date.now())

  useEffect(() => {
    if (!target) return
    const id = setInterval(() => {
      const next = target - Date.now()
      setRemaining(next)
      if (next <= 0) {
        clearInterval(id)
        router.refresh()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [target, router])

  // No expiry set yet → the 5-hour clock hasn't started (begins on first login).
  const pending = !expiresAt
  const expired = !pending && remaining <= 0
  // Under 30 minutes → urgent red styling.
  const urgent = !pending && !expired && remaining < 30 * 60 * 1000

  return (
    <div
      className={`mb-3 rounded-xl border px-3 py-2.5 ${
        expired
          ? 'border-danger/30 bg-danger/8'
          : urgent
            ? 'border-danger/25 bg-danger/6'
            : 'border-amber/25 bg-amber/8'
      }`}
    >
      <p className={`text-[10px] font-bold uppercase tracking-widest ${expired || urgent ? 'text-danger' : 'text-amber'}`}>
        Phiên trải nghiệm
      </p>
      {pending ? (
        <p className="mt-0.5 text-sm font-bold text-amber">Chưa bắt đầu</p>
      ) : expired ? (
        <p className="mt-0.5 text-sm font-bold text-danger">Đã hết hạn</p>
      ) : (
        <p className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${urgent ? 'text-danger' : 'text-ink'}`}>
          {format(remaining)}
        </p>
      )}
      <p className="mt-0.5 text-[10px] text-ink/45 leading-tight">
        {pending ? 'Đồng hồ 5 giờ bắt đầu khi bạn đăng nhập lần đầu' : 'Thời gian còn lại để trải nghiệm'}
      </p>
    </div>
  )
}
