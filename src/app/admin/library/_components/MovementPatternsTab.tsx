'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import type { MovementPattern } from '@/types'

interface Props {
  patterns: MovementPattern[]
  onPatternsChange: (patterns: MovementPattern[]) => void
}

export function MovementPatternsTab({ patterns, onPatternsChange }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MovementPattern | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openCreate() {
    setName('')
    setDescription('')
    setError(null)
    setCreateOpen(true)
  }

  function openEdit(p: MovementPattern) {
    setName(p.name)
    setDescription(p.description ?? '')
    setError(null)
    setEditTarget(p)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)

    const isEdit = !!editTarget

    const res = await fetch(
      isEdit ? `/api/movement-patterns/${editTarget!.id}` : '/api/movement-patterns',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      },
    )

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Không thể lưu')
      return
    }

    if (isEdit) {
      onPatternsChange(patterns.map(p => (p.id === editTarget!.id ? data.pattern : p)))
      setEditTarget(null)
    } else {
      onPatternsChange([...patterns, data.pattern].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateOpen(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Xoá chuỗi chuyển động này? Bài tập liên quan sẽ mất liên kết.')) return

    const res = await fetch(`/api/movement-patterns/${id}`, { method: 'DELETE' })
    if (res.ok) {
      onPatternsChange(patterns.filter(p => p.id !== id))
    }
  }

  const modalOpen = createOpen || !!editTarget
  const modalTitle = editTarget ? `Chỉnh sửa — ${editTarget.name}` : 'Thêm Chuỗi Chuyển Động'

  function handleClose() {
    setCreateOpen(false)
    setEditTarget(null)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink/50">{patterns.length} chuỗi chuyển động</p>
        <Button onClick={openCreate}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Thêm mới
        </Button>
      </div>

      {/* Responsive table wrapper */}
      <div className="w-full overflow-x-auto rounded-xl border border-ink/8 bg-white">
        {patterns.length === 0 ? (
          <p className="text-sm text-center text-ink/40 py-10">Chưa có chuỗi chuyển động nào.</p>
        ) : (
          <table className="w-full text-sm min-w-[460px]">
            <thead className="border-b border-ink/8">
              <tr className="text-xs text-ink/40 uppercase tracking-wide">
                <th className="text-left px-5 py-3 w-8">#</th>
                <th className="text-left px-5 py-3">Tên</th>
                <th className="text-left px-5 py-3">Mô tả</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {patterns.map((p, i) => (
                <tr key={p.id} className="group hover:bg-ink/2 transition-colors">
                  <td className="px-5 py-3 text-ink/30 text-xs">{i + 1}</td>
                  <td className="px-5 py-3 font-medium text-ink">{p.name}</td>
                  <td className="px-5 py-3 text-ink/50">{p.description ?? '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>
                        Sửa
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger/8"
                        onClick={() => handleDelete(p.id)}
                      >
                        Xoá
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={modalOpen} onClose={handleClose} title={modalTitle}>
        <div className="space-y-4">
          <Input
            label="Tên chuỗi chuyển động"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: Squat, Hinge, Push..."
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Mô tả (tuỳ chọn)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ghi chú ngắn..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink bg-white placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-none"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSave}
              disabled={!name.trim()}
              className="flex-1"
            >
              {editTarget ? 'Lưu thay đổi' : 'Tạo mới'}
            </Button>
            <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
