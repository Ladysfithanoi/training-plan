'use client'

import { cn } from '@/lib/utils'
import { MEV, MAV, volumeStatusLabel } from '@/lib/volumeAdequacy'
import type { RepZoneAudit } from '@/lib/repZones'
import type { VolumeAdequacyResult, MuscleGroupVolume } from '@/lib/volumeAdequacy'

// ── Sub-component prop types ──────────────────────────────────────────────────
interface ProgramAuditCardProps {
  repZoneAudit: RepZoneAudit
  volumeResult: VolumeAdequacyResult
  phaseName: string
}

// ─── Colour palette tokens (Tailwind class strings) ───────────────────────────
const COLOR = {
  heavy:    { bar: 'bg-slate',  text: 'text-slate',  bg: 'bg-slate/10',  border: 'border-slate/20'  },
  moderate: { bar: 'bg-herb',   text: 'text-herb',   bg: 'bg-herb/10',   border: 'border-herb/20'   },
  light:    { bar: 'bg-amber',  text: 'text-amber',  bg: 'bg-amber/8',   border: 'border-amber/20'  },
  danger:   { bar: 'bg-danger', text: 'text-danger', bg: 'bg-danger/8',  border: 'border-danger/20' },
  herb:     { bar: 'bg-herb',   text: 'text-herb',   bg: 'bg-herb/8',    border: 'border-herb/20'   },
  amber:    { bar: 'bg-amber',  text: 'text-amber',  bg: 'bg-amber/8',   border: 'border-amber/20'  },
}

const STATUS_COLOR = {
  insufficient: COLOR.danger,
  optimal:      COLOR.herb,
  excessive:    COLOR.amber,
}

const GOAL_VI: Record<string, string> = {
  hypertrophy: 'Tăng cơ',
  strength:    'Tăng sức mạnh',
  mixed:       'Hỗn hợp',
}

// ── Helper: build Helms target percentages per goal ──────────────────────────
const HELMS_TARGET: Record<string, { heavy: number; moderate: number; light: number }> = {
  hypertrophy: { heavy: 15, moderate: 65, light: 20 },
  strength:    { heavy: 65, moderate: 30, light: 5  },
  mixed:       { heavy: 33, moderate: 34, light: 33 },
}

