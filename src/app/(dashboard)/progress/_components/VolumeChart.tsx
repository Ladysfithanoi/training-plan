'use client'

import { cn } from '@/lib/utils'

interface WeekData {
  label: string
  volume: number
  sessions: number
}

interface VolumeChartProps {
  data: WeekData[]
}

export function VolumeChart({ data }: VolumeChartProps) {
  const maxVolume = Math.max(...data.map(d => d.volume), 1)
  const lastIdx = data.length - 1
  const prevIdx = data.length - 2

  return (
    <div className="space-y-4">
      {/* Biểu đồ thanh */}
      <div className="flex items-end gap-2 h-40 px-1">
        {data.map((week, i) => {
          const prev = i > 0 ? data[i - 1] : null
          const isRegression = prev && week.volume > 0 && prev.volume > 0 && week.volume < prev.volume
          const isImprovement = prev && week.volume > 0 && prev.volume > 0 && week.volume > prev.volume
          const isEmpty = week.volume === 0

          const pct = maxVolume > 0 ? (week.volume / maxVolume) * 100 : 0
          const heightStyle = `${Math.max(pct, isEmpty ? 0 : 2)}%`

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1.5 group"
            >
              {/* Tooltip */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-center pointer-events-none">
                <p className="text-[10px] font-semibold text-ink">
                  {week.volume > 0 ? `${(week.volume / 1000).toFixed(1)}t` : '—'}
                </p>
                <p className="text-[9px] text-ink/40">{week.sessions} buổi</p>
              </div>

              {/* Bar */}
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn(
                    'w-full rounded-t-md transition-all duration-500',
                    isEmpty
                      ? 'bg-ink/6'
                      : isRegression
                        ? 'bg-danger/70'
                        : isImprovement
                          ? 'bg-slate/70'
                          : 'bg-ink/20',
                  )}
                  style={{ height: isEmpty ? '4px' : heightStyle }}
                />
              </div>

              {/* Week label */}
              <p className="text-[9px] text-ink/40 text-center leading-tight">{week.label}</p>
            </div>
          )
        })}
      </div>

      {/* Chú thích màu sắc */}
      <div className="flex items-center gap-4 text-[10px] text-ink/50 justify-end">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-slate/70 shrink-0" />
          Cải thiện
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-danger/70 shrink-0" />
          Giảm sút
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-ink/20 shrink-0" />
          Ổn định
        </span>
      </div>

      {/* Thống kê tóm tắt */}
      {data.length >= 2 && (
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-ink/8">
          {(() => {
            const withData = data.filter(d => d.volume > 0)
            const avg = withData.length
              ? Math.round(withData.reduce((s, d) => s + d.volume, 0) / withData.length)
              : 0
            const peak = Math.max(...data.map(d => d.volume))
            const current = data[lastIdx]?.volume ?? 0
            const prior = data[prevIdx]?.volume ?? 0
            const changePct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null

            return (
              <>
                <div className="text-center">
                  <p className="text-lg font-bold text-ink">
                    {avg > 0 ? `${(avg / 1000).toFixed(1)}t` : '—'}
                  </p>
                  <p className="text-xs text-ink/40">TB / tuần</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-ink">
                    {peak > 0 ? `${(peak / 1000).toFixed(1)}t` : '—'}
                  </p>
                  <p className="text-xs text-ink/40">Tuần cao nhất</p>
                </div>
                <div className="text-center">
                  <p className={cn(
                    'text-lg font-bold',
                    changePct === null ? 'text-ink'
                      : changePct > 0 ? 'text-slate'
                        : changePct < 0 ? 'text-danger'
                          : 'text-ink',
                  )}>
                    {changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%`}
                  </p>
                  <p className="text-xs text-ink/40">So với tuần trước</p>
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
