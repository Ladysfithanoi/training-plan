import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { Phase, PhaseType } from '@/types'

/** "Thêm Giai Đoạn Mới" — creates a blank meso in the active block. */
export function AddPhaseModal({
  open, onClose, selectedBlockId, onCreated,
}: {
  open:            boolean
  onClose:         () => void
  selectedBlockId: string
  /** Called with the phase row returned by the server. */
  onCreated:       (phase: Phase) => void
}) {
  const [newPhaseName, setNewPhaseName]       = useState('')
  const [newPhaseType, setNewPhaseType]       = useState<PhaseType>('training')
  const [newPhaseDuration, setNewPhaseDuration] = useState('4')
  const [newPhaseFreq, setNewPhaseFreq]       = useState('3')
  const [addingPhase, setAddingPhase]         = useState(false)
  const [addPhaseError, setAddPhaseError]     = useState<string | null>(null)

  // Mỗi lần mở lại modal: xoá tên + lỗi cũ (loại / thời lượng / tần suất giữ nguyên).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setNewPhaseName('')
      setAddPhaseError(null)
    }
  }

  async function handleAddPhase() {
    if (!newPhaseName.trim() || !selectedBlockId) return
    setAddingPhase(true)
    setAddPhaseError(null)

    const res = await fetch('/api/phases', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        block_id:           selectedBlockId,
        name:               newPhaseName.trim(),
        phase_type:         newPhaseType,
        duration_weeks:     parseInt(newPhaseDuration) || 4,
        frequency_per_week: parseInt(newPhaseFreq)     || 3,
      }),
    })

    const data = await res.json()
    setAddingPhase(false)

    if (!res.ok) {
      setAddPhaseError(data.error ?? 'Không thể tạo giai đoạn')
      return
    }

    onCreated(data.phase as Phase)
    setNewPhaseName('')
    setNewPhaseType('training')
    setNewPhaseDuration('4')
    setNewPhaseFreq('3')
  }

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); setAddPhaseError(null) }}
      title="Thêm Giai Đoạn Mới"
      size="sm"
    >
      <div className="space-y-4">
        <Input
          label="Tên giai đoạn"
          value={newPhaseName}
          onChange={e => setNewPhaseName(e.target.value)}
          placeholder="VD: Meso 1 — Nền tảng"
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold font-sans uppercase tracking-wide text-ink/60">
            Loại giai đoạn
          </label>
          <select
            value={newPhaseType}
            onChange={e => setNewPhaseType(e.target.value as PhaseType)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
          >
            <option value="training">🏋️ Tập luyện (Training)</option>
            <option value="maintenance">🔄 Duy trì (Maintenance)</option>
            <option value="active_rest">🧘 Nghỉ tích cực (Active Rest)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Thời lượng (tuần)"
            type="number"
            min="1"
            max="24"
            value={newPhaseDuration}
            onChange={e => setNewPhaseDuration(e.target.value)}
          />
          <Input
            label="Tần suất (/tuần)"
            type="number"
            min="1"
            max="7"
            value={newPhaseFreq}
            onChange={e => setNewPhaseFreq(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-ink/8 bg-ink/2 px-3 py-2.5">
          <p className="text-[11px] text-ink/45 leading-snug">
            Vùng reps, RIR, split type và các thông số chi tiết khác có thể
            được cấu hình sau khi tạo giai đoạn.
          </p>
        </div>

        {addPhaseError && (
          <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
            {addPhaseError}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="primary"
            loading={addingPhase}
            onClick={() => void handleAddPhase()}
            disabled={!newPhaseName.trim() || addingPhase}
            className="flex-1"
          >
            Tạo giai đoạn
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { onClose(); setAddPhaseError(null) }}
            disabled={addingPhase}
          >
            Huỷ
          </Button>
        </div>
      </div>
    </Modal>
  )
}
