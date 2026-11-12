import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Week scope picker (migration 011): "Gốc" = base rows that apply to every week,
 * 1..N = that week's own override rows.
 */
export function WeekScopeBar({
  weekBusy, selectedPhaseId, selectedWeek, setSelectedWeek, weekNumbers, weekIsCustomized,
  viewingUncustomizedWeek, baseExerciseCount, customizeWeek, setPendingWeekReset, openPlanImport,
}: {
  weekBusy:                boolean
  selectedPhaseId:         string
  /** null = "Gốc". */
  selectedWeek:            number | null
  setSelectedWeek:         (week: number | null) => void
  weekNumbers:             number[]
  weekIsCustomized:        (week: number) => boolean
  /** A week tab is selected but it still inherits the base (no overrides yet). */
  viewingUncustomizedWeek: boolean
  baseExerciseCount:       number
  customizeWeek:           (week: number) => Promise<void>
  /** Asks for confirmation before resetting that week back to "Gốc". */
  setPendingWeekReset:     (week: number | null) => void
  openPlanImport:          () => void
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">
          Tuần tập
          <span className="ml-2 normal-case font-normal text-[11px] text-ink/40 tracking-normal">
            Set up bài / sets / reps riêng cho từng tuần
          </span>
        </p>
        <div className="flex items-center gap-2">
          {weekBusy && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber border-t-transparent" />
          )}
          {/* One importer for both shapes: many buổi, many tuần, or both. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={openPlanImport}
            disabled={!selectedPhaseId}
            title="Nhập giáo án từ Excel — nhiều buổi trong một tuần, hoặc cả chương trình nhiều tuần"
          >
            ⬆ Nhập từ Excel (tuần & buổi)
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedWeek(null)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
            selectedWeek === null
              ? 'border-ink bg-ink text-paper'
              : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
          )}
        >
          Gốc
        </button>
        {weekNumbers.map(w => {
          const custom = weekIsCustomized(w)
          const active = selectedWeek === w
          return (
            <button
              key={w}
              type="button"
              onClick={() => setSelectedWeek(w)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all inline-flex items-center gap-1.5',
                active
                  ? 'border-amber bg-amber/10 text-amber'
                  : custom
                    ? 'border-amber/40 text-amber/80 hover:bg-amber/5'
                    : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
              )}
            >
              Tuần {w}
              {custom && <span className="h-1.5 w-1.5 rounded-full bg-amber" />}
            </button>
          )
        })}
      </div>

      {selectedWeek === null ? (
        <p className="text-[11px] text-ink/45">
          Đang chỉnh <strong className="text-ink/70">bộ Gốc</strong> — áp dụng cho mọi tuần chưa có bản riêng.
        </p>
      ) : viewingUncustomizedWeek ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/25 bg-amber/5 px-3 py-2">
          <span className="text-[11px] text-ink/60">
            Tuần {selectedWeek} đang dùng bộ Gốc ({baseExerciseCount} bài). Tạo bản riêng để set up khác đi.
          </span>
          <Button
            size="sm"
            variant="secondary"
            loading={weekBusy}
            onClick={() => void customizeWeek(selectedWeek)}
            className="text-amber border-amber/40 hover:bg-amber/10"
          >
            Tùy chỉnh tuần này
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-amber/80">
            Tuần {selectedWeek} có bản riêng — chỉnh bên dưới không ảnh hưởng các tuần khác.
          </span>
          <button
            type="button"
            onClick={() => setPendingWeekReset(selectedWeek)}
            className="text-[11px] font-semibold text-danger/70 hover:text-danger underline underline-offset-2"
          >
            Khôi phục về Gốc
          </button>
        </div>
      )}
    </div>
  )
}
