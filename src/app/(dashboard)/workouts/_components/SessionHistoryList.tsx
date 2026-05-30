'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatDate, cn } from '@/lib/utils'
import type { WorkoutSession, WorkoutSet, Exercise } from '@/types'

// ─── Local types ──────────────────────────────────────────────────────────────

type SessionRow = Omit<WorkoutSession, 'sets'> & { sets: { count: number }[] }

interface FullSetData extends WorkoutSet {
  exercise: Exercise
}

interface FullSession extends WorkoutSession {
  sets: FullSetData[]
}

interface SetDraft {
  actual_reps: string
  weight_kg: string
  rir: string
  is_warmup: boolean
  /** true = marked for deletion in the modal, not yet sent to API */
  markedForDelete: boolean
}

interface EditModalState {
  sessionId: string
  full: FullSession
  // Session-level fields
  status: string
  duration: string
  overall_rir: string
  notes: string
  // Set-level drafts keyed by set ID
  drafts: Record<string, SetDraft>
  /** Set IDs whose values differ from the original */
  dirtyIds: Set<string>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_STATUS_VI: Record<string, string> = {
  completed:   'Hoàn thành',
  skipped:     'Bỏ qua',
  in_progress: 'Đang tập',
  planned:     'Đã lên kế hoạch',
}

const STATUS_OPTIONS = [
  { value: 'completed',   label: 'Hoàn thành' },
  { value: 'in_progress', label: 'Đang tập' },
  { value: 'planned',     label: 'Đã lên kế hoạch' },
  { value: 'skipped',     label: 'Bỏ qua' },
]

// ─── Helper: build initial set drafts from a FullSession ─────────────────────

function buildDrafts(sets: FullSetData[]): Record<string, SetDraft> {
  return Object.fromEntries(
    sets.map(s => [
      s.id,
      {
        actual_reps:   s.actual_reps  != null ? String(s.actual_reps)  : '',
        weight_kg:     s.weight_kg    != null ? String(s.weight_kg)    : '',
        rir:           s.rir          != null ? String(s.rir)          : '',
        is_warmup:     s.is_warmup,
        markedForDelete: false,
      },
    ]),
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialSessions: SessionRow[]
}

export function SessionHistoryList({ initialSessions }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions)

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Edit state ───────────────────────────────────────────────────────────────
  const [editState, setEditState] = useState<EditModalState | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Notification ─────────────────────────────────────────────────────────────
  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Auto-dismiss notification after 4 seconds
  useEffect(() => {
    if (!notification) return
    const t = setTimeout(() => setNotification(null), 4000)
    return () => clearTimeout(t)
  }, [notification])

  // ── Delete handlers ───────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteConfirmId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/workouts/${deleteConfirmId}`, { method: 'DELETE' })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== deleteConfirmId))
        setNotification({ type: 'success', message: 'Đã xoá buổi tập thành công.' })
      } else {
        const d = await res.json()
        setNotification({ type: 'error', message: d.error ?? 'Không thể xoá buổi tập.' })
      }
    } catch {
      setNotification({ type: 'error', message: 'Lỗi kết nối máy chủ.' })
    }
    setDeleting(false)
    setDeleteConfirmId(null)
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  const openEdit = useCallback(async (sessionId: string) => {
    setLoadingEdit(true)
    try {
      const res = await fetch(`/api/workouts/${sessionId}`)
      if (!res.ok) throw new Error('fetch failed')
      const { session: full } = (await res.json()) as { session: FullSession }
      setEditState({
        sessionId: full.id,
        full,
        status:      full.status,
        duration:    full.duration_minutes != null ? String(full.duration_minutes) : '',
        overall_rir: full.overall_rir      != null ? String(full.overall_rir)      : '',
        notes:       full.notes            ?? '',
        drafts:      buildDrafts(full.sets ?? []),
        dirtyIds:    new Set(),
      })
    } catch {
      setNotification({ type: 'error', message: 'Không thể tải dữ liệu buổi tập.' })
    }
    setLoadingEdit(false)
  }, [])

  function updateSetField(
    setId: string,
    field: keyof Omit<SetDraft, 'markedForDelete'>,
    value: string | boolean,
  ) {
    setEditState(prev => {
      if (!prev) return prev
      const next: EditModalState = {
        ...prev,
        drafts: {
          ...prev.drafts,
          [setId]: { ...prev.drafts[setId], [field]: value },
        },
        dirtyIds: new Set([...prev.dirtyIds, setId]),
      }
      return next
    })
  }

  function markSetForDelete(setId: string) {
    setEditState(prev => {
      if (!prev) return prev
      return {
        ...prev,
        drafts: {
          ...prev.drafts,
          [setId]: { ...prev.drafts[setId], markedForDelete: true },
        },
        dirtyIds: new Set([...prev.dirtyIds, setId]),
      }
    })
  }

  function unmarkSetForDelete(setId: string) {
    setEditState(prev => {
      if (!prev) return prev
      return {
        ...prev,
        drafts: {
          ...prev.drafts,
          [setId]: { ...prev.drafts[setId], markedForDelete: false },
        },
      }
    })
  }

  async function handleSave() {
    if (!editState) return
    setSaving(true)

    try {
      // 1 — PATCH session-level fields
      const sessionRes = await fetch(`/api/workouts/${editState.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:           editState.status,
          duration_minutes: editState.duration     ? parseInt(editState.duration)         : null,
          overall_rir:      editState.overall_rir  ? parseFloat(editState.overall_rir)   : null,
          notes:            editState.notes.trim() || null,
        }),
      })
      if (!sessionRes.ok) throw new Error('session patch failed')
      const { session: updatedSession } = await sessionRes.json() as { session: WorkoutSession }

      // 2 — Batch set mutations: PATCH dirty non-deleted, DELETE marked ones
      const mutations: Promise<Response>[] = []

      for (const setId of editState.dirtyIds) {
        const draft = editState.drafts[setId]
        if (!draft) continue

        if (draft.markedForDelete) {
          mutations.push(
            fetch(`/api/workouts/${editState.sessionId}/sets?set_id=${setId}`, {
              method: 'DELETE',
            }),
          )
        } else {
          mutations.push(
            fetch(`/api/workouts/${editState.sessionId}/sets?set_id=${setId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                actual_reps: draft.actual_reps !== '' ? parseInt(draft.actual_reps)    : null,
                weight_kg:   draft.weight_kg   !== '' ? parseFloat(draft.weight_kg)   : null,
                rir:         draft.rir         !== '' ? parseInt(draft.rir)            : null,
                is_warmup:   draft.is_warmup,
              }),
            }),
          )
        }
      }

      await Promise.all(mutations)

      // 3 — Update sessions list (reflect status/duration changes in card)
      const deletedCount = [...editState.dirtyIds].filter(
        id => editState.drafts[id]?.markedForDelete,
      ).length

      setSessions(prev =>
        prev.map(s => {
          if (s.id !== editState.sessionId) return s
          const oldCount = s.sets?.[0]?.count ?? 0
          const updated: SessionRow = {
            ...s,
            status:           updatedSession.status,
            duration_minutes: updatedSession.duration_minutes,
            overall_rir:      updatedSession.overall_rir,
            notes:            updatedSession.notes,
            sets: [{ count: Math.max(0, oldCount - deletedCount) }],
          }
          return updated
        }),
      )

      setEditState(null)
      setNotification({ type: 'success', message: 'Đã lưu thay đổi buổi tập thành công.' })
    } catch {
      setNotification({ type: 'error', message: 'Không thể lưu thay đổi. Vui lòng thử lại.' })
    }

    setSaving(false)
  }

  // ── Derived for edit modal ────────────────────────────────────────────────────

  const editedSets = editState
    ? (editState.full.sets ?? []).filter(s => !editState.drafts[s.id]?.markedForDelete)
    : []

  // Group visible sets by exercise_id (preserving insertion order)
  const editGrouped = editedSets.reduce<Record<string, FullSetData[]>>((acc, s) => {
    if (!acc[s.exercise_id]) acc[s.exercise_id] = []
    acc[s.exercise_id].push(s)
    return acc
  }, {})

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Notification banner ─────────────────────────────────────────────── */}
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium',
            'transition-all duration-300',
            notification.type === 'success'
              ? 'bg-herb/8 border-herb/25 text-herb'
              : 'bg-danger/8 border-danger/20 text-danger',
          )}
        >
          {notification.type === 'success' ? (
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="flex-1">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Đóng thông báo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Session list ─────────────────────────────────────────────────────── */}
      {sessions.length === 0 ? (
        <div className="rounded-xl border border-ink/8 bg-white px-5 py-8 text-center">
          <p className="text-sm text-ink/50">
            Chưa có lịch sử tập luyện. Hãy bắt đầu buổi tập đầu tiên của bạn ở trên!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => {
            const setCount = session.sets?.[0]?.count ?? 0
            return (
              <article
                key={session.id}
                className="flex items-center gap-3 rounded-xl bg-white border border-ink/8 px-4 py-3.5 hover:border-ink/18 transition-all"
              >
                {/* Left — navigate to detail */}
                <Link
                  href={`/workouts/${session.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0 group"
                >
                  <div className="h-9 w-9 rounded-xl bg-herb/10 flex items-center justify-center shrink-0 group-hover:bg-herb/18 transition-colors">
                    <svg className="h-4.5 w-4.5 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-ink leading-tight">
                      {formatDate(session.session_date)}
                    </p>
                    <p className="text-xs text-ink/40 mt-0.5 leading-tight">
                      {setCount > 0 ? `${setCount} hiệp` : 'Chưa có hiệp'}
                      {session.duration_minutes ? ` · ${session.duration_minutes} phút` : ''}
                      {session.overall_rir != null ? ` · RIR ${session.overall_rir}` : ''}
                    </p>
                  </div>
                </Link>

                {/* Right — status + action buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge
                    variant={
                      session.status === 'completed'   ? 'slate'
                      : session.status === 'skipped'   ? 'danger'
                      : session.status === 'in_progress' ? 'amber'
                      : 'default'
                    }
                  >
                    {SESSION_STATUS_VI[session.status] ?? session.status}
                  </Badge>

                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={() => openEdit(session.id)}
                    disabled={loadingEdit}
                    aria-label="Sửa buổi tập"
                    title="Sửa buổi tập"
                    className={cn(
                      'h-8 w-8 rounded-lg border flex items-center justify-center transition-colors shrink-0',
                      'border-ink/12 text-ink/40 hover:border-amber/40 hover:text-amber hover:bg-amber/6',
                      loadingEdit && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(session.id)}
                    aria-label="Xoá buổi tập"
                    title="Xoá buổi tập"
                    className="h-8 w-8 rounded-lg border border-ink/12 flex items-center justify-center text-ink/35 hover:border-danger/35 hover:text-danger hover:bg-danger/6 transition-colors shrink-0"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── DELETE CONFIRMATION MODAL ─────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={deleteConfirmId !== null}
        onClose={() => !deleting && setDeleteConfirmId(null)}
        title="Xoá buổi tập"
        size="sm"
      >
        <div className="space-y-5">
          <div className="rounded-xl bg-danger/6 border border-danger/18 p-4 flex items-start gap-3">
            <svg className="h-5 w-5 text-danger shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-ink/75 leading-relaxed">
              Bạn có chắc chắn muốn xóa lịch sử buổi tập này không?{' '}
              <strong className="text-danger">Hành động này không thể hoàn tác.</strong>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              loading={deleting}
              onClick={handleDelete}
              className="flex-1"
            >
              Xoá buổi tập
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleting}
            >
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── EDIT MODAL ────────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={editState !== null}
        onClose={() => !saving && setEditState(null)}
        title={editState ? `Sửa buổi tập — ${formatDate(editState.full.session_date)}` : ''}
        size="lg"
      >
        {loadingEdit && !editState ? (
          <div className="flex justify-center py-10">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
          </div>
        ) : editState ? (
          <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">

            {/* ── Section 1: Session metadata ──────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink/40 mb-3">
                Thông tin buổi tập
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* Status */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                    Trạng thái
                  </label>
                  <select
                    value={editState.status}
                    onChange={e => setEditState(p => p ? { ...p, status: e.target.value } : p)}
                    className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                  >
                    {STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Duration */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                    Thời gian (phút)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editState.duration}
                    onChange={e => setEditState(p => p ? { ...p, duration: e.target.value } : p)}
                    placeholder="VD: 60"
                    className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                  />
                </div>

                {/* Overall RIR */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                    RIR trung bình
                  </label>
                  <input
                    type="number"
                    min="0" max="10" step="0.5"
                    value={editState.overall_rir}
                    onChange={e => setEditState(p => p ? { ...p, overall_rir: e.target.value } : p)}
                    placeholder="0–10"
                    className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                  />
                </div>

                {/* Notes — spans full width on sm+ */}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                    Ghi chú
                  </label>
                  <textarea
                    rows={2}
                    value={editState.notes}
                    onChange={e => setEditState(p => p ? { ...p, notes: e.target.value } : p)}
                    placeholder="Ghi chú buổi tập..."
                    className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-none"
                  />
                </div>
              </div>
            </div>

            {/* ── Divider ───────────────────────────────────────────────────── */}
            <div className="border-t border-ink/8" />

            {/* ── Section 2: Logged sets ────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">
                  Hiệp đã ghi
                </p>
                <span className="text-xs text-ink/35">
                  {editedSets.length} hiệp còn lại
                </span>
              </div>

              {Object.keys(editGrouped).length === 0 ? (
                <p className="text-sm text-center text-ink/40 py-4">
                  Không có hiệp nào trong buổi tập này.
                </p>
              ) : (
                <div className="space-y-5">
                  {Object.entries(editGrouped).map(([exId, exSets]) => {
                    const exercise = exSets[0]?.exercise
                    return (
                      <div key={exId}>
                        {/* Exercise header */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-herb shrink-0" />
                          <p className="text-sm font-semibold text-ink">
                            {exercise?.name ?? 'Bài tập không xác định'}
                          </p>
                          <span className="text-[10px] text-ink/35 font-medium">
                            {exercise?.type ?? ''}
                          </span>
                        </div>

                        {/* Sets table */}
                        <div className="w-full overflow-x-auto rounded-xl border border-ink/8 bg-white">
                          <table className="w-full text-xs min-w-[400px]">
                            <thead className="border-b border-ink/8 bg-ink/2">
                              <tr className="text-[10px] text-ink/40 uppercase tracking-wide">
                                <th className="text-left px-3 py-2 w-10">Hiệp</th>
                                <th className="text-center px-3 py-2 w-10">KĐ</th>
                                <th className="text-center px-3 py-2">Mức tạ (kg)</th>
                                <th className="text-center px-3 py-2">Số lần</th>
                                <th className="text-center px-3 py-2">RIR</th>
                                <th className="text-center px-3 py-2 text-ink/25">RPE</th>
                                <th className="px-3 py-2 w-8" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ink/5">
                              {exSets
                                .sort((a, b) => a.set_number - b.set_number)
                                .map(s => {
                                  const draft = editState.drafts[s.id]
                                  if (!draft) return null
                                  const rirNum = draft.rir !== '' ? parseInt(draft.rir) : NaN
                                  const computedRpe = !isNaN(rirNum) ? 10 - rirNum : null

                                  return (
                                    <tr key={s.id} className="group">
                                      {/* Set number */}
                                      <td className="px-3 py-2 text-ink/60 font-medium">
                                        {s.set_number}
                                      </td>

                                      {/* Warmup toggle */}
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="checkbox"
                                          checked={draft.is_warmup}
                                          onChange={e => updateSetField(s.id, 'is_warmup', e.target.checked)}
                                          className="h-3.5 w-3.5 rounded border-ink/25 accent-amber cursor-pointer"
                                          title="Hiệp khởi động"
                                        />
                                      </td>

                                      {/* Weight */}
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="number"
                                          step="0.5"
                                          min="0"
                                          value={draft.weight_kg}
                                          onChange={e => updateSetField(s.id, 'weight_kg', e.target.value)}
                                          placeholder="—"
                                          className="w-16 text-center bg-transparent border border-transparent focus:border-amber/60 rounded focus:outline-none text-sm text-ink tabular-nums"
                                        />
                                      </td>

                                      {/* Reps */}
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="number"
                                          min="1"
                                          value={draft.actual_reps}
                                          onChange={e => updateSetField(s.id, 'actual_reps', e.target.value)}
                                          placeholder="—"
                                          className="w-12 text-center bg-transparent border border-transparent focus:border-amber/60 rounded focus:outline-none text-sm font-semibold text-ink tabular-nums"
                                        />
                                      </td>

                                      {/* RIR */}
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="number"
                                          min="0" max="10"
                                          value={draft.rir}
                                          onChange={e => updateSetField(s.id, 'rir', e.target.value)}
                                          placeholder="—"
                                          className="w-10 text-center bg-transparent border border-transparent focus:border-amber/60 rounded focus:outline-none text-sm text-ink tabular-nums"
                                        />
                                      </td>

                                      {/* RPE (computed, read-only display) */}
                                      <td className="px-3 py-2 text-center">
                                        {computedRpe != null ? (
                                          <span
                                            className={cn(
                                              'text-xs font-semibold tabular-nums',
                                              computedRpe >= 10 ? 'text-danger'
                                              : computedRpe >= 8  ? 'text-amber'
                                              : 'text-ink/40',
                                            )}
                                          >
                                            {computedRpe}
                                          </span>
                                        ) : (
                                          <span className="text-ink/20">—</span>
                                        )}
                                      </td>

                                      {/* Delete set */}
                                      <td className="px-3 py-2 text-center">
                                        <button
                                          type="button"
                                          onClick={() => markSetForDelete(s.id)}
                                          aria-label="Xoá hiệp này"
                                          title="Xoá hiệp này"
                                          className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded flex items-center justify-center text-danger/50 hover:text-danger hover:bg-danger/8 transition-all"
                                        >
                                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                              d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}

                  {/* Deleted sets preview */}
                  {Object.values(editState.drafts).some(d => d.markedForDelete) && (
                    <div className="rounded-xl border border-dashed border-danger/25 bg-danger/4 px-4 py-3">
                      <p className="text-xs font-semibold text-danger mb-1.5">
                        Sẽ xoá {Object.values(editState.drafts).filter(d => d.markedForDelete).length} hiệp khi lưu
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(editState.full.sets ?? [])
                          .filter(s => editState.drafts[s.id]?.markedForDelete)
                          .map(s => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => unmarkSetForDelete(s.id)}
                              title="Khôi phục hiệp này"
                              className="text-[10px] rounded-full border border-danger/25 bg-white px-2.5 py-0.5 text-danger/70 hover:bg-danger/6 transition-colors font-medium"
                            >
                              Hiệp {s.set_number} · {s.exercise?.name} ↩
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Footer: Save / Cancel ─────────────────────────────────────── */}
            <div className="sticky bottom-0 -mx-1 bg-paper pt-4 pb-1 border-t border-ink/8 flex gap-2">
              <Button
                type="button"
                variant="primary"
                loading={saving}
                onClick={handleSave}
                disabled={saving}
                className="flex-1"
              >
                Lưu thay đổi
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditState(null)}
                disabled={saving}
              >
                Huỷ
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Loading overlay while fetching full session for edit */}
      {loadingEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-3 border-ink/20 border-t-amber" />
        </div>
      )}
    </>
  )
}
