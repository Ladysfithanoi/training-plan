import type { Dispatch, RefObject, SetStateAction } from 'react'
import { cn } from '@/lib/utils'
import { getSplitConfig, SPLIT_TYPE_OPTIONS, PATTERN_NAMES_BY_DAY } from '@/lib/trainingSplit'
import type { SplitType, SplitDay, DayType } from '@/lib/trainingSplit'
import type { Phase } from '@/types'
import { AddDaysPanel } from './AddDaysPanel'
import type { PhaseExerciseRow, SaveStatus } from './shared'

/**
 * "Kiểu Chương Trình Tập" card: split type picker, the explicit "Lưu cấu hình
 * giáo án" button, the day tab strip (rename / reorder / delete / add days) and
 * the active-day hint. Purely presentational — all state lives in the builder.
 */
export function SplitConfigCard({
  recommended, splitType, selectedPhase, handleSetSplitType,
  handleSaveConfig, saveStatus, configDirty, saveErrorMsg,
  splitDays, activeDayId, setActiveDayId, activeDay,
  renamingDayId, setRenamingDayId, renameRef, renameLabel, setRenameLabel,
  startRenameDay, commitRenameDay, moveDay, handleDeleteDay,
  addingDay, setAddingDay, handleAddDays,
  scopedExercises, visibleExercises,
}: {
  /** Split suggested for the phase's weekly frequency (shown until one is chosen). */
  recommended:        SplitType | null
  splitType:          SplitType | null
  selectedPhase:      Phase
  handleSetSplitType: (type: SplitType) => void
  handleSaveConfig:   () => Promise<void>
  saveStatus:         SaveStatus
  /** Unsaved split-config changes (type or days differ from the saved baseline). */
  configDirty:        boolean
  saveErrorMsg:       string | null
  splitDays:          SplitDay[]
  activeDayId:        string | null
  setActiveDayId:     (dayId: string) => void
  activeDay:          SplitDay | null
  /** Day whose label is being edited inline (null = none). */
  renamingDayId:      string | null
  setRenamingDayId:   (dayId: string | null) => void
  renameRef:          RefObject<HTMLInputElement | null>
  renameLabel:        string
  setRenameLabel:     (label: string) => void
  startRenameDay:     (day: SplitDay) => void
  commitRenameDay:    () => void
  moveDay:            (dayId: string, dir: -1 | 1) => void
  handleDeleteDay:    (dayId: string) => void
  addingDay:          boolean
  setAddingDay:       Dispatch<SetStateAction<boolean>>
  handleAddDays:      (newDays: SplitDay[]) => void
  /** Exercises of the week scope being edited — used for the per-day count pills. */
  scopedExercises:    PhaseExerciseRow[]
  visibleExercises:   PhaseExerciseRow[]
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">

      {/* Header row — stacks on mobile so the controls never overlap the title */}
      <div className="px-4 sm:px-5 py-4 border-b border-ink/8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">
            Kiểu Chương Trình Tập
          </p>
          {recommended && !splitType && (
            <p className="text-xs text-ink/50 mt-0.5">
              Gợi ý cho{' '}
              <strong className="text-ink">{selectedPhase.frequency_per_week} buổi/tuần</strong>:{' '}
              <button
                onClick={() => handleSetSplitType(recommended)}
                className="text-amber font-semibold underline underline-offset-2 hover:text-amber/70"
              >
                {getSplitConfig(recommended).label}
              </button>
            </p>
          )}
          {splitType && (
            <p className="text-sm font-medium text-ink mt-0.5">
              {getSplitConfig(splitType).label}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {/* ── Lưu cấu hình giáo án — explicit save button ── */}
          {splitType && (
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saveStatus === 'saving'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all',
                saveStatus === 'saved'
                  ? 'border-herb/40 bg-herb/8 text-herb'
                  : saveStatus === 'error'
                    ? 'border-danger/40 bg-danger/8 text-danger'
                    : saveStatus === 'saving'
                      ? 'border-amber/30 bg-amber/8 text-amber cursor-wait'
                      : saveStatus === 'nochange'
                        ? 'border-ink/20 bg-ink/5 text-ink/50'
                        : configDirty
                          ? 'border-amber/50 bg-amber/8 text-amber'
                          : 'border-ink/20 bg-white text-ink hover:border-amber/50 hover:bg-amber/5 hover:text-amber',
              )}
            >
              {saveStatus === 'saving' && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              {saveStatus === 'saved'    && <span>✓</span>}
              {saveStatus === 'error'    && <span>✕</span>}
              {saveStatus === 'nochange' && <span>•</span>}
              {saveStatus === 'idle' && configDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber" />}
              {saveStatus === 'saving'   ? 'Đang lưu…'
               : saveStatus === 'saved'    ? 'Đã lưu cấu hình'
               : saveStatus === 'error'    ? 'Lưu thất bại — thử lại'
               : saveStatus === 'nochange' ? 'Không có thay đổi'
               : configDirty ? 'Lưu cấu hình giáo án *'
               : 'Lưu cấu hình giáo án'}
            </button>
          )}

          {/* Split type dropdown */}
          <select
            value={splitType ?? ''}
            onChange={e => {
              const val = e.target.value as SplitType
              if (val) handleSetSplitType(val)
            }}
            className="flex-1 sm:flex-none min-w-[150px] rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
          >
            <option value="">— Chọn kiểu split —</option>
            {SPLIT_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Server-side reason when a save fails — surfaced so issues aren't
          hidden behind a generic "Lưu thất bại". */}
      {saveStatus === 'error' && saveErrorMsg && (
        <div className="mx-5 mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          Lỗi: {saveErrorMsg}
        </div>
      )}

      {/* Split description + day tabs */}
      {splitType && (
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-ink/50 leading-relaxed">
            {getSplitConfig(splitType).description}
          </p>

          {/* Day tab strip */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-ink/40 uppercase tracking-wide shrink-0">
                Các ngày:
              </span>

              {splitDays.map((day, dayIdx) => (
                <div key={day.id} className="flex items-center gap-0.5 group">
                  {renamingDayId === day.id ? (
                    /* ── Inline rename ── */
                    <div className="flex items-center gap-1">
                      <input
                        ref={renameRef}
                        type="text"
                        value={renameLabel}
                        onChange={e => setRenameLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  commitRenameDay()
                          if (e.key === 'Escape') setRenamingDayId(null)
                        }}
                        className="rounded border border-amber px-2 py-1 text-sm font-medium text-ink focus:outline-none w-32"
                      />
                      <button onClick={commitRenameDay}
                        className="text-xs text-herb font-semibold px-1.5 py-1 rounded hover:bg-herb/10">
                        ✓
                      </button>
                      <button onClick={() => setRenamingDayId(null)}
                        className="text-xs text-ink/40 font-semibold px-1.5 py-1 rounded hover:bg-ink/5">
                        ✕
                      </button>
                    </div>
                  ) : (
                    /* ── Day tab button ── */
                    <button
                      onClick={() => setActiveDayId(day.id)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5',
                        activeDayId === day.id
                          ? 'border-amber bg-amber/10 text-amber'
                          : 'border-ink/12 text-ink/55 hover:border-ink/25 hover:text-ink',
                      )}
                    >
                      {day.label}
                      {/* Pill showing how many exercises are assigned —
                          scoped to the current week (Gốc or override) so it
                          matches the table below (migration 011). */}
                      {(() => {
                        const n = scopedExercises.filter(pe => pe.day_id === day.id).length
                        return n > 0 ? (
                          <span className={cn(
                            'rounded-full text-[9px] font-bold px-1.5 py-0.5 leading-none',
                            activeDayId === day.id
                              ? 'bg-amber/25 text-amber'
                              : 'bg-ink/10 text-ink/50',
                          )}>
                            {n}
                          </span>
                        ) : null
                      })()}
                    </button>
                  )}

                  {/* Per-tab actions — visible on hover */}
                  {renamingDayId !== day.id && (
                    <div className="flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {splitDays.length > 1 && (
                        <>
                          <button
                            onClick={() => moveDay(day.id, -1)}
                            disabled={dayIdx === 0}
                            title="Chuyển sang trái"
                            className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveDay(day.id, 1)}
                            disabled={dayIdx === splitDays.length - 1}
                            title="Chuyển sang phải"
                            className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => startRenameDay(day)}
                        title="Đổi tên ngày"
                        className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 transition-colors"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      {splitDays.length > 1 && (
                        <button
                          onClick={() => handleDeleteDay(day.id)}
                          title="Xoá ngày"
                          className="h-6 w-6 rounded flex items-center justify-center text-danger/40 hover:text-danger hover:bg-danger/8 transition-colors"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Add day button — mở bảng thêm nhiều ngày một lượt */}
              <button
                onClick={() => setAddingDay(v => !v)}
                className={cn(
                  'rounded-lg border border-dashed px-3 py-1.5 text-xs font-medium transition-colors',
                  addingDay
                    ? 'border-amber/60 bg-amber/10 text-amber'
                    : 'border-ink/20 text-ink/40 hover:border-ink/35 hover:text-ink/60',
                )}
              >
                + Thêm ngày
              </button>
            </div>

            {/* ── Bảng thêm nhiều ngày tập cùng lúc ── */}
            {addingDay && (
              <AddDaysPanel
                splitType={splitType}
                splitDays={splitDays}
                onAdd={handleAddDays}
                closeAddDays={() => setAddingDay(false)}
              />
            )}

            {/* Active day description */}
            {activeDay && splitType && (
              <div className="mt-3 rounded-lg bg-amber/5 border border-amber/15 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber shrink-0" />
                  <p className="text-xs font-semibold text-amber">
                    Đang cấu hình: {activeDay.label}
                  </p>
                  <span className="ml-auto text-[10px] text-ink/35">
                    {visibleExercises.length} bài tập
                  </span>
                </div>
                {PATTERN_NAMES_BY_DAY[activeDay.type as DayType]?.length > 0 && (
                  <p className="text-[11px] text-ink/45 mt-1 pl-3.5">
                    Chuỗi chuyển động phù hợp:{' '}
                    <span className="text-ink/65 font-medium">
                      {PATTERN_NAMES_BY_DAY[activeDay.type as DayType].join(' · ')}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
