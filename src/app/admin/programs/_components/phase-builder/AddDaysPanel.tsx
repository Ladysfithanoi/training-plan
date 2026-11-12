import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { availableDayTypes, buildDayBatch, DAY_TYPE_LABELS } from '@/lib/trainingSplit'
import type { SplitType, SplitDay, DayType } from '@/lib/trainingSplit'
import { MAX_NEW_DAYS_PER_TYPE } from './shared'

/**
 * Bảng "Thêm ngày": coach chọn SỐ BUỔI cho từng loại rồi thêm tất cả một lượt.
 * The panel is mounted only while it is open, so its counters start from zero
 * every time it is opened.
 */
export function AddDaysPanel({
  splitType, splitDays, onAdd, closeAddDays,
}: {
  splitType:    SplitType
  splitDays:    SplitDay[]
  /** Receives the days to append to the split (still a draft until saved). */
  onAdd:        (newDays: SplitDay[]) => void
  closeAddDays: () => void
}) {
  const [newDayCounts, setNewDayCounts]     = useState<Partial<Record<DayType, number>>>({})
  // Tên tự đặt cho từng buổi "Khác" được yêu cầu, theo thứ tự. Để trống = tự sinh.
  const [newOtherLabels, setNewOtherLabels] = useState<string[]>([])

  // Các ngày sắp được thêm theo cấu hình hiện tại của bảng — dùng cho cả dòng xem
  // trước lẫn lúc bấm "Thêm", nên nhãn hiện ra đúng bằng nhãn được tạo. Ghi nhớ
  // theo cấu hình để id không đổi giữa các lần render.
  const pendingNewDays = useMemo(
    () => (splitType
      ? buildDayBatch(splitDays, newDayCounts, availableDayTypes(splitType), newOtherLabels)
      : []),
    [splitType, splitDays, newDayCounts, newOtherLabels],
  )

  /** +1 / −1 số buổi của một loại trong bảng thêm ngày (giới hạn 0…MAX_NEW_DAYS). */
  function bumpNewDayCount(type: DayType, delta: number) {
    setNewDayCounts(prev => ({
      ...prev,
      [type]: Math.min(MAX_NEW_DAYS_PER_TYPE, Math.max(0, (prev[type] ?? 0) + delta)),
    }))
  }

  /**
   * Thêm trọn một vòng split (mỗi loại buổi chính +1) — lối tắt cho các giáo án
   * chạy nhiều vòng mỗi tuần, vd PPL 2 vòng: bấm 2 lần là đủ 6 buổi.
   * Buổi "Khác" không nằm trong vòng vì nó là buổi tự do, không thuộc chu kỳ.
   */
  function addSplitCycle() {
    if (!splitType) return
    setNewDayCounts(prev => {
      const next = { ...prev }
      for (const t of availableDayTypes(splitType)) {
        if (t === 'other') continue
        next[t] = Math.min(MAX_NEW_DAYS_PER_TYPE, (next[t] ?? 0) + 1)
      }
      return next
    })
  }

  /** Ghi tên coach nhập cho buổi "Khác" thứ idx của lô sắp thêm. */
  function setNewOtherLabelAt(idx: number, value: string) {
    setNewOtherLabels(prev => {
      const next = prev.slice()
      next[idx] = value
      return next
    })
  }

  function handleAddDays() {
    if (pendingNewDays.length === 0) return
    onAdd(pendingNewDays)
  }

  return (
    <div className="mt-3 rounded-xl border border-amber/25 bg-amber/[0.04] px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          Thêm nhiều ngày tập cùng lúc
        </p>
        {/* Lối tắt: +1 vòng split (bỏ qua buổi "Khác") */}
        {availableDayTypes(splitType).some(t => t !== 'other') && (
          <button
            onClick={addSplitCycle}
            title="Mỗi loại buổi chính +1 — bấm 2 lần cho giáo án 2 vòng/tuần"
            className="rounded-lg border border-amber/35 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber hover:bg-amber/10 transition-colors"
          >
            + 1 vòng split
          </button>
        )}
      </div>

      {/* Bộ đếm số buổi theo từng loại */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {availableDayTypes(splitType).map(t => {
          const count = newDayCounts[t] ?? 0
          return (
            <div
              key={t}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 transition-colors',
                count > 0 ? 'border-amber/45' : 'border-ink/10',
              )}
            >
              <span className="flex-1 truncate text-xs font-medium text-ink/70">
                {DAY_TYPE_LABELS[t]}
              </span>
              <button
                onClick={() => bumpNewDayCount(t, -1)}
                disabled={count === 0}
                title="Bớt 1 buổi"
                className="h-6 w-6 rounded flex items-center justify-center text-sm font-bold text-ink/45 hover:bg-ink/8 hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                −
              </button>
              <span className={cn(
                'w-5 text-center text-xs font-bold tabular-nums',
                count > 0 ? 'text-amber' : 'text-ink/25',
              )}>
                {count}
              </span>
              <button
                onClick={() => bumpNewDayCount(t, 1)}
                disabled={count >= MAX_NEW_DAYS_PER_TYPE}
                title="Thêm 1 buổi"
                className="h-6 w-6 rounded flex items-center justify-center text-sm font-bold text-ink/45 hover:bg-ink/8 hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                +
              </button>
            </div>
          )
        })}
      </div>

      {/* Buổi "Khác" → cho phép coach nhập tên buổi tự do, mỗi buổi một ô */}
      {(newDayCounts.other ?? 0) > 0 && (
        <div className="mt-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/35">
            Tên các buổi “Khác” — để trống sẽ tự đặt tên
          </p>
          {Array.from({ length: newDayCounts.other ?? 0 }).map((_, i) => (
            <input
              key={i}
              type="text"
              value={newOtherLabels[i] ?? ''}
              onChange={e => setNewOtherLabelAt(i, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleAddDays()
                if (e.key === 'Escape') closeAddDays()
              }}
              autoFocus={i === 0}
              placeholder={`Tên buổi ${i + 1}…`}
              className="w-full rounded border border-ink/15 bg-white px-2 py-1 text-xs text-ink focus:border-amber outline-none"
            />
          ))}
        </div>
      )}

      {/* Xem trước + hành động */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-relaxed text-ink/50">
          {pendingNewDays.length === 0 ? (
            'Chọn số buổi cho từng loại rồi bấm Thêm.'
          ) : (
            <>
              Sẽ thêm{' '}
              <span className="font-semibold text-ink/75">{pendingNewDays.length}</span>
              {' '}ngày:{' '}
              <span className="text-ink/70">
                {pendingNewDays.map(d => d.label).join(' · ')}
              </span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleAddDays}
            disabled={pendingNewDays.length === 0}
            className="rounded px-2 py-1 text-xs font-semibold text-herb hover:bg-herb/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {pendingNewDays.length > 0 ? `Thêm ${pendingNewDays.length} ngày` : 'Thêm'}
          </button>
          <button
            onClick={closeAddDays}
            className="rounded px-1.5 py-1 text-xs text-ink/40 hover:bg-ink/5 transition-colors"
          >
            Huỷ
          </button>
        </div>
      </div>
    </div>
  )
}
