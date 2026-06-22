import { cn } from '@/lib/utils'
import type { Phase } from '@/types'

interface RepRangeMatrixProps {
  phases: Phase[]
}

/**
 * Visualises how rep zones expand across mesocycles.
 * Training phases only; maintenance/active-rest are displayed as a simple label.
 */
export function RepRangeMatrix({ phases }: RepRangeMatrixProps) {
  const trainingPhases = phases
    .filter(p => p.phase_type === 'training')
    .sort((a, b) => a.phase_order - b.phase_order)

  const zones = [
    { label: 'Sức mạnh', min: 1, max: 10, color: 'bg-slate/20 text-slate border-slate/30' },
    { label: 'Tăng cơ', min: 10, max: 20, color: 'bg-herb/20 text-herb border-herb/30' },
    { label: 'Sức bền', min: 20, max: 30, color: 'bg-amber/20 text-amber border-amber/30' },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-ink/50 uppercase tracking-wide pb-3 pr-4">
              Vùng
            </th>
            {trainingPhases.map(phase => (
              <th
                key={phase.id}
                className="text-center text-xs font-semibold text-ink pb-3 px-3"
              >
                {phase.name}
                <span className="block text-ink/40 font-normal">{phase.frequency_per_week}×/tuần</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/6">
          {zones.map(zone => (
            <tr key={zone.label}>
              <td className="py-2 pr-4">
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{zone.label}</span>
                  <span className="text-xs text-ink/40">{zone.min}–{zone.max} reps</span>
                </div>
              </td>
              {trainingPhases.map(phase => {
                const hasZone = (phase.rep_ranges ?? []).some(
                  rr => rr.max > zone.min && rr.min < zone.max,
                )
                return (
                  <td key={phase.id} className="py-2 px-3 text-center">
                    {hasZone ? (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center w-7 h-7 rounded-lg border text-xs font-semibold',
                          zone.color,
                        )}
                      >
                        ✓
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink/4 text-ink/20 text-xs">
                        —
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {/* Frequency row */}
          <tr>
            <td className="py-2 pr-4">
              <div className="flex flex-col">
                <span className="font-medium text-ink">Tần suất</span>
                <span className="text-xs text-ink/40">buổi/tuần/nhóm cơ</span>
              </div>
            </td>
            {trainingPhases.map(phase => (
              <td key={phase.id} className="py-2 px-3 text-center">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink/8 text-ink text-xs font-bold">
                  {phase.frequency_per_week}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
