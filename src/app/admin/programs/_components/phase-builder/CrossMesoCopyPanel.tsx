import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { SplitDay } from '@/lib/trainingSplit'
import type { Phase } from '@/types'
import type { PhaseExerciseRow } from './shared'

/**
 * Copy whole sessions (buổi tập) from another Meso of the same block into the
 * current one. Owns the picker state and the on-demand fetch of the source
 * meso's exercises; the actual day creation + cloning is done by `onCopy`.
 *
 * The component stays mounted while hidden (`visible` false) so the selection
 * survives switching week tabs, exactly as when this state lived in the builder.
 */
export function CrossMesoCopyPanel({
  visible, phases, selectedPhaseId, onCopy,
}: {
  visible:         boolean
  phases:          Phase[]
  selectedPhaseId: string
  /** Create one new day per chosen source day and clone its (base) exercises. */
  onCopy:          (chosen: SplitDay[], sourceRows: PhaseExerciseRow[]) => Promise<void>
}) {
  // selectedCrossDayIds = source day_ids to copy.
  const [copySourcePhaseId, setCopySourcePhaseId]   = useState<string | null>(null)
  const [selectedCrossDayIds, setSelectedCrossDayIds] = useState<Set<string>>(new Set())
  const [crossPhaseExercises, setCrossPhaseExercises] = useState<PhaseExerciseRow[]>([])
  const [loadingCrossPhase, setLoadingCrossPhase]   = useState(false)
  const [copyingCross, setCopyingCross]             = useState(false)

  // Switching to another meso resets the picker (previously done by the
  // builder's phase-change effect).
  const [prevPhaseId, setPrevPhaseId] = useState(selectedPhaseId)
  if (prevPhaseId !== selectedPhaseId) {
    setPrevPhaseId(selectedPhaseId)
    setCopySourcePhaseId(null)
    setSelectedCrossDayIds(new Set())
    setCrossPhaseExercises([])
  }

  // Fetch the chosen source meso's exercises for the cross-meso copy widget.
  // Only the active phase's rows live in phaseExercises, so another meso's
  // sessions must be loaded on demand when the coach picks it.
  useEffect(() => {
    setSelectedCrossDayIds(new Set())
    if (!copySourcePhaseId) {
      setCrossPhaseExercises([])
      return
    }
    let cancelled = false
    setLoadingCrossPhase(true)
    fetch(`/api/phases/${copySourcePhaseId}/exercises`)
      .then(r => (r.ok ? r.json() : { exercises: [] }))
      .then(data => { if (!cancelled) setCrossPhaseExercises(data.exercises ?? []) })
      .catch(() => { if (!cancelled) setCrossPhaseExercises([]) })
      .finally(() => { if (!cancelled) setLoadingCrossPhase(false) })
    return () => { cancelled = true }
  }, [copySourcePhaseId])

  async function copyCrossSessions() {
    if (!copySourcePhaseId || selectedCrossDayIds.size === 0) return
    const srcPhase = phases.find(p => p.id === copySourcePhaseId)
    const srcDays  = (srcPhase?.split_days ?? []) as SplitDay[]
    // Preserve the source meso's day order; only days the coach ticked.
    const chosen = srcDays.filter(d => selectedCrossDayIds.has(d.id))
    if (chosen.length === 0) return

    setCopyingCross(true)
    await onCopy(chosen, crossPhaseExercises)
    setCopySourcePhaseId(null)
    setSelectedCrossDayIds(new Set())
    setCrossPhaseExercises([])
    setCopyingCross(false)
  }

  if (!visible) return null

  const otherPhases = phases.filter(p => p.id !== selectedPhaseId)
  if (otherPhases.length === 0) return null

  // Sessions of the chosen source meso (in its own order) that actually
  // contain exercises — only those are worth copying.
  const srcPhase = phases.find(p => p.id === copySourcePhaseId) ?? null
  const srcDays  = (srcPhase?.split_days ?? []) as SplitDay[]
  const crossDays = srcDays
    .map(d => ({
      ...d,
      count: crossPhaseExercises.filter(pe => pe.day_id === d.id).length,
    }))
    .filter(d => d.count > 0)
  const allSelected = crossDays.length > 0 &&
    crossDays.every(d => selectedCrossDayIds.has(d.id))

  return (
    <div className="rounded-xl border border-ink/8 bg-ink/3 px-4 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink/55">
          Sao chép nguyên buổi tập từ Meso khác sang Meso này:
        </span>
        <select
          value={copySourcePhaseId ?? ''}
          onChange={e => setCopySourcePhaseId(e.target.value || null)}
          className="rounded-lg border border-ink/15 bg-white px-2.5 py-1 text-xs text-ink focus:outline-none focus:border-amber"
        >
          <option value="">— Chọn Meso nguồn —</option>
          {otherPhases.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {copySourcePhaseId && (
        loadingCrossPhase ? (
          <p className="text-xs text-ink/45">Đang tải các buổi tập…</p>
        ) : crossDays.length === 0 ? (
          <p className="text-xs text-ink/45">Meso này chưa có buổi tập nào có bài.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedCrossDayIds(
                  allSelected ? new Set() : new Set(crossDays.map(d => d.id)),
                )}
                className="text-xs font-semibold text-ink/55 hover:text-ink px-2 py-1 rounded hover:bg-ink/5 transition-colors"
              >
                {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </button>
              {crossDays.map(d => {
                const checked = selectedCrossDayIds.has(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedCrossDayIds(prev => {
                      const next = new Set(prev)
                      if (next.has(d.id)) next.delete(d.id); else next.add(d.id)
                      return next
                    })}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                      checked
                        ? 'bg-amber/15 text-amber border-amber/40 font-semibold'
                        : 'bg-white text-ink/70 border-ink/15 hover:border-ink/30',
                    )}
                  >
                    {checked ? '✓ ' : ''}{d.label} ({d.count} bài)
                  </button>
                )
              })}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyCrossSessions()}
              disabled={selectedCrossDayIds.size === 0 || copyingCross}
            >
              {copyingCross
                ? 'Đang sao chép…'
                : `Sao chép ${selectedCrossDayIds.size || ''} buổi`.trim()}
            </Button>
          </>
        )
      )}
    </div>
  )
}
