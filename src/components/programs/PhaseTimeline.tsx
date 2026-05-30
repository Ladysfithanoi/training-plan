import { cn, phaseTypeLabel, phaseTypeBadgeClass, currentWeekInPhase, isPhaseExpired } from '@/lib/utils'
import type { Phase, UserProgram } from '@/types'

interface PhaseTimelineProps {
  phases: Phase[]
  userProgram?: UserProgram
}

export function PhaseTimeline({ phases, userProgram }: PhaseTimelineProps) {
  const sorted = [...phases].sort((a, b) => a.phase_order - b.phase_order)
  const currentPhaseId = userProgram?.current_phase_id

  return (
    <div className="space-y-2">
      {sorted.map((phase, idx) => {
        const isCurrent = phase.id === currentPhaseId
        const isPast =
          !isCurrent &&
          sorted.findIndex(p => p.id === currentPhaseId) > idx

        const weekNum = isCurrent && userProgram?.phase_start_date
          ? currentWeekInPhase(userProgram.phase_start_date)
          : null

        const expired = isCurrent && userProgram?.phase_start_date
          ? isPhaseExpired(userProgram.phase_start_date, phase.duration_weeks)
          : false

        return (
          <div
            key={phase.id}
            className={cn(
              'flex items-start gap-4 rounded-xl p-4 border transition-all',
              isCurrent
                ? 'bg-white border-ink/15 shadow-sm'
                : isPast
                ? 'bg-ink/3 border-transparent opacity-60'
                : 'bg-white/50 border-ink/6',
            )}
          >
            {/* Step indicator */}
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold font-mono border-2',
                isCurrent
                  ? 'bg-ink text-paper border-ink'
                  : isPast
                  ? 'bg-ink/20 text-ink/40 border-ink/20'
                  : 'bg-paper text-ink/30 border-ink/15',
              )}
            >
              {idx + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-1">
                <span className="text-sm font-semibold text-ink">{phase.name}</span>
                <span className={cn('text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5', phaseTypeBadgeClass(phase.phase_type))}>
                  {phaseTypeLabel(phase.phase_type)}
                </span>
                {isCurrent && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber/15 text-amber border border-amber/25">
                    Hiện tại
                  </span>
                )}
                {expired && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-danger/12 text-danger border border-danger/25">
                    Đến hạn chuyển giai đoạn
                  </span>
                )}
              </div>

              <p className="text-xs text-ink/50">
                {phase.duration_weeks} tuần
                {phase.phase_type === 'training' && ` · ${phase.frequency_per_week}×/tuần`}
                {phase.phase_type === 'maintenance' && ' · 2×/tuần · 5–10 reps'}
                {phase.phase_type === 'active_rest' && ` · ≤${phase.max_rir ?? 10} RIR`}
              </p>

              {/* Rep range zones */}
              {phase.rep_ranges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {phase.rep_ranges.map((rr, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-md bg-ink/6 px-2 py-0.5 text-[10px] font-medium font-mono text-ink/70"
                    >
                      {rr.min}–{rr.max} reps
                      {rr.exercise_type && ` (${rr.exercise_type})`}
                    </span>
                  ))}
                </div>
              )}

              {/* Progress bar for current phase */}
              {isCurrent && weekNum !== null && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-ink/40 mb-1 font-mono">
                    <span>Tuần {weekNum}</span>
                    <span>Tổng {phase.duration_weeks} tuần</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink/8 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-herb transition-all"
                      style={{ width: `${Math.min(100, (weekNum / phase.duration_weeks) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
