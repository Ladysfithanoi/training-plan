import { TechniqueButton } from '@/components/training/TechniqueButton'
import { cn } from '@/lib/utils'
import { InlineNumberCell, orderBadgeClass } from './shared'
import type { NumericField, PhaseExerciseRow } from './shared'

/** The prescription table of the active day (STT, exercise, sets / reps / RIR, row actions). */
export function ExerciseTable({
  visibleExercises, editingOLId, editingOLValue, setEditingOLValue, setEditingOLId,
  commitOrderLabel, startEditOrderLabel, handleUpdateNumeric, moveExercise,
  startEditExercise, handleRemove,
}: {
  visibleExercises:    PhaseExerciseRow[]
  /** Row whose STT badge is being edited inline (null = none). */
  editingOLId:         string | null
  editingOLValue:      string
  setEditingOLValue:   (value: string) => void
  setEditingOLId:      (id: string | null) => void
  commitOrderLabel:    (phaseExerciseId: string) => Promise<void>
  startEditOrderLabel: (pe: PhaseExerciseRow) => void
  handleUpdateNumeric: (pe: PhaseExerciseRow, field: NumericField, value: string) => Promise<void>
  moveExercise:        (phaseExerciseId: string, dir: -1 | 1) => Promise<void>
  startEditExercise:   (pe: PhaseExerciseRow) => void
  handleRemove:        (phaseExerciseId: string) => void
}) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-ink/8 bg-white">
      {/*
       * min-w ensures the STT + all columns render without wrapping.
       * table-fixed + explicit col widths keeps layout stable on resize.
       */}
      <table className="w-full text-sm min-w-[680px]">
        <thead className="border-b border-ink/8">
          <tr className="text-xs text-ink/40 uppercase tracking-wide">
            {/* STT — leftmost, shows order_label badge */}
            <th className="text-center px-3 py-3 w-[52px]">
              STT
              <span
                title="Nhấp vào ô STT để chỉnh sửa mã xếp lịch"
                className="ml-1 cursor-help text-ink/25">
                ✎
              </span>
            </th>
            <th className="text-left px-5 py-3">Bài tập</th>
            <th className="text-left px-5 py-3">Chuỗi CĐ</th>
            <th className="text-center px-4 py-3">Hiệp</th>
            <th className="text-center px-4 py-3">Rep Min</th>
            <th className="text-center px-4 py-3">Rep Max</th>
            <th className="text-center px-4 py-3">RIR</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {visibleExercises.map((pe, idx) => (
            <tr key={pe.id} className="group hover:bg-ink/2">

              {/* ── STT column ── */}
              <td className="px-3 py-2.5 text-center">
                {editingOLId === pe.id ? (
                  <input
                    type="text"
                    value={editingOLValue}
                    onChange={e => setEditingOLValue(e.target.value.toUpperCase())}
                    onBlur={() => void commitOrderLabel(pe.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  void commitOrderLabel(pe.id)
                      if (e.key === 'Escape') setEditingOLId(null)
                    }}
                    autoFocus
                    maxLength={4}
                    placeholder="A1"
                    className="w-12 text-center rounded-md border border-amber px-1 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber/50"
                  />
                ) : (
                  <button
                    type="button"
                    title="Nhấp để chỉnh sửa mã STT"
                    onClick={() => startEditOrderLabel(pe)}
                    className={cn(
                      'inline-flex items-center justify-center rounded-md border font-bold text-xs px-2 py-0.5 min-w-[32px] transition-all',
                      pe.order_label
                        ? orderBadgeClass(pe.order_label)
                        : 'border-dashed border-ink/20 text-ink/25 hover:border-ink/40 hover:text-ink/45',
                    )}
                  >
                    {pe.order_label ?? '—'}
                  </button>
                )}
              </td>

              {/* ── Exercise name + type ── */}
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-medium text-ink">{pe.exercise?.name ?? '—'}</p>
                  {pe.is_amrap && (
                    <span className="inline-flex items-center rounded-full bg-amber/15 border border-amber/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber leading-none">
                      🔥 AMRAP
                    </span>
                  )}
                  {pe.target_percentage_1rm != null && (
                    <span className="inline-flex items-center rounded-full bg-danger/10 border border-danger/25 px-1.5 py-0.5 text-[9px] font-bold font-mono text-danger leading-none">
                      {pe.target_percentage_1rm}% 1RM
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink/40">{pe.exercise?.type}</p>
                {pe.is_warmup && (
                  <p className="text-[10px] font-semibold text-sky-600/80 mt-0.5">
                    🤸 Bài khởi động
                  </p>
                )}
                {pe.exercise?.video_url && (
                  <div className="mt-1">
                    <TechniqueButton url={pe.exercise.video_url} exerciseName={pe.exercise?.name ?? 'Bài tập'} />
                  </div>
                )}
                {pe.notes && (
                  <p className="text-[11px] text-ink/50 mt-1 leading-snug whitespace-pre-line">
                    📝 {pe.notes}
                  </p>
                )}
              </td>

              {/* ── Movement pattern ── */}
              <td className="px-5 py-2.5 text-ink/50 text-xs">
                {pe.exercise?.movement_pattern?.name ?? '—'}
              </td>

              {/* ── Inline numeric fields ── */}
              <td className="px-4 py-2.5 text-center">
                <InlineNumberCell
                  value={pe.target_sets} field="target_sets" title="Số hiệp"
                  onCommit={raw => void handleUpdateNumeric(pe, 'target_sets', raw)}
                />
              </td>
              <td className="px-4 py-2.5 text-center">
                <InlineNumberCell
                  value={pe.target_rep_min} field="target_rep_min" title="Rep tối thiểu"
                  onCommit={raw => void handleUpdateNumeric(pe, 'target_rep_min', raw)}
                />
              </td>
              <td className="px-4 py-2.5 text-center">
                <InlineNumberCell
                  value={pe.target_rep_max} field="target_rep_max" title="Rep tối đa"
                  onCommit={raw => void handleUpdateNumeric(pe, 'target_rep_max', raw)}
                />
              </td>
              <td className="px-4 py-2.5 text-center">
                <InlineNumberCell
                  value={pe.rir_target} field="rir_target" title="RIR mục tiêu"
                  onCommit={raw => void handleUpdateNumeric(pe, 'rir_target', raw)}
                />
              </td>

              {/* ── Edit / Delete actions ── */}
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  {/* Di chuyển lên */}
                  <button
                    type="button"
                    onClick={() => void moveExercise(pe.id, -1)}
                    disabled={idx === 0}
                    title="Di chuyển lên"
                    className="h-7 w-7 rounded flex items-center justify-center text-ink/40 hover:text-ink hover:bg-ink/8 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  {/* Di chuyển xuống */}
                  <button
                    type="button"
                    onClick={() => void moveExercise(pe.id, 1)}
                    disabled={idx === visibleExercises.length - 1}
                    title="Di chuyển xuống"
                    className="h-7 w-7 rounded flex items-center justify-center text-ink/40 hover:text-ink hover:bg-ink/8 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {/* Sửa — bút chì */}
                  <button
                    type="button"
                    onClick={() => startEditExercise(pe)}
                    title="Sửa bài tập"
                    className="h-7 w-7 rounded flex items-center justify-center text-ink/40 hover:text-amber hover:bg-amber/8 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  {/* Xoá — thùng rác */}
                  <button
                    type="button"
                    onClick={() => handleRemove(pe.id)}
                    title="Xoá bài tập"
                    className="h-7 w-7 rounded flex items-center justify-center text-danger/50 hover:text-danger hover:bg-danger/8 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
