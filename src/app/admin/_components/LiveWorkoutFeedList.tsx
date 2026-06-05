'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDate, cn } from '@/lib/utils'

// ── Survey label maps ─────────────────────────────────────────────────────────
const PERF_LABEL: Record<string, string> = {
  exceed: '🔥 Vượt mục tiêu',
  meet:   '✅ Đạt mục tiêu',
  miss:   '📉 Trượt',
}
const RIR_LABEL: Record<string, string> = {
  easier:    '💪 Khỏe hơn',
  on_target: '🎯 Đúng RIR',
  too_hard:  '😮‍💨 Quá nặng',
}
const RECOVERY_LABEL: Record<string, string> = {
  great:  '⚡ Khỏe mạnh',
  normal: '😐 Bình thường',
  sore:   '🤕 Đau nhức',
}

export type FeedSession = {
  id: string
  session_date: string
  status: string
  next_week_suggestion: string | null
  survey_performance: string | null
  survey_rir_feel: string | null
  survey_recovery: string | null
  profile: { id: string; full_name: string | null; email: string } | null
  sets: { count: number }[]
}

const PAGE_SIZE = 5

export function LiveWorkoutFeedList({ sessions }: { sessions: FeedSession[] }) {
  const [page, setPage] = useState(1)

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-ink/8 bg-white px-5 py-8 text-center">
        <p className="text-sm text-ink/35">Chưa có buổi tập nào trong 60 ngày gần đây.</p>
      </div>
    )
  }

  const totalPages  = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const offset      = (currentPage - 1) * PAGE_SIZE
  const pageItems   = sessions.slice(offset, offset + PAGE_SIZE)

  return (
    <div className="space-y-3">
      {pageItems.map(s => {
        const setsCount = s.sets[0]?.count ?? 0
        const name = s.profile?.full_name ?? s.profile?.email ?? '—'
        const isActive = s.status === 'in_progress'
        const hasSurvey = s.survey_performance && s.survey_rir_feel && s.survey_recovery

        return (
          <div
            key={s.id}
            className="rounded-xl border border-ink/8 bg-white px-4 py-3.5 flex items-start gap-3.5 hover:border-ink/15 transition-colors"
          >
            {/* Status dot */}
            <div className={cn(
              'h-2.5 w-2.5 rounded-full mt-1.5 shrink-0',
              isActive ? 'bg-amber animate-pulse' : 'bg-herb',
            )} />

            {/* Main content */}
            <div className="min-w-0 flex-1">
              {/* Row 1: name + date + status */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-sm text-ink">{name}</span>
                <span className="text-ink/25">·</span>
                <span className="text-xs text-ink/45">{formatDate(s.session_date)}</span>
                <span className={cn(
                  'ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                  isActive
                    ? 'bg-amber/10 text-amber border-amber/25'
                    : 'bg-herb/10 text-herb border-herb/20',
                )}>
                  {isActive ? 'Đang tập' : 'Hoàn thành'}
                </span>
                <span className="text-[11px] text-ink/35 ml-auto shrink-0">
                  {setsCount} hiệp
                </span>
              </div>

              {/* Row 2: survey answers */}
              {hasSurvey && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  <span className="text-[11px] text-ink/50">
                    {PERF_LABEL[s.survey_performance!]}
                  </span>
                  <span className="text-[11px] text-ink/50">
                    {RIR_LABEL[s.survey_rir_feel!]}
                  </span>
                  <span className="text-[11px] text-ink/50">
                    {RECOVERY_LABEL[s.survey_recovery!]}
                  </span>
                </div>
              )}

              {/* Row 3: next_week_suggestion snippet */}
              {s.next_week_suggestion && (
                <p className="mt-1.5 text-[11px] text-ink/55 leading-snug line-clamp-2 border-l-2 border-amber/35 pl-2 italic">
                  {s.next_week_suggestion}
                </p>
              )}
            </div>

            {/* Link to athlete detail */}
            {s.profile?.id && (
              <Link
                href={`/admin/users/${s.profile.id}`}
                className="shrink-0 self-start mt-0.5 rounded-lg border border-ink/12 px-2.5 py-1 text-[11px] font-medium text-ink/45 hover:text-ink hover:border-ink/25 transition-colors"
              >
                Chi tiết →
              </Link>
            )}
          </div>
        )
      })}

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-ink/40">
            Hiển thị {offset + 1}–{Math.min(offset + PAGE_SIZE, sessions.length)} / {sessions.length}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ← Trước
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  p === currentPage
                    ? 'border-ink bg-ink text-paper'
                    : 'border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30',
                )}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Tiếp →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
