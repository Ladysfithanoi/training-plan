'use client'

import { cn } from '@/lib/utils'

interface DataPoint {
  date: string
  weight_kg: number
  actual_reps: number
}

interface ExerciseProgressProps {
  exerciseName: string
  dataPoints: DataPoint[]
}

export function ExerciseProgress({ exerciseName, dataPoints }: ExerciseProgressProps) {
  if (dataPoints.length < 2) return null

  const maxWeight = Math.max(...dataPoints.map(d => d.weight_kg), 1)
  const first = dataPoints[0]
  const last = dataPoints[dataPoints.length - 1]
  const delta = last.weight_kg - first.weight_kg
  const deltaPct = first.weight_kg > 0
    ? Math.round((delta / first.weight_kg) * 100)
    : 0

  const isProgress = delta > 0
  const isRegress = delta < 0

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{exerciseName}</p>
        <span className={cn(
          'text-xs font-bold rounded-full px-2 py-0.5 shrink-0',
          isProgress ? 'bg-slate/10 text-slate'
            : isRegress ? 'bg-danger/10 text-danger'
              : 'bg-ink/8 text-ink/60',
        )}>
          {delta > 0 ? '+' : ''}{delta.toFixed(1)} kg
          {deltaPct !== 0 ? ` (${deltaPct > 0 ? '+' : ''}${deltaPct}%)` : ''}
        </span>
      </div>

      {/* Sparkline bars */}
      <div className="flex items-end gap-1 h-16">
        {dataPoints.map((pt, i) => {
          const prev = i > 0 ? dataPoints[i - 1] : null
          const higher = prev && pt.weight_kg > prev.weight_kg
          const lower = prev && pt.weight_kg < prev.weight_kg

          const pct = maxWeight > 0 ? (pt.weight_kg / maxWeight) * 100 : 0

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1 group relative"
            >
              {/* Tooltip */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-center pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 bg-ink text-paper text-[9px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                {pt.weight_kg}kg × {pt.actual_reps}
              </div>

              {/* Bar */}
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn(
                    'w-full rounded-t transition-all duration-300',
                    i === dataPoints.length - 1
                      ? isProgress ? 'bg-slate' : isRegress ? 'bg-danger' : 'bg-ink/30'
                      : higher ? 'bg-slate/50'
                        : lower ? 'bg-danger/50'
                          : 'bg-ink/15',
                  )}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Đầu → Cuối */}
      <div className="flex items-center justify-between text-xs text-ink/40">
        <span>{first.weight_kg} kg</span>
        <div className="flex-1 border-t border-dashed border-ink/15 mx-3" />
        <span className={cn(
          'font-semibold',
          isProgress ? 'text-slate' : isRegress ? 'text-danger' : 'text-ink/60',
        )}>
          {last.weight_kg} kg
        </span>
      </div>
    </div>
  )
}
