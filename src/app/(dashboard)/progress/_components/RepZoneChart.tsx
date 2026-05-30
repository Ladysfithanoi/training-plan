'use client'

import { cn } from '@/lib/utils'
import type { RepZoneAudit } from '@/lib/repZones'

interface RepZoneChartProps {
  audit: RepZoneAudit
  phaseName: string
}

const GOAL_LABEL: Record<string, string> = {
  hypertrophy: 'Tăng cơ',
  strength:    'Tăng sức mạnh',
  mixed:       'Hỗn hợp',
}

// Target ratios for the reference tick marks
const HELMS_TARGETS: Record<string, { heavy: number; moderate: number; light: number }> = {
  hypertrophy: { heavy: 15,  moderate: 65, light: 20 },
  strength:    { heavy: 65,  moderate: 30, light: 5  },
  mixed:       { heavy: 33,  moderate: 34, light: 33 },
}

export function RepZoneChart({ audit, phaseName }: RepZoneChartProps) {
  const {
    loggedCounts,
    loggedPcts,
    programmedCounts,
    programmedPcts,
    primarySource,
    goal,
    tip,
    isOnTarget,
  } = audit

  const primary = primarySource === 'logged' ? loggedCounts : programmedCounts
  const primaryPcts = primarySource === 'logged' ? loggedPcts : programmedPcts
  const hasBothSources = loggedCounts.total > 0 && programmedCounts.total > 0
  const target = HELMS_TARGETS[goal] ?? HELMS_TARGETS.mixed

  // Ensure pcts sum to 100 (handle rounding)
  const sumPct = primaryPcts.heavy + primaryPcts.moderate + primaryPcts.light
  const adjustedLight = primaryPcts.light + (100 - sumPct)

  const zones = [
    {
      key: 'heavy' as const,
      label: 'Vùng Sức mạnh',
      reps: '1–5 reps',
      pct: primaryPcts.heavy,
      count: primary.heavy,
      targetPct: target.heavy,
      color: 'bg-slate',
      textColor: 'text-slate',
      lightColor: 'bg-slate/10',
      borderColor: 'border-slate/20',
    },
    {
      key: 'moderate' as const,
      label: 'Vùng Tăng cơ',
      reps: '6–12 reps',
      pct: primaryPcts.moderate,
      count: primary.moderate,
      targetPct: target.moderate,
      color: 'bg-herb',
      textColor: 'text-herb',
      lightColor: 'bg-herb/10',
      borderColor: 'border-herb/20',
    },
    {
      key: 'light' as const,
      label: 'Vùng Bền',
      reps: '13+ reps',
      pct: adjustedLight,
      count: primary.light,
      targetPct: target.light,
      color: 'bg-amber',
      textColor: 'text-amber',
      lightColor: 'bg-amber/8',
      borderColor: 'border-amber/20',
    },
  ]

  const hasNoData = primary.total === 0

  return (
    <div className="space-y-5">

      {/* ── Header row ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">
            Phân bổ Vùng Rep
          </p>
          <p className="text-xs text-ink/30 mt-0.5 truncate">
            {phaseName} ·{' '}
            <span className="font-medium text-ink/50">{GOAL_LABEL[goal] ?? 'Hỗn hợp'}</span>
          </p>
        </div>
        {/* Source badge */}
        <span
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold',
            primarySource === 'logged'
              ? 'bg-herb/8 border-herb/20 text-herb'
              : 'bg-ink/5 border-ink/15 text-ink/45',
          )}
        >
          {primarySource === 'logged'
            ? `${loggedCounts.total} set tuần này`
            : `Kế hoạch: ${programmedCounts.total} set`}
        </span>
      </div>

      {hasNoData ? (
        <div className="rounded-xl border border-dashed border-ink/15 px-5 py-6 text-center">
          <p className="text-sm text-ink/35">
            Chưa có dữ liệu. Hãy ghi nhật ký buổi tập để xem phân bổ vùng rep.
          </p>
        </div>
      ) : (
        <>
          {/* ── Stacked bar ───────────────────────────────────────────────────── */}
          <div className="space-y-2">
            {/* Main bar */}
            <div className="flex h-7 rounded-lg overflow-hidden gap-px bg-ink/8">
              {zones.map(z => (
                <div
                  key={z.key}
                  className={cn(
                    'flex items-center justify-center transition-all duration-500',
                    z.color,
                    z.pct === 0 && 'hidden',
                  )}
                  style={{ width: `${z.pct}%`, minWidth: z.pct > 0 ? '8px' : undefined }}
                  title={`${z.label}: ${z.pct}% (${z.count} set)`}
                >
                  {z.pct >= 12 && (
                    <span className="text-[10px] font-bold text-white/90 leading-none tabular-nums select-none">
                      {z.pct}%
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Helms target reference bar */}
            <div className="flex h-1.5 rounded-full overflow-hidden gap-px bg-ink/5">
              {zones.map(z => (
                <div
                  key={z.key}
                  className={cn('transition-all duration-500 opacity-40', z.color)}
                  style={{ width: `${z.targetPct}%` }}
                  title={`Khuyến nghị: ${z.targetPct}%`}
                />
              ))}
            </div>
            <p className="text-[10px] text-ink/30 text-right leading-none">
              ↑ Tỉ lệ khuyến nghị (Eric Helms)
            </p>
          </div>

          {/* ── Zone legend ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            {zones.map(z => {
              const diff = z.pct - z.targetPct
              const isHigh = diff > 10
              const isLow = diff < -10

              return (
                <div
                  key={z.key}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 space-y-1',
                    z.lightColor,
                    z.borderColor,
                  )}
                >
                  {/* Zone color dot + label */}
                  <div className="flex items-center gap-1.5">
                    <div className={cn('h-2 w-2 rounded-full shrink-0', z.color)} />
                    <p className={cn('text-[10px] font-semibold leading-tight', z.textColor)}>
                      {z.label}
                    </p>
                  </div>
                  {/* Rep range */}
                  <p className="text-[9px] text-ink/40">{z.reps}</p>
                  {/* Percentage */}
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <p className={cn('text-base font-bold tabular-nums leading-none', z.textColor)}>
                      {z.pct}%
                    </p>
                    <p className="text-[10px] text-ink/35 tabular-nums">{z.count} set</p>
                  </div>
                  {/* Delta vs target */}
                  {(isHigh || isLow) && (
                    <p
                      className={cn(
                        'text-[9px] font-semibold tabular-nums',
                        isHigh ? 'text-amber' : 'text-danger/70',
                      )}
                    >
                      {diff > 0 ? '+' : ''}{diff}% vs đề xuất
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Comparison row: logged vs programmed (when both exist) ────────── */}
          {hasBothSources && primarySource === 'logged' && (
            <div className="rounded-lg bg-ink/3 border border-ink/8 px-4 py-3">
              <p className="text-[10px] font-semibold text-ink/40 uppercase tracking-wide mb-2">
                So sánh: Thực tế vs Kế hoạch
              </p>
              <div className="space-y-1.5">
                {zones.map(z => {
                  const loggedPct = loggedPcts[z.key]
                  const progPct = programmedPcts[z.key]
                  const delta = loggedPct - progPct

                  return (
                    <div key={z.key} className="flex items-center gap-2 text-xs">
                      <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', z.color)} />
                      <span className="text-ink/50 w-24 shrink-0">{z.label}</span>
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className={cn('font-semibold tabular-nums', z.textColor)}>
                          {loggedPct}%
                        </span>
                        <span className="text-ink/30">vs</span>
                        <span className="text-ink/40 tabular-nums">{progPct}%</span>
                        {Math.abs(delta) >= 5 && (
                          <span
                            className={cn(
                              'text-[10px] font-semibold tabular-nums ml-auto',
                              delta > 0 ? 'text-slate' : 'text-danger/70',
                            )}
                          >
                            {delta > 0 ? '+' : ''}{delta}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Advisory tip ─────────────────────────────────────────────────── */}
          {tip && !isOnTarget && (
            <div className="rounded-xl border border-amber/20 bg-amber/5 px-4 py-3 flex items-start gap-3">
              <svg
                className="h-4 w-4 text-amber shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-ink/65 leading-relaxed">{tip}</p>
            </div>
          )}

          {/* ── On-target confirmation ────────────────────────────────────────── */}
          {isOnTarget && primary.total >= 5 && goal !== 'mixed' && (
            <div className="rounded-xl border border-herb/20 bg-herb/5 px-4 py-2.5 flex items-center gap-3">
              <svg
                className="h-4 w-4 text-herb shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-herb/80 font-medium">
                Phân bổ đúng mục tiêu theo Eric Helms — tiếp tục duy trì!
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
