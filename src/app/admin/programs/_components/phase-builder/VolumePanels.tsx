import type { SplitType, SplitDay } from '@/lib/trainingSplit'
import type { Phase } from '@/types'
import { getVolumeColor, formatSets, SESSION_SET_CAP } from './muscleVolume'

type MuscleVolume = { name: string; sets: number }

/** Weekly volume per anatomical muscle group, with the Helms / RP landmarks. */
export function WeeklyVolumeSummary({
  weeklyVolumeByMuscle, selectedPhase, splitType, rawWeeklySets, maxMuscleSets,
}: {
  weeklyVolumeByMuscle: MuscleVolume[]
  selectedPhase:        Phase
  splitType:            SplitType | null
  rawWeeklySets:        number
  maxMuscleSets:        number
}) {
  return (
    <div className="rounded-xl border border-ink/8 bg-white overflow-hidden">

      {/* ── Header ── */}
      <div className="px-5 py-3.5 border-b border-ink/6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink/35">
            Volume tuần / nhóm cơ — {selectedPhase.name}
          </p>
          {!splitType && selectedPhase.frequency_per_week > 1 && (
            <p className="text-[10px] text-amber/70 mt-0.5">
              Nhân ×{selectedPhase.frequency_per_week}/tuần (chưa chia lịch)
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="font-mono text-xl font-bold text-ink leading-none tabular-nums">
            {rawWeeklySets}
          </span>
          <span className="text-xs text-ink/40 ml-1.5">hiệp/tuần</span>
        </div>
      </div>

      {/* ── Muscle group rows ── */}
      <div className="px-5 py-4 space-y-3">
        {weeklyVolumeByMuscle.map(({ name, sets }) => {
          const barPct = maxMuscleSets > 0
            ? Math.round((sets / maxMuscleSets) * 100)
            : 0
          const { barClass, textClass, rangeLabel } = getVolumeColor(sets)
          return (
            <div key={name} className="flex items-center gap-3">
              {/* Muscle group name */}
              <p className="w-24 sm:w-44 shrink-0 text-xs font-medium text-ink/65 truncate">
                {name}
              </p>

              {/* Progress bar */}
              <div className="flex-1 h-1.5 rounded-full bg-ink/6 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              {/* Set count + range label */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-mono text-xs font-semibold tabular-nums w-8 text-right ${textClass}`}
                >
                  {formatSets(sets)}
                </span>
                <span className="text-[10px] text-ink/30 w-[52px] leading-tight">
                  {rangeLabel}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Legend ── */}
      <div className="px-5 py-2.5 border-t border-ink/6 flex items-center gap-x-5 gap-y-1.5 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest text-ink/20 font-semibold">
          Helms / RP
        </span>
        {([
          { cls: 'bg-ink/25',    label: '< 6 — Sub-MEV' },
          { cls: 'bg-herb',      label: '6–11 — MEV'    },
          { cls: 'bg-amber',     label: '12–19 — MAV'   },
          { cls: 'bg-danger/65', label: '≥ 20 — MRV ↑'  },
        ] as const).map(({ cls, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`h-1.5 w-5 rounded-full ${cls}`} />
            <span className="text-[9px] text-ink/30">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Cảnh báo khi một nhóm cơ vượt quá SESSION_SET_CAP hiệp trong một buổi tập. */
export function SessionOverloadWarning({
  overloadedMuscles, splitType, activeDay,
}: {
  overloadedMuscles: MuscleVolume[]
  splitType:         SplitType | null
  activeDay:         SplitDay | null
}) {
  return (
    <div className="rounded-xl border border-amber/40 bg-amber/8 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="text-amber text-base leading-none mt-0.5">⚠</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber">
            Quá tải buổi tập
            {splitType && activeDay ? ` — ${activeDay.label}` : ''}
          </p>
          <p className="text-[11px] text-ink/60 mt-1 leading-relaxed">
            Nghiên cứu mới khuyến nghị mỗi nhóm cơ không quá{' '}
            <span className="font-semibold text-ink/75">{SESSION_SET_CAP} hiệp</span>{' '}
            trong một buổi — vượt ngưỡng có thể làm giảm hiệu quả tăng cơ.
            Hãy cân nhắc giảm bớt hoặc chuyển sang buổi khác:
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {overloadedMuscles.map(({ name, sets }) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-white px-2.5 py-0.5 text-[11px] font-medium text-amber"
              >
                {name}
                <span className="font-mono font-bold tabular-nums">
                  {formatSets(sets)} hiệp
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
