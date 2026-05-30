'use client'

import { cn } from '@/lib/utils'

interface E1rmDataPoint {
  date: string
  estimated_1rm: number
  weight_kg: number
  actual_reps: number
}

interface E1rmChartProps {
  exerciseName: string
  dataPoints: E1rmDataPoint[]
}

/**
 * CSS-only sparkline showing estimated 1RM progression over time.
 * Mirrors the ExerciseProgress component structure but plots e1RM instead of raw weight.
 */
export function E1rmChart({ exerciseName, dataPoints }: E1rmChartProps) {
  if (dataPoints.length < 2) return null

  const maxE1rm = Math.max(...dataPoints.map(d => d.estimated_1rm), 1)
  const first = dataPoints[0]
  const last = dataPoints[dataPoints.length - 1]
  const delta = last.estimated_1rm - first.estimated_1rm
  const deltaPct = first.estimated_1rm > 0
    ? Math.round((delta / first.estimated_1rm) * 100)
    : 0

  const isProgress = delta > 0
  const isRegress = delta < 0

  // Format date: "DD/MM" from ISO
  function fmtDate(iso: string) {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{exerciseName}</p>
          <p className="text-[10px] text-ink/35 mt-0.5 uppercase tracking-wide">e1RM ước tính</p>
        </div>
        <span
          className={cn(
            'text-xs font-bold rounded-full px-2 py-0.5 shrink-0 tabular-nums',
            isProgress ? 'bg-slate/10 text-slate'
              : isRegress ? 'bg-danger/10 text-danger'
                : 'bg-ink/8 text-ink/60',
          )}
        >
          {delta > 0 ? '+' : ''}{delta.toFixed(1)} kg
          {deltaPct !== 0 ? ` (${deltaPct > 0 ? '+' : ''}${deltaPct}%)` : ''}
        </span>
      </div>

      {/* Sparkline bars */}
      <div className="flex items-end gap-1 h-16">
        {dataPoints.map((pt, i) => {
          const prev = i > 0 ? dataPoints[i - 1] : null
          const higher = prev && pt.estimated_1rm > prev.estimated_1rm
          const lower = prev && pt.estimated_1rm < prev.estimated_1rm
          const pct = maxE1rm > 0 ? (pt.estimated_1rm / maxE1rm) * 100 : 0

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1 group relative"
            >
              {/* Hover tooltip */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-center pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 bg-ink text-paper text-[9px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                {pt.estimated_1rm.toFixed(1)} kg e1RM
                <br />
                <span className="font-normal opacity-70">{pt.weight_kg}×{pt.actual_reps} · {fmtDate(pt.date)}</span>
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

      {/* First → Last */}
      <div className="flex items-center justify-between text-xs text-ink/40">
        <span className="tabular-nums">{first.estimated_1rm.toFixed(1)} kg</span>
        <div className="flex-1 border-t border-dashed border-ink/15 mx-3" />
        <span
          className={cn(
            'font-semibold tabular-nums',
            isProgress ? 'text-slate' : isRegress ? 'text-danger' : 'text-ink/60',
          )}
        >
          {last.estimated_1rm.toFixed(1)} kg
        </span>
      </div>
    </div>
  )
}