// ─────────────────────────────────────────────────────────────────────────────
// Rep Zone Distribution sub-section
// ─────────────────────────────────────────────────────────────────────────────
function RepZoneSection({ audit, phaseName }: { audit: RepZoneAudit; phaseName: string }) {
  const { primarySource, goal, loggedCounts, loggedPcts, programmedCounts, programmedPcts,
          tip, isOnTarget } = audit

  const primary      = primarySource === 'logged' ? loggedCounts    : programmedCounts
  const primaryPcts  = primarySource === 'logged' ? loggedPcts      : programmedPcts
  const target       = HELMS_TARGET[goal] ?? HELMS_TARGET.mixed

  // Rounding safety — ensure pcts sum to 100
  const sumPct     = primaryPcts.heavy + primaryPcts.moderate + primaryPcts.light
  const lightAdj   = primaryPcts.light + (100 - sumPct)
  const hasNoData  = primary.total === 0

  const zones = [
    { key: 'heavy'    as const, label: 'Vùng Sức mạnh', reps: '1–5 reps',  pct: primaryPcts.heavy,    targetPct: target.heavy,    count: primary.heavy,    ...COLOR.heavy    },
    { key: 'moderate' as const, label: 'Vùng Tăng cơ',  reps: '6–12 reps', pct: primaryPcts.moderate, targetPct: target.moderate, count: primary.moderate, ...COLOR.moderate  },
    { key: 'light'    as const, label: 'Vùng Bền',       reps: '13+ reps',  pct: lightAdj,             targetPct: target.light,    count: primary.light,    ...COLOR.light    },
  ]

  return (
    <div className="space-y-4">
      {/* Source badge */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink/40 flex-1">
          Phân bổ Vùng Rep
        </p>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
          primarySource === 'logged'
            ? 'bg-herb/8 border-herb/20 text-herb'
            : 'bg-ink/5 border-ink/15 text-ink/45',
        )}>
          {primarySource === 'logged'
            ? `${loggedCounts.total} set thực tế tuần này`
            : `Kế hoạch: ${programmedCounts.total} set`}
        </span>
      </div>

      {hasNoData ? (
        <p className="text-sm text-ink/35 text-center py-4">
          Chưa có dữ liệu — ghi nhật ký buổi tập để xem phân bổ.
        </p>
      ) : (
        <>
          {/* Main stacked bar */}
          <div className="flex h-6 rounded-lg overflow-hidden gap-px bg-ink/8">
            {zones.map(z => (
              <div
                key={z.key}
                className={cn('flex items-center justify-center transition-all duration-500', z.bar, z.pct === 0 && 'hidden')}
                style={{ width: `${z.pct}%`, minWidth: z.pct > 0 ? '6px' : undefined }}
                title={`${z.label}: ${z.pct}% (${z.count} set)`}
              >
                {z.pct >= 14 && (
                  <span className="text-[10px] font-bold text-white/90 tabular-nums select-none">
                    {z.pct}%
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Helms reference bar */}
          <div className="flex h-1 rounded-full overflow-hidden gap-px bg-ink/5">
            {zones.map(z => (
              <div key={z.key} className={cn('opacity-40', z.bar)} style={{ width: `${z.targetPct}%` }} />
            ))}
          </div>
          <p className="text-[10px] text-ink/30 text-right">↑ Tỉ lệ khuyến nghị (Eric Helms)</p>

          {/* Zone legend — 3 columns, mobile-safe */}
          <div className="grid grid-cols-3 gap-1.5">
            {zones.map(z => {
              const diff = z.pct - z.targetPct
              return (
                <div key={z.key} className={cn('rounded-lg border px-2 py-2 space-y-0.5', z.bg, z.border)}>
                  <div className="flex items-center gap-1">
                    <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', z.bar)} />
                    <p className={cn('text-[9px] font-semibold leading-tight truncate', z.text)}>{z.label}</p>
                  </div>
                  <p className="text-[8px] text-ink/35">{z.reps}</p>
                  <p className={cn('text-sm font-bold tabular-nums leading-none', z.text)}>{z.pct}%</p>
                  <p className="text-[9px] text-ink/35 tabular-nums">{z.count} set</p>
                  {Math.abs(diff) >= 10 && (
                    <p className={cn('text-[9px] font-semibold tabular-nums', diff > 0 ? 'text-amber' : 'text-danger/70')}>
                      {diff > 0 ? '+' : ''}{diff}%
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Advisory tip */}
          {tip && !isOnTarget && (
            <div className="rounded-lg border border-amber/20 bg-amber/5 px-3 py-2.5 flex items-start gap-2.5">
              <svg className="h-4 w-4 text-amber shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-ink/60 leading-relaxed">{tip}</p>
            </div>
          )}
          {isOnTarget && primary.total >= 5 && goal !== 'mixed' && (
            <div className="rounded-lg border border-herb/20 bg-herb/5 px-3 py-2 flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-herb shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-herb/80 font-medium">Phân bổ đúng mục tiêu — tiếp tục duy trì!</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Muscle Volume row
// ─────────────────────────────────────────────────────────────────────────────
function MuscleRow({
  mv,
  goal,
}: {
  mv: MuscleGroupVolume
  goal: string
}) {
  const { label, colorKey } = volumeStatusLabel(mv)
  const sc = STATUS_COLOR[mv.status]

  // Bar width: scale 0–(MAV + 5) = 0–25 sets for full bar width
  const SCALE = MAV + 5   // 25 sets = 100% visual width
  const barPct = Math.min((mv.programmedSets / SCALE) * 100, 100)

  // Marker positions as % of bar container
  const mevMarkerPct = (MEV / SCALE) * 100   // 40%
  const mavMarkerPct = (MAV / SCALE) * 100   // 80%

  // Hypertrophy cross-check indicator
  const showModerateCheck = goal === 'hypertrophy' && mv.programmedSets >= 1
  const moderateOk = mv.moderatePct >= 60

  return (
    <div className="space-y-1.5">
      {/* Name row */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('h-2 w-2 rounded-full shrink-0', sc.bar)} />
          <p className="text-xs font-semibold text-ink truncate">{mv.muscleVi}</p>
          {/* Hypertrophy zone check badge */}
          {showModerateCheck && (
            <span className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none',
              moderateOk ? 'bg-herb/10 text-herb' : 'bg-amber/10 text-amber',
            )}>
              {mv.moderatePct}% mod
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold tabular-nums text-ink/70">{mv.programmedSets}s</span>
          <span className={cn('text-[10px] font-semibold rounded-full px-2 py-0.5', sc.bg, sc.text)}>
            {label}
          </span>
        </div>
      </div>

      {/* Progress bar with MEV / MAV markers */}
      <div className="relative h-2 rounded-full bg-ink/8 overflow-visible">
        {/* Filled bar */}
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', sc.bar)}
          style={{ width: `${barPct}%` }}
        />
        {/* MEV marker (10 sets) */}
        <div
          className="absolute top-[-2px] bottom-[-2px] w-px bg-ink/20 z-10"
          style={{ left: `${mevMarkerPct}%` }}
          title="Tối thiểu (10 set)"
        />
        {/* MAV marker (20 sets) */}
        <div
          className="absolute top-[-2px] bottom-[-2px] w-px bg-ink/20 z-10"
          style={{ left: `${mavMarkerPct}%` }}
          title="Tối đa (20 set)"
        />
        {/* Logged overlay (if available) */}
        {mv.loggedSets > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/40 transition-all duration-500"
            style={{ width: `${Math.min((mv.loggedSets / SCALE) * 100, 100)}%` }}
            title={`Đã tập: ${mv.loggedSets} set`}
          />
        )}
      </div>

      {/* Zone mini-bar (programmed breakdown for this muscle) */}
      {mv.programmedZones.total > 0 && (
        <div className="flex h-1 rounded-full overflow-hidden gap-px">
          {mv.programmedZones.heavy > 0 && (
            <div className="bg-slate/60" style={{ flex: mv.programmedZones.heavy }} />
          )}
          {mv.programmedZones.moderate > 0 && (
            <div className="bg-herb/70" style={{ flex: mv.programmedZones.moderate }} />
          )}
          {mv.programmedZones.light > 0 && (
            <div className="bg-amber/60" style={{ flex: mv.programmedZones.light }} />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main combined component
// ─────────────────────────────────────────────────────────────────────────────
export function ProgramAuditCard({
  repZoneAudit,
  volumeResult,
  phaseName,
}: ProgramAuditCardProps) {
  const { muscleVolumes, insufficientCount, optimalCount, excessiveCount } = volumeResult
  const { goal } = repZoneAudit

  const hasVolumeData = muscleVolumes.length > 0

  return (
    <div className="space-y-0">

      {/* ── Card header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink/40 mb-0.5">
            Kiểm toán chương trình
          </p>
          <p className="text-sm font-semibold text-ink truncate">{phaseName}</p>
        </div>
        {/* Goal badge */}
        <span className="shrink-0 rounded-full bg-slate/10 border border-slate/20 px-2.5 py-1 text-[10px] font-bold text-slate uppercase tracking-wide">
          {GOAL_VI[goal] ?? 'Hỗn hợp'}
        </span>
      </div>

      {/* ── Two-column layout: rep zones | volume adequacy ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Rep Zone Distribution */}
        <div className="space-y-1">
          <RepZoneSection audit={repZoneAudit} phaseName={phaseName} />
        </div>

        {/* Vertical divider (desktop only) */}
        <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-ink/8 pointer-events-none" />

        {/* Right: Muscle Group Volume Adequacy */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink/40 flex-1">
              Lượng set / nhóm cơ
            </p>
            {/* Summary chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {insufficientCount > 0 && (
                <span className="rounded-full bg-danger/8 border border-danger/20 px-2 py-0.5 text-[10px] font-bold text-danger">
                  {insufficientCount} thiếu
                </span>
              )}
              {optimalCount > 0 && (
                <span className="rounded-full bg-herb/8 border border-herb/20 px-2 py-0.5 text-[10px] font-bold text-herb">
                  {optimalCount} đạt
                </span>
              )}
              {excessiveCount > 0 && (
                <span className="rounded-full bg-amber/8 border border-amber/20 px-2 py-0.5 text-[10px] font-bold text-amber">
                  {excessiveCount} vượt
                </span>
              )}
            </div>
          </div>

          {!hasVolumeData ? (
            <p className="text-sm text-ink/35 text-center py-4">
              Chưa có bài tập nào trong giai đoạn — huấn luyện viên cần thêm bài tập vào kế hoạch.
            </p>
          ) : (
            <>
              {/* Scale legend */}
              <div className="flex items-center gap-3 text-[9px] text-ink/35">
                <span>0 set</span>
                <div className="flex-1 relative h-px bg-ink/10">
                  <span className="absolute left-[40%] -translate-x-1/2 -top-3 font-semibold text-ink/50">
                    10 (tối thiểu)
                  </span>
                  <span className="absolute left-[80%] -translate-x-1/2 -top-3 font-semibold text-ink/50">
                    20 (tối đa)
                  </span>
                </div>
                <span>25+</span>
              </div>

              {/* Muscle rows */}
              <div className="space-y-4">
                {muscleVolumes.map(mv => (
                  <MuscleRow key={mv.muscle} mv={mv} goal={goal} />
                ))}
              </div>

              {/* Rep zone mini-legend */}
              <div className="flex items-center gap-4 text-[9px] text-ink/40 pt-1 border-t border-ink/8">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-3 rounded-sm bg-slate/60 inline-block" />Sức mạnh (1–5)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-3 rounded-sm bg-herb/70 inline-block" />Tăng cơ (6–12)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-3 rounded-sm bg-amber/60 inline-block" />Bền (13+)
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Combined advisory footer ────────────────────────────────────────── */}
      {(insufficientCount > 0 || excessiveCount > 0) && hasVolumeData && (
        <div className="mt-5 pt-4 border-t border-ink/8 rounded-b-xl">
          <div className="space-y-2">
            {insufficientCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg bg-danger/5 border border-danger/15 px-3 py-2.5">
                <svg className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-ink/60 leading-relaxed">
                  <strong className="text-danger">{insufficientCount} nhóm cơ</strong> dưới ngưỡng tối thiểu 10 set/tuần — tăng số set hoặc thêm bài phụ cho các nhóm cơ thiếu để đảm bảo kích thích đủ mức.
                </p>
              </div>
            )}
            {excessiveCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg bg-amber/5 border border-amber/15 px-3 py-2.5">
                <svg className="h-3.5 w-3.5 text-amber shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-ink/60 leading-relaxed">
                  <strong className="text-amber">{excessiveCount} nhóm cơ</strong> vượt ngưỡng 20 set/tuần — cân nhắc giảm bài phụ hoặc hợp nhất các bài tập trùng nhóm cơ để tránh quá tải phục hồi.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
