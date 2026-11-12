import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { SplitDay } from '@/lib/trainingSplit'
import type { PhaseExerciseRow } from './shared'

/**
 * Orphan-recovery banner — exercises that lost their day (e.g. from a previous
 * split-type change). Coach ticks the ones to move, picks a target day, then
 * confirms — or deletes them.
 */
export function OrphanPanel({
  orphanExercises, selectedOrphanIds, orphanTargetDayId, setOrphanTargetDayId,
  activeDayId, activeDay, splitDays, assigningOrphans,
  toggleSelectAllOrphans, toggleOrphanSelection,
  assignOrphansToActiveDay, assignSelectedOrphansToDay, setPendingDelete,
}: {
  orphanExercises:            PhaseExerciseRow[]
  selectedOrphanIds:          Set<string>
  orphanTargetDayId:          string | null
  setOrphanTargetDayId:       (dayId: string | null) => void
  activeDayId:                string | null
  activeDay:                  SplitDay | null
  splitDays:                  SplitDay[]
  assigningOrphans:           boolean
  toggleSelectAllOrphans:     () => void
  toggleOrphanSelection:      (id: string) => void
  assignOrphansToActiveDay:   () => Promise<void>
  assignSelectedOrphansToDay: () => Promise<void>
  /** Opens the delete confirmation for the ticked orphans. */
  setPendingDelete:           (pending: { kind: 'orphans'; ids: string[] }) => void
}) {
  const selectedCount = orphanExercises.filter(e => selectedOrphanIds.has(e.id)).length
  const effectiveTargetId = orphanTargetDayId ?? activeDayId
  const targetDay = splitDays.find(d => d.id === effectiveTargetId) ?? null
  return (
  <div className="rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 space-y-3">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-amber/90">
          ⚠ {orphanExercises.length} bài tập chưa thuộc ngày nào
        </p>
        <p className="text-xs text-ink/55 mt-0.5">
          Tích chọn bài tập rồi chuyển vào một ngày — hoặc xoá hẳn khỏi giáo án. “Chọn tất cả” để thao tác với toàn bộ.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={toggleSelectAllOrphans}
          className="text-xs font-semibold text-ink/55 hover:text-ink px-2 py-1 rounded hover:bg-ink/5 transition-colors"
        >
          {selectedCount === orphanExercises.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
        </button>
        {activeDay && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void assignOrphansToActiveDay()}
            disabled={assigningOrphans}
          >
            Chuyển tất cả vào “{activeDay.label}”
          </Button>
        )}
      </div>
    </div>

    {/* Selectable exercise chips — click to toggle the green check */}
    <div className="flex flex-wrap gap-1.5">
      {orphanExercises.map(pe => {
        const checked = selectedOrphanIds.has(pe.id)
        return (
          <button
            key={pe.id}
            type="button"
            onClick={() => toggleOrphanSelection(pe.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              checked
                ? 'border-herb bg-herb/10 text-herb font-semibold'
                : 'border-ink/10 bg-white text-ink/70 hover:border-ink/25',
            )}
          >
            <span className={cn(
              'flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border text-[9px] leading-none',
              checked ? 'border-herb bg-herb text-white' : 'border-ink/25 bg-white',
            )}>
              {checked ? '✓' : ''}
            </span>
            {pe.exercise?.name ?? '—'}
          </button>
        )
      })}
    </div>

    {/* Target-day picker + confirm — only meaningful once something is ticked */}
    {selectedCount > 0 && (
      <div className="flex flex-wrap items-center gap-2 border-t border-amber/20 pt-2.5">
        <span className="text-xs text-ink/55">
          Chuyển <span className="font-semibold text-ink">{selectedCount}</span> bài đã chọn vào:
        </span>
        {splitDays.map(day => (
          <button
            key={day.id}
            type="button"
            onClick={() => setOrphanTargetDayId(day.id)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all',
              effectiveTargetId === day.id
                ? 'border-amber bg-amber/10 text-amber'
                : 'border-ink/12 text-ink/55 hover:border-ink/25 hover:text-ink',
            )}
          >
            {day.label}
          </button>
        ))}
        <Button
          size="sm"
          onClick={() => void assignSelectedOrphansToDay()}
          disabled={assigningOrphans || !effectiveTargetId}
        >
          {assigningOrphans ? 'Đang chuyển…' : `Chuyển vào “${targetDay?.label ?? '—'}”`}
        </Button>
        <button
          type="button"
          onClick={() => setPendingDelete({
            kind: 'orphans',
            ids:  orphanExercises.filter(e => selectedOrphanIds.has(e.id)).map(e => e.id),
          })}
          disabled={assigningOrphans}
          className="text-xs font-semibold text-danger/70 hover:text-danger px-2.5 py-1.5 rounded-lg hover:bg-danger/8 transition-colors disabled:opacity-40"
        >
          Xoá {selectedCount} bài đã chọn
        </button>
      </div>
    )}
  </div>
  )
}
