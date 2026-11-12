import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import type { Exercise, MovementPattern } from '@/types'
import { LOADING_STYLE_OPTIONS, orderBadgeClass, parseNumericField } from './shared'
import type { PhaseExerciseRow } from './shared'

interface FormProps {
  editingExercise:   PhaseExerciseRow
  onClose:           () => void
  exercises:         Exercise[]
  patterns:          MovementPattern[]
  selectedPhaseId:   string
  /** Strength / Peaking / Taper context → prescribe by %1RM, no RIR / AMRAP. */
  isStrengthContext: boolean
  /** Called with the id of the edited row and the fresh row from the server. */
  onSaved:           (phaseExerciseId: string, row: PhaseExerciseRow) => void
}

/**
 * Full edit of an existing phase_exercise row in one place: swap the exercise
 * itself plus every prescription field (sets / reps / RIR / %1RM / AMRAP /
 * loading style / STT).
 */
export function EditExerciseModal({
  editingExercise, onClose, ...rest
}: Omit<FormProps, 'editingExercise'> & { editingExercise: PhaseExerciseRow | null }) {
  return (
    <Modal
      open={editingExercise !== null}
      onClose={onClose}
      title="Sửa bài tập"
      size="lg"
    >
      {editingExercise && (
        <EditExerciseForm
          key={editingExercise.id}
          editingExercise={editingExercise}
          onClose={onClose}
          {...rest}
        />
      )}
    </Modal>
  )
}

