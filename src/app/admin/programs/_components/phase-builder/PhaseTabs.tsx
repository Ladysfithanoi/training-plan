import type { RefObject } from 'react'
import { phaseTypeLabel, phaseTypeBadgeClass, cn } from '@/lib/utils'
import type { Phase } from '@/types'

/** Phase (meso) selector with inline rename / delete and the "+ Thêm Meso" button. */
export function PhaseTabs({
  activeBlock, phases, selectedPhaseId, setSelectedPhaseId,
  renamingPhaseId, setRenamingPhaseId, renamingPhaseRef, renamePhaseValue, setRenamePhaseValue,
  startRenamePhase, commitRenamePhase, setPendingDelete, setAddPhaseOpen,
}: {
  activeBlock:          { name: string } | null
  phases:               Phase[]
  selectedPhaseId:      string
  setSelectedPhaseId:   (id: string) => void
  /** Phase whose name is being edited inline (null = none). */
  renamingPhaseId:      string | null
  setRenamingPhaseId:   (id: string | null) => void
  renamingPhaseRef:     RefObject<HTMLInputElement | null>
  renamePhaseValue:     string
  setRenamePhaseValue:  (value: string) => void
  startRenamePhase:     (phase: Phase) => void
  commitRenamePhase:    () => Promise<void>
  /** Opens the delete confirmation for a phase. */
  setPendingDelete:     (pending: { kind: 'phase'; id: string }) => void
  setAddPhaseOpen:      (open: boolean) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Giai đoạn — {activeBlock?.name ?? ''}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phases.sort((a, b) => a.phase_order - b.phase_order).map(phase => (
          <div key={phase.id} className="flex items-center gap-0.5 group">

            {renamingPhaseId === phase.id ? (
              /* ── Inline rename ── */
              <div className="flex items-center gap-1">
                <input
                  ref={renamingPhaseRef}
                  type="text"
                  value={renamePhaseValue}
                  onChange={e => setRenamePhaseValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  void commitRenamePhase()
                    if (e.key === 'Escape') setRenamingPhaseId(null)
                  }}
                  className="rounded border border-amber px-2 py-1 text-sm font-medium text-ink focus:outline-none w-44"
                />
                <button
                  type="button"
                  onClick={() => void commitRenamePhase()}
                  className="text-xs text-herb font-semibold px-1.5 py-1 rounded hover:bg-herb/10"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingPhaseId(null)}
                  className="text-xs text-ink/40 font-semibold px-1.5 py-1 rounded hover:bg-ink/5"
                >
                  ✕
                </button>
              </div>
            ) : (
              /* ── Phase tab button ── */
              <button
                type="button"
                onClick={() => setSelectedPhaseId(phase.id)}
                className={cn(
                  'rounded-lg border px-3.5 py-2 text-sm font-medium transition-all flex items-center gap-1.5',
                  selectedPhaseId === phase.id
                    ? 'border-amber bg-amber/10 text-amber'
                    : 'border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink',
                )}
              >
                {phase.name}
                <span className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5',
                  phaseTypeBadgeClass(phase.phase_type),
                )}>
                  {phaseTypeLabel(phase.phase_type)}
                </span>
              </button>
            )}

            {/* Edit / Delete controls — visible on hover */}
            {renamingPhaseId !== phase.id && (
              <div className="flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-0.5">
                {/* Rename */}
                <button
                  type="button"
                  onClick={() => startRenamePhase(phase)}
                  title="Đổi tên giai đoạn"
                  className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 transition-colors"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                {/* Delete (only if >1 phase remains) */}
                {phases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete({ kind: 'phase', id: phase.id })}
                    title="Xoá giai đoạn"
                    className="h-6 w-6 rounded flex items-center justify-center text-danger/40 hover:text-danger hover:bg-danger/8 transition-colors"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* "+ Thêm Meso" button */}
        <button
          type="button"
          onClick={() => setAddPhaseOpen(true)}
          className="rounded-lg border border-dashed border-amber/40 px-3.5 py-2 text-xs font-semibold text-amber/60 hover:border-amber hover:text-amber hover:bg-amber/4 transition-all flex items-center gap-1"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Thêm Meso
        </button>
      </div>
    </div>
  )
}
