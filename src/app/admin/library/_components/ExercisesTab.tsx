'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ImportExcelModal } from './ImportExcelModal'
import type { Exercise, MovementPattern } from '@/types'

interface Props {
  exercises: Exercise[]
  patterns: MovementPattern[]
  onExercisesChange: (exercises: Exercise[]) => void
  currentUserId: string
  isAdmin: boolean
}

const PAGE_SIZE = 10

const EXERCISE_TYPES = [
  { value: 'compound', label: 'Phức hợp' },
  { value: 'machine', label: 'Máy tập' },
  { value: 'cable', label: 'Cáp' },
  { value: 'bodyweight', label: 'Trọng lượng cơ thể' },
  { value: 'dumbbell', label: 'Tạ đơn' },
]

const TYPE_BADGE: Record<string, string> = {
  compound: 'bg-herb/10 text-herb',
  machine: 'bg-slate/10 text-slate',
  cable: 'bg-amber/10 text-amber',
  bodyweight: 'bg-ink/8 text-ink/60',
  dumbbell: 'bg-ink/8 text-ink/60',
}

const TYPE_LABEL_VI: Record<string, string> = {
  compound: 'Phức hợp',
  machine: 'Máy tập',
  cable: 'Cáp',
  bodyweight: 'Trọng lượng cơ thể',
  dumbbell: 'Tạ đơn',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${TYPE_BADGE[type] ?? 'bg-ink/8 text-ink/60'}`}>
      {TYPE_LABEL_VI[type] ?? type}
    </span>
  )
}

export function ExercisesTab({ exercises: initialExercises, patterns, onExercisesChange, currentUserId, isAdmin }: Props) {
  /** Coaches may edit/delete only exercises they created; admins edit anything. */
  const canEdit = (ex: Exercise) => isAdmin || ex.created_by === currentUserId
  const [exercises, setExercises] = useState(initialExercises)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [filterPattern, setFilterPattern] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Exercise | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Delete confirmation modal ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Exercise | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('compound')
  const [formPattern, setFormPattern] = useState('')
  const [formRepMin, setFormRepMin] = useState('5')
  const [formRepMax, setFormRepMax] = useState('20')
  const [formMuscles, setFormMuscles] = useState('')
  const [formDesc, setFormDesc] = useState('')

  function resetForm() {
    setFormName('')
    setFormType('compound')
    setFormPattern('')
    setFormRepMin('5')
    setFormRepMax('20')
    setFormMuscles('')
    setFormDesc('')
    setSaveError(null)
  }

  function openCreate() {
    resetForm()
    setCreateOpen(true)
  }

  function openEdit(ex: Exercise) {
    setFormName(ex.name)
    setFormType(ex.type)
    setFormPattern(ex.movement_pattern_id ?? '')
    setFormRepMin(String(ex.optimal_rep_min))
    setFormRepMax(String(ex.optimal_rep_max))
    setFormMuscles(ex.muscle_groups.join(', '))
    setFormDesc(ex.description ?? '')
    setSaveError(null)
    setEditTarget(ex)
  }

  function handleClose() {
    setCreateOpen(false)
    setEditTarget(null)
  }

  async function handleSave() {
    if (!formName.trim()) return
    setSaving(true)
    setSaveError(null)

    const payload = {
      name: formName.trim(),
      type: formType,
      movement_pattern_id: formPattern || null,
      optimal_rep_min: parseInt(formRepMin) || 5,
      optimal_rep_max: parseInt(formRepMax) || 20,
      muscle_groups: formMuscles.split(',').map(s => s.trim()).filter(Boolean),
      description: formDesc.trim() || null,
    }

    const isEdit = !!editTarget
    const res = await fetch(
      isEdit ? `/api/exercises/${editTarget!.id}` : '/api/exercises',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setSaveError(data.error ?? 'Không thể lưu')
      return
    }

    if (isEdit) {
      const updated = exercises.map(e => e.id === editTarget!.id ? data.exercise : e)
      setExercises(updated)
      onExercisesChange(updated)
      setEditTarget(null)
    } else {
      const updated = [...exercises, data.exercise].sort((a, b) => a.name.localeCompare(b.name))
      setExercises(updated)
      onExercisesChange(updated)
      setCreateOpen(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const res = await fetch(`/api/exercises/${deleteTarget.id}`, { method: 'DELETE' })
    if (res.ok) {
      const updated = exercises.filter(e => e.id !== deleteTarget.id)
      setExercises(updated)
      onExercisesChange(updated)
    }
    setDeleting(false)
    setDeleteTarget(null)
  }

  function handleImported(_count: number) {
    window.location.reload()
  }

  // Lọc
  const filtered = exercises.filter(ex => {
    const matchQ = !query || ex.name.toLowerCase().includes(query.toLowerCase())
    const matchP = !filterPattern || ex.movement_pattern_id === filterPattern
    return matchQ && matchP
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const globalOffset = (currentPage - 1) * PAGE_SIZE

  const modalOpen = createOpen || !!editTarget
  const modalTitle = editTarget ? `Chỉnh sửa — ${editTarget.name}` : 'Thêm Bài Tập Mới'

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-40">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }}
            placeholder="Tìm kiếm bài tập..."
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none bg-white"
          />
        </div>
        <select
          value={filterPattern}
          onChange={e => { setFilterPattern(e.target.value); setPage(1) }}
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink bg-white focus:border-amber focus:ring-1 focus:ring-amber outline-none"
        >
          <option value="">Tất cả Chuỗi Chuyển Động</option>
          {patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
          Nhập tệp Excel/CSV
        </Button>
        <Button onClick={openCreate}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Thêm Bài Tập Mới
        </Button>
      </div>

      {/* Bảng bài tập — responsive wrapper */}
      <div className="w-full overflow-x-auto rounded-xl border border-ink/8 bg-white">
        {pageItems.length === 0 ? (
          <p className="text-sm text-center text-ink/40 py-10">
            {filtered.length === 0 ? 'Không tìm thấy bài tập phù hợp.' : 'Chưa có bài tập nào.'}
          </p>
        ) : (
          <table className="w-full text-sm min-w-[580px]">
            <thead className="border-b border-ink/8">
              <tr className="text-xs text-ink/40 uppercase tracking-wide whitespace-nowrap">
                <th className="text-left px-3 sm:px-5 py-3 w-10">#</th>
                <th className="text-left px-3 sm:px-5 py-3 min-w-[160px]">Tên bài tập</th>
                <th className="text-left px-3 sm:px-5 py-3">Loại bài</th>
                <th className="text-left px-3 sm:px-5 py-3">Chuỗi chuyển động</th>
                <th className="text-left px-3 sm:px-5 py-3">Khoảng Reps</th>
                <th className="px-3 sm:px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageItems.map((ex, i) => (
                <tr key={ex.id} className="group hover:bg-ink/2 transition-colors align-top">
                  <td className="px-3 sm:px-5 py-3 text-ink/30 text-xs whitespace-nowrap">{globalOffset + i + 1}</td>
                  <td className="px-3 sm:px-5 py-3 min-w-[160px]">
                    <p className="font-medium text-ink">{ex.name}</p>
                    {ex.muscle_groups.length > 0 && (
                      <p className="text-xs text-ink/40">{ex.muscle_groups.join(', ')}</p>
                    )}
                  </td>
                  <td className="px-3 sm:px-5 py-3 whitespace-nowrap">
                    <TypeBadge type={ex.type} />
                  </td>
                  <td className="px-3 sm:px-5 py-3 text-ink/50 whitespace-nowrap">
                    {(ex.movement_pattern as any)?.name ?? '—'}
                  </td>
                  <td className="px-3 sm:px-5 py-3 text-ink/60 whitespace-nowrap">
                    {ex.optimal_rep_min}–{ex.optimal_rep_max}
                  </td>
                  <td className="px-3 sm:px-5 py-3 whitespace-nowrap">
                    {canEdit(ex) ? (
                      <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(ex)}>Sửa</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger/8"
                          onClick={() => setDeleteTarget(ex)}
                        >
                          Xoá
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-ink/30 rounded-full bg-ink/5 px-2 py-0.5">
                          Dùng chung
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-3">
          <p className="text-xs text-ink/40 whitespace-nowrap shrink-0">
            Hiển thị {globalOffset + 1}–{Math.min(globalOffset + PAGE_SIZE, filtered.length)} / {filtered.length}
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ← Trước
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  p === currentPage
                    ? 'border-ink bg-ink text-paper'
                    : 'border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Tiếp →
            </button>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa */}
      <Modal open={modalOpen} onClose={handleClose} title={modalTitle} size="lg">
        <div className="space-y-4">
          <Input
            label="Tên bài tập"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="VD: Barbell Back Squat"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Loại bài"
              value={formType}
              onChange={e => setFormType(e.target.value)}
              options={EXERCISE_TYPES}
            />
            <Select
              label="Chuỗi Chuyển Động"
              value={formPattern}
              onChange={e => setFormPattern(e.target.value)}
              options={patterns.map(p => ({ value: p.id, label: p.name }))}
              placeholder="— không chọn —"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Reps tối thiểu"
              type="number"
              value={formRepMin}
              onChange={e => setFormRepMin(e.target.value)}
            />
            <Input
              label="Reps tối đa"
              type="number"
              value={formRepMax}
              onChange={e => setFormRepMax(e.target.value)}
            />
          </div>
          <Input
            label="Nhóm cơ (phân cách bằng dấu phẩy)"
            value={formMuscles}
            onChange={e => setFormMuscles(e.target.value)}
            placeholder="VD: đùi trước, mông, đùi sau"
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Mô tả (tuỳ chọn)
            </label>
            <textarea
              rows={2}
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              placeholder="Hướng dẫn kỹ thuật, ghi chú setup..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink bg-white placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-none"
            />
          </div>
          {saveError && <p className="text-sm text-danger">{saveError}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSave}
              disabled={!formName.trim()}
              className="flex-1"
            >
              {editTarget ? 'Lưu thay đổi' : 'Tạo bài tập'}
            </Button>
            <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          </div>
        </div>
      </Modal>

      <ImportExcelModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        patterns={patterns}
        onImported={handleImported}
      />

      {/* ── Delete confirmation modal ──────────────────────────────────────── */}
      {deleteTarget !== null && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
            aria-hidden
          />

          {/* Panel */}
          <div className="relative w-full max-w-sm rounded-2xl bg-paper border border-ink/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

            {/* Top accent strip */}
            <div className="h-1 w-full bg-danger" />

            <div className="px-6 pt-6 pb-7 space-y-5">

              {/* Warning icon */}
              <div className="flex justify-center">
                <div className="h-14 w-14 rounded-full bg-danger/10 border border-danger/18 flex items-center justify-center">
                  <svg
                    className="h-7 w-7 text-danger"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </div>
              </div>

              {/* Text block */}
              <div className="text-center space-y-2">
                <h2
                  id="delete-modal-title"
                  className="text-lg font-bold text-ink leading-tight"
                >
                  Xóa Bài Tập Này?
                </h2>

                {/* Exercise name chip */}
                <p className="inline-flex items-center gap-1.5 rounded-full bg-danger/8 border border-danger/15 px-3 py-1 text-sm font-semibold text-danger">
                  {deleteTarget.name}
                </p>

                <p className="text-sm text-ink/55 leading-relaxed pt-0.5">
                  Hành động này sẽ xóa bài tập khỏi tất cả các giai đoạn và giáo án hiện tại.{' '}
                  <span className="font-medium text-ink/70">
                    Bạn có chắc chắn muốn tiếp tục?
                  </span>
                </p>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* Cancel */}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="h-10 rounded-xl border border-ink/20 bg-transparent text-sm font-semibold text-ink hover:bg-ink/5 hover:border-ink/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Hủy
                </button>

                {/* Confirm delete */}
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="h-10 rounded-xl bg-danger text-sm font-semibold text-paper hover:bg-danger/85 active:bg-danger/95 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Đang xóa…
                    </>
                  ) : (
                    'Xóa'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
