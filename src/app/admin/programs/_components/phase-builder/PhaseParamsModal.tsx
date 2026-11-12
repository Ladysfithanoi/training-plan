import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import type { Phase, PhaseType, RepRange } from '@/types'

/** The phase fields this modal edits. */
export type PhaseParamsPatch = Pick<
  Phase,
  | 'phase_type' | 'duration_weeks' | 'frequency_per_week' | 'rep_ranges'
  | 'target_set_reduction_factor' | 'includes_deload' | 'max_rir' | 'max_weight_percent'
>

type RepZoneDraft = { min: string; max: string; exercise_type?: RepRange['exercise_type'] }

const EXERCISE_TYPE_OPTIONS = [
  { value: '',           label: 'Mọi loại bài' },
  { value: 'compound',   label: 'Phức hợp' },
  { value: 'machine',    label: 'Máy tập' },
  { value: 'cable',      label: 'Cáp' },
  { value: 'bodyweight', label: 'Trọng lượng cơ thể' },
  { value: 'dumbbell',   label: 'Tạ đơn' },
]

interface FormProps {
  /** Snapshot of the phase taken when the modal was opened. */
  phase:   Phase
  onClose: () => void
  /** Optimistic update — called before the PATCH is sent. */
  onApply: (phaseId: string, patch: PhaseParamsPatch) => void
}

/** Edit phase PARAMETERS (duration, frequency, rep zones, type…). */
export function PhaseParamsModal({
  phase, onClose, onApply,
}: Omit<FormProps, 'phase'> & { phase: Phase | null }) {
  return (
    <Modal
      open={phase !== null}
      onClose={onClose}
      title="Chỉnh sửa thông số giai đoạn"
      size="lg"
    >
      {phase && <PhaseParamsForm key={phase.id} phase={phase} onClose={onClose} onApply={onApply} />}
    </Modal>
  )
}