/** The form is mounted only while the modal is open, so it starts pre-filled from the row. */
function EditExerciseForm({
  editingExercise, onClose, exercises, patterns, selectedPhaseId, isStrengthContext, onSaved,
}: FormProps) {
  const pe = editingExercise
  const [editFilterPattern, setEditFilterPattern] = useState(pe.exercise?.movement_pattern_id ?? '')
  const [editExerciseId, setEditExerciseId]     = useState(pe.exercise_id)
  const [editSets, setEditSets]                 = useState(String(pe.target_sets ?? 3))
  const [editRepMin, setEditRepMin]             = useState(String(pe.target_rep_min ?? 8))
  const [editRepMax, setEditRepMax]             = useState(String(pe.target_rep_max ?? 12))
  const [editRir, setEditRir]                   = useState(String(pe.rir_target ?? 2))
  const [editLoadingStyle, setEditLoadingStyle] = useState<'horizontal' | 'vertical'>(
    pe.loading_style === 'vertical' ? 'vertical' : 'horizontal',
  )
  const [editOrderLabel, setEditOrderLabel]     = useState(pe.order_label ?? '')
  const [editIsAmrap, setEditIsAmrap]           = useState(pe.is_amrap ?? false)
  const [editTarget1rmPct, setEditTarget1rmPct] = useState(
    pe.target_percentage_1rm != null ? String(pe.target_percentage_1rm) : '',
  )
  const [editIsWarmup, setEditIsWarmup]         = useState(pe.is_warmup ?? false)
  const [editNotes, setEditNotes]               = useState(pe.notes ?? '')
  const [editSaving, setEditSaving]             = useState(false)
  const [editError, setEditError]               = useState<string | null>(null)

  /** Persist all edited fields in a single PATCH; replace the row from the join. */
  async function handleSaveEdit() {
    if (!editingExercise || !editExerciseId) return

    // Blank fields keep whatever is already stored — clearing a box must never
    // silently rewrite the prescription to a default like 1.
    const repMin = parseNumericField('target_rep_min', editRepMin, editingExercise.target_rep_min ?? 8)
    const repMax = parseNumericField('target_rep_max', editRepMax, editingExercise.target_rep_max ?? 12)
    if (repMin > repMax) {
      setEditError('Rep tối thiểu không được lớn hơn Rep tối đa.')
      return
    }

    setEditSaving(true)
    setEditError(null)

    const res = await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${editingExercise.id}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_id:    editExerciseId,
          target_sets:    parseNumericField('target_sets', editSets, editingExercise.target_sets ?? 3),
          target_rep_min: repMin,
          target_rep_max: repMax,
          order_label:    editOrderLabel.trim().toUpperCase() || null,
          loading_style:  editLoadingStyle,

          // Context-aware periodisation fields (mirror handleAdd):
          //   Strength/Peaking → prescribe by %1RM, RIR & AMRAP suppressed
          //   Hypertrophy      → prescribe by RIR, AMRAP allowed
          rir_target:            isStrengthContext ? null : (parseInt(editRir) || 2),
          is_amrap:              isStrengthContext ? false : editIsAmrap,
          // %1RM is an always-available optional field (any phase). Empty = off.
          target_percentage_1rm: editTarget1rmPct ? (parseInt(editTarget1rmPct) || null) : null,
          // migration 012 — independent warmup marker
          is_warmup:             editIsWarmup,
          // Coach note shown to the athlete (phase_exercises.notes). Empty = clear.
          notes:                 editNotes.trim() || null,
        }),
      },
    )

    const data = await res.json()
    setEditSaving(false)

    if (!res.ok) {
      setEditError(data.error ?? 'Không thể cập nhật bài tập')
      return
    }

    onSaved(editingExercise.id, data.exercise)
  }

  return (
    <div className="space-y-5">

      {/* ── Exercise picker ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
            Chuỗi Chuyển Động
          </label>
          <select
            value={editFilterPattern}
            onChange={e => {
              setEditFilterPattern(e.target.value)
              // Nếu bài tập đang chọn không thuộc chuỗi mới → bỏ chọn
              if (e.target.value) {
                const stillValid = exercises.some(
                  ex => ex.id === editExerciseId && ex.movement_pattern_id === e.target.value,
                )
                if (!stillValid) setEditExerciseId('')
              }
            }}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
          >
            <option value="">Tất cả Chuỗi Chuyển Động</option>
            {patterns.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <Select
          label="Bài tập"
          value={editExerciseId}
          onChange={e => setEditExerciseId(e.target.value)}
          options={(editFilterPattern
            ? exercises.filter(ex => ex.movement_pattern_id === editFilterPattern)
            : exercises
          ).map(ex => ({ value: ex.id, label: ex.name }))}
          placeholder="Chọn bài tập..."
        />
      </div>

      {/* ── Kiểu xếp lịch (Loading Style) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {LOADING_STYLE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setEditLoadingStyle(opt.value)}
            className={cn(
              'flex flex-col items-start rounded-lg border px-3.5 py-3 text-left transition-all',
              editLoadingStyle === opt.value
                ? 'border-amber bg-amber/8 shadow-sm'
                : 'border-ink/12 bg-white hover:border-ink/25',
            )}
          >
            <span className={cn(
              'text-xs font-bold',
              editLoadingStyle === opt.value ? 'text-amber' : 'text-ink',
            )}>
              {opt.label}
            </span>
            <span className="text-[11px] text-ink/45 mt-0.5 leading-snug">
              {opt.desc}
            </span>
          </button>
        ))}
      </div>

      {/* ── Prescription grid (context-aware col 4, mirrors add panel) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Input
          label="Số hiệp" type="number"
          value={editSets} onChange={e => setEditSets(e.target.value)}
        />
        <Input
          label="Rep Tối thiểu" type="number"
          value={editRepMin} onChange={e => setEditRepMin(e.target.value)}
        />
        <Input
          label="Rep Tối đa" type="number"
          value={editRepMax} onChange={e => setEditRepMax(e.target.value)}
        />
        {isStrengthContext ? (
          <Input
            label="% 1RM mục tiêu" type="number"
            value={editTarget1rmPct} onChange={e => setEditTarget1rmPct(e.target.value)}
          />
        ) : (
          <Input
            label="RIR mục tiêu" type="number"
            value={editRir} onChange={e => setEditRir(e.target.value)}
          />
        )}
      </div>

      {/* ── AMRAP toggle (hypertrophy context only) ── */}
      {!isStrengthContext && (
        <label className={cn(
          'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all select-none',
          editIsAmrap ? 'border-amber/40 bg-amber/6' : 'border-ink/10 bg-ink/2 hover:border-ink/20',
        )}>
          <input
            type="checkbox"
            checked={editIsAmrap}
            onChange={e => setEditIsAmrap(e.target.checked)}
            className="h-4 w-4 mt-0.5 shrink-0 rounded border-ink/20 accent-amber"
          />
          <div className="min-w-0">
            <p className={cn('text-xs font-bold', editIsAmrap ? 'text-amber' : 'text-ink')}>
              🔥 Thiết lập hiệp cuối AMRAP
            </p>
            <p className="text-[11px] text-ink/45 mt-0.5 leading-snug">
              Hiệp cuối thực hiện tối đa số lần tới khi RPE 10.
            </p>
          </div>
        </label>
      )}

      {/* ── %1RM mục tiêu (tùy chọn) — hypertrophy/standard context ──
          Strength context shows %1RM in the grid's column 4 above. */}
      {!isStrengthContext && (
        <div className="max-w-[220px]">
          <Input
            label="% 1RM mục tiêu (tùy chọn)" type="number"
            value={editTarget1rmPct} onChange={e => setEditTarget1rmPct(e.target.value)}
            placeholder="vd 70"
          />
        </div>
      )}

      {/* ── Bài khởi động (warmup) — independent display marker ── */}
      <label className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all select-none',
        editIsWarmup ? 'border-sky-400/45 bg-sky-400/8' : 'border-ink/10 bg-ink/2 hover:border-ink/20',
      )}>
        <input
          type="checkbox"
          checked={editIsWarmup}
          onChange={e => setEditIsWarmup(e.target.checked)}
          className="h-4 w-4 mt-0.5 shrink-0 rounded border-ink/20 accent-sky-500"
        />
        <div className="min-w-0">
          <p className={cn('text-xs font-bold', editIsWarmup ? 'text-sky-600' : 'text-ink')}>
            🤸 Bài khởi động
          </p>
          <p className="text-[11px] text-ink/45 mt-0.5 leading-snug">
            Hiện ghi chú “Bài khởi động” trong bảng để người tập nhận biết.
          </p>
        </div>
      </label>

      {/* ── Ghi chú cho học viên (phase_exercises.notes) ── */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Ghi chú bài tập
          <span className="ml-1.5 font-normal normal-case text-ink/35">(học viên sẽ thấy)</span>
        </label>
        <textarea
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="vd: Giữ lưng thẳng, hạ chậm 3 giây, nghỉ 90s giữa hiệp…"
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink leading-snug focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-y placeholder:text-ink/30"
        />
      </div>

      {/* ── STT / Order label ── */}
      <div className="flex flex-col gap-1.5 max-w-[220px]">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Mã STT
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editOrderLabel}
            onChange={e => setEditOrderLabel(e.target.value.toUpperCase())}
            placeholder="A, B1…"
            maxLength={4}
            className="w-24 rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold text-ink uppercase focus:border-amber focus:ring-1 focus:ring-amber outline-none"
          />
          {editOrderLabel && (
            <span className={cn(
              'rounded-md border font-bold text-sm px-2.5 py-0.5',
              orderBadgeClass(editOrderLabel),
            )}>
              {editOrderLabel.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {editError && (
        <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
          {editError}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          loading={editSaving}
          onClick={() => void handleSaveEdit()}
          disabled={!editExerciseId || editSaving}
          className="flex-1"
        >
          Lưu thay đổi
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onClose()}
          disabled={editSaving}
        >
          Huỷ
        </Button>
      </div>
    </div>
  )
}