// Numeric fields are kept as raw strings while editing so the user can clear a
// box to empty; on save, any blank/invalid field falls back to its original
// value (the `phase` snapshot).
function PhaseParamsForm({ phase, onClose, onApply }: FormProps) {
  const [pPhaseType, setPPhaseType]           = useState<PhaseType>(phase.phase_type)
  const [pDuration, setPDuration]             = useState(String(phase.duration_weeks))
  const [pFreq, setPFreq]                     = useState(String(phase.frequency_per_week))
  const [pRepRanges, setPRepRanges]           = useState<RepZoneDraft[]>(
    Array.isArray(phase.rep_ranges)
      ? phase.rep_ranges.map(r => ({ min: String(r.min), max: String(r.max), exercise_type: r.exercise_type }))
      : [],
  )
  // maintenance: % of Meso-2 volume
  const [pReductionPct, setPReductionPct]     = useState(
    String(Math.round((phase.target_set_reduction_factor ?? 1) * 100)),
  )
  const [pIncludesDeload, setPIncludesDeload] = useState(!!phase.includes_deload)
  // active rest
  const [pMaxRir, setPMaxRir]                 = useState(phase.max_rir != null ? String(phase.max_rir) : '10')
  // active rest: % of working weight
  const [pMaxWeightPct, setPMaxWeightPct]     = useState(
    phase.max_weight_percent != null ? String(Math.round(phase.max_weight_percent * 100)) : '50',
  )
  const [pSaving, setPSaving]                 = useState(false)
  const [pError, setPError]                   = useState<string | null>(null)

  function addRepZone() {
    setPRepRanges(prev => [...prev, { min: '8', max: '12' }])
  }
  function updateRepZone(idx: number, patch: Partial<RepZoneDraft>) {
    setPRepRanges(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function removeRepZone(idx: number) {
    setPRepRanges(prev => prev.filter((_, i) => i !== idx))
  }

  async function savePhaseParams() {
    setPSaving(true)
    setPError(null)

    const orig: Phase | null = phase
    // Parse an integer; if blank/invalid, fall back to the supplied old value.
    const parseOr = (s: string, fallback: number) => {
      const n = parseInt(s, 10)
      return Number.isNaN(n) ? fallback : n
    }

    const cleanRanges: RepRange[] = pRepRanges
      .map((r, i) => {
        const origR = orig?.rep_ranges?.[i]
        const min = parseOr(r.min, origR?.min ?? 0)
        const max = parseOr(r.max, origR?.max ?? 0)
        return r.exercise_type ? { min, max, exercise_type: r.exercise_type } : { min, max }
      })
      .filter(r => r.min > 0 && r.max >= r.min)

    const payload = {
      phase_type:                  pPhaseType,
      duration_weeks:              Math.max(1, parseOr(pDuration, orig?.duration_weeks ?? 1)),
      frequency_per_week:          Math.max(1, parseOr(pFreq, orig?.frequency_per_week ?? 1)),
      rep_ranges:                  cleanRanges,
      target_set_reduction_factor: pPhaseType === 'maintenance'
        ? (Math.max(1, parseOr(pReductionPct, Math.round((orig?.target_set_reduction_factor ?? 1) * 100))) / 100)
        : 1.0,
      includes_deload:             pPhaseType === 'maintenance' ? pIncludesDeload : false,
      max_rir:                     pPhaseType === 'active_rest' ? parseOr(pMaxRir, orig?.max_rir ?? 10) : null,
      max_weight_percent:          pPhaseType === 'active_rest'
        ? (Math.max(1, parseOr(pMaxWeightPct, Math.round((orig?.max_weight_percent ?? 0.5) * 100))) / 100)
        : null,
    }

    // Optimistic update so the info bar + timeline reflect changes at once.
    onApply(phase.id, payload)

    const res = await fetch(`/api/phases/${phase.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })

    setPSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setPError(d.error ?? 'Lưu thất bại. Vui lòng thử lại.')
      return
    }
    onClose()
  }

  return (
    <div className="space-y-4">
      <Select
        label="Loại giai đoạn"
        value={pPhaseType}
        onChange={e => setPPhaseType(e.target.value as PhaseType)}
        options={[
          { value: 'training',    label: 'Tập luyện' },
          { value: 'maintenance', label: 'Duy trì' },
          { value: 'active_rest', label: 'Nghỉ tích cực' },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Độ dài (tuần)"
          type="number"
          min={1}
          value={pDuration}
          onFocus={e => e.target.select()}
          onChange={e => setPDuration(e.target.value)}
        />
        <Input
          label="Tần suất / tuần"
          type="number"
          min={1}
          value={pFreq}
          onFocus={e => e.target.select()}
          onChange={e => setPFreq(e.target.value)}
        />
      </div>

      {/* Rep zones editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
            Khoảng Reps (vùng reps)
          </label>
          <button
            type="button"
            onClick={addRepZone}
            className="text-xs font-semibold text-amber hover:underline"
          >
            + Thêm vùng
          </button>
        </div>
        {pRepRanges.length === 0 ? (
          <p className="text-xs text-ink/40">Chưa có vùng reps nào. Bấm “+ Thêm vùng”.</p>
        ) : (
          <div className="space-y-2">
            {pRepRanges.map((rr, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number" min={1} inputMode="numeric" value={rr.min}
                  onFocus={e => e.target.select()}
                  onChange={e => updateRepZone(i, { min: e.target.value })}
                  className="w-16 rounded-lg border border-ink/15 px-2 py-1.5 text-sm text-center font-mono focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                  aria-label="Reps tối thiểu"
                />
                <span className="text-ink/30">–</span>
                <input
                  type="number" min={1} inputMode="numeric" value={rr.max}
                  onFocus={e => e.target.select()}
                  onChange={e => updateRepZone(i, { max: e.target.value })}
                  className="w-16 rounded-lg border border-ink/15 px-2 py-1.5 text-sm text-center font-mono focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                  aria-label="Reps tối đa"
                />
                <select
                  value={rr.exercise_type ?? ''}
                  onChange={e => updateRepZone(i, { exercise_type: (e.target.value || undefined) as RepRange['exercise_type'] })}
                  className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-sm text-ink bg-white focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                >
                  {EXERCISE_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRepZone(i)}
                  title="Xoá vùng reps"
                  className="h-8 w-8 shrink-0 rounded flex items-center justify-center text-danger/50 hover:text-danger hover:bg-danger/8 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Maintenance-specific */}
      {pPhaseType === 'maintenance' && (
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-ink/3 border border-ink/8 p-3">
          <Input
            label="% khối lượng (so với Meso-2)"
            type="number"
            min={1}
            value={pReductionPct}
            onFocus={e => e.target.select()}
            onChange={e => setPReductionPct(e.target.value)}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={pIncludesDeload}
              onChange={e => setPIncludesDeload(e.target.checked)}
              className="accent-amber h-4 w-4"
            />
            Kết thúc bằng tuần deload
          </label>
        </div>
      )}

      {/* Active-rest-specific */}
      {pPhaseType === 'active_rest' && (
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-ink/3 border border-ink/8 p-3">
          <Input
            label="RIR tối đa"
            type="number"
            min={0}
            value={pMaxRir}
            onFocus={e => e.target.select()}
            onChange={e => setPMaxRir(e.target.value)}
          />
          <Input
            label="% trọng lượng tối đa"
            type="number"
            min={1}
            value={pMaxWeightPct}
            onFocus={e => e.target.select()}
            onChange={e => setPMaxWeightPct(e.target.value)}
          />
        </div>
      )}

      {pError && <p className="text-sm text-danger">{pError}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="primary" loading={pSaving} onClick={() => void savePhaseParams()} className="flex-1">
          Lưu thay đổi
        </Button>
        <Button variant="secondary" onClick={() => onClose()} disabled={pSaving}>
          Huỷ
        </Button>
      </div>
    </div>
  )
}
