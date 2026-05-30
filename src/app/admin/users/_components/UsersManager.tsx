'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import type { Profile, TrainingBlock } from '@/types'

interface UsersManagerProps {
  users: Profile[]
  blocks: TrainingBlock[]
}

const PAGE_SIZE = 5

export function UsersManager({ users: initialUsers, blocks }: UsersManagerProps) {
  const router = useRouter()
  const [users, setUsers] = useState(initialUsers)
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState<Profile | null>(null)
  const [editOpen, setEditOpen] = useState<Profile | null>(null)

  // Thêm học viên
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Chỉnh sửa
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Giao giáo án
  const [selectedBlock, setSelectedBlock] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [assigning, setAssigning] = useState(false)

  // Gửi chương trình — magic link
  const [magicLinkOpen, setMagicLinkOpen] = useState<Profile | null>(null)
  const [magicGenerating, setMagicGenerating] = useState(false)
  const [magicResult, setMagicResult] = useState<{ token: string; url: string } | null>(null)
  const [magicError, setMagicError] = useState<string | null>(null)
  const [magicCopied, setMagicCopied] = useState(false)

  // Xoá học viên — replaces window.confirm() with <ConfirmModal>
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = users.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const globalOffset = (currentPage - 1) * PAGE_SIZE

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          full_name: newName,
          role: newRole,
        }),
      })

      // Check status BEFORE attempting to parse — server may return an empty
      // body or HTML error page (e.g. uncaught 500), which would throw
      // "Unexpected end of JSON input" if we called res.json() unconditionally.
      if (!res.ok) {
        let errorMessage = 'Không thể tạo tài khoản'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          // Server returned empty body or non-JSON content — keep default message
          console.error('[handleCreate] Non-JSON error payload:', res.status, res.statusText)
        }
        setCreateError(errorMessage)
        return
      }

      const data = await res.json()
      setUsers(prev => [data.profile, ...prev])
      setCreateOpen(false)
      setNewEmail('')
      setNewPassword('')
      setNewName('')
      setNewRole('user')
      router.refresh()
    } catch (err) {
      // Network failure or other unexpected throw
      setCreateError(err instanceof Error ? err.message : 'Lỗi kết nối. Vui lòng thử lại.')
    } finally {
      // Always unfreeze the button regardless of outcome
      setCreating(false)
    }
  }

  function openEdit(user: Profile) {
    setEditName(user.full_name ?? '')
    setEditRole(user.role)
    setEditError(null)
    setEditOpen(user)
  }

  async function handleEdit() {
    if (!editOpen) return
    setEditSaving(true)
    setEditError(null)

    const res = await fetch(`/api/admin/users/${editOpen.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: editName, role: editRole }),
    })

    const data = await res.json()
    setEditSaving(false)

    if (!res.ok) {
      setEditError(data.error ?? 'Cập nhật thất bại')
      return
    }

    setUsers(prev => prev.map(u => u.id === editOpen.id ? { ...u, full_name: editName, role: editRole } : u))
    setEditOpen(null)
  }

  async function handleAssign() {
    if (!assignOpen || !selectedBlock) return
    setAssigning(true)

    const res = await fetch('/api/user-programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: assignOpen.id,
        block_id: selectedBlock,
        start_date: startDate,
      }),
    })

    setAssigning(false)
    if (res.ok) {
      setAssignOpen(null)
      setSelectedBlock('')
      router.refresh()
    }
  }

  async function openMagicLink(user: Profile) {
    setMagicLinkOpen(user)
    setMagicResult(null)
    setMagicError(null)
    setMagicCopied(false)
    setMagicGenerating(true)
    try {
      const res = await fetch('/api/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Không thể tạo liên kết')
      setMagicResult(data)
    } catch (err) {
      setMagicError(err instanceof Error ? err.message : 'Lỗi không xác định')
    } finally {
      setMagicGenerating(false)
    }
  }

  async function copyMagicLink() {
    if (!magicResult) return
    try {
      await navigator.clipboard.writeText(magicResult.url)
      setMagicCopied(true)
      setTimeout(() => setMagicCopied(false), 2500)
    } catch {
      // Fallback: select text in the input
    }
  }

  async function handleDelete(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    if (res.ok) {
      const updated = users.filter(u => u.id !== userId)
      setUsers(updated)
      const newTotal = Math.max(1, Math.ceil(updated.length / PAGE_SIZE))
      if (currentPage > newTotal) setPage(newTotal)
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Quản trị viên',
    user: 'Học viên',
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/50">{users.length} học viên</p>
        <Button onClick={() => setCreateOpen(true)}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Thêm Học viên
        </Button>
      </div>

      {/* Bảng học viên
           Single scroll container: overflow-x-auto + min-w on the table forces
           a genuine horizontal slider — the table never shrinks below 1100 px
           so every column has guaranteed breathing room. whitespace-nowrap on
           every th/td prevents vertical line-breaks inside cells. */}
      {users.length === 0 ? (
        <div className="rounded-lg border border-gray-100 bg-white py-10">
          <p className="text-sm text-center text-ink/40">Chưa có học viên nào. Hãy thêm mới ở trên.</p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto border border-gray-100 rounded-lg max-w-full block">
          <table className="w-full min-w-[1100px] table-auto text-sm bg-white">
            <thead className="border-b border-ink/8 bg-ink/[0.015]">
              <tr className="text-[11px] text-ink/40 uppercase tracking-wider">
                <th className="w-10 text-center px-3 py-3 font-semibold whitespace-nowrap">#</th>
                <th className="w-44 text-left px-4 py-3 font-semibold whitespace-nowrap">Họ tên</th>
                <th className="w-56 text-left px-4 py-3 font-semibold whitespace-nowrap">Email</th>
                <th className="w-28 text-center px-3 py-3 font-semibold whitespace-nowrap">Vai trò</th>
                <th className="w-32 text-center px-4 py-3 font-semibold whitespace-nowrap">Ngày tham gia</th>
                <th className="w-[30%] min-w-[360px] text-right px-4 py-3 font-semibold whitespace-nowrap">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageItems.map((user, i) => (
                <tr key={user.id} className="hover:bg-ink/[0.018] transition-colors">

                  {/* # */}
                  <td className="px-3 py-3.5 text-center text-[11px] text-ink/30 font-mono tabular-nums whitespace-nowrap">
                    {globalOffset + i + 1}
                  </td>

                  {/* Họ tên — no truncation, full name always visible */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-ink/8 flex items-center justify-center text-[11px] font-bold text-ink shrink-0">
                        {user.full_name?.[0]?.toUpperCase() ?? user.email[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-ink">
                        {user.full_name ?? '—'}
                      </span>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3.5 text-xs text-ink/55 whitespace-nowrap">
                    {user.email}
                  </td>

                  {/* Vai trò — badge stays on one line */}
                  <td className="px-3 py-3.5 text-center whitespace-nowrap">
                    <div className="flex justify-center">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                        user.role === 'admin'
                          ? 'bg-ink/10 text-ink'
                          : 'bg-herb/10 text-herb'
                      }`}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </div>
                  </td>

                  {/* Ngày tham gia */}
                  <td className="px-4 py-3.5 text-center text-xs font-mono text-ink/40 whitespace-nowrap">
                    {formatDate(user.created_at)}
                  </td>

                  {/* Hành động — always visible, locked width */}
                  <td className="w-[30%] min-w-[360px] px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">

                      {user.role === 'user' && (
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="inline-flex items-center rounded-lg border border-herb/30 bg-herb/5 px-2.5 py-1 text-xs font-medium text-herb hover:bg-herb/12 hover:border-herb/50 transition-colors shrink-0"
                        >
                          📊 Tiến độ
                        </Link>
                      )}

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEdit(user)}
                        className="shrink-0"
                      >
                        Sửa
                      </Button>

                      {user.role === 'user' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAssignOpen(user)}
                          className="shrink-0"
                        >
                          Giáo án
                        </Button>
                      )}

                      {user.role === 'user' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openMagicLink(user)}
                          className="shrink-0 text-amber border-amber/30 hover:bg-amber/8 hover:border-amber/50"
                        >
                          🔗 Gửi link
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteId(user.id)}
                        className="shrink-0 text-danger hover:bg-danger/8"
                      >
                        Xoá
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink/40">
            Hiển thị {globalOffset + 1}–{Math.min(globalOffset + PAGE_SIZE, users.length)} / {users.length}
          </p>
          <div className="flex gap-1">
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

      {/* Modal: Thêm học viên */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Thêm tài khoản Học viên">
        <div className="space-y-4">
          <Input
            label="Họ và tên"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nguyễn Văn A"
          />
          <Input
            label="Email"
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            required
          />
          <Input
            label="Mật khẩu tạm thời"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Tối thiểu 8 ký tự"
            required
          />
          <Select
            label="Vai trò"
            value={newRole}
            onChange={e => setNewRole(e.target.value as 'user' | 'admin')}
            options={[
              { value: 'user', label: 'Học viên' },
              { value: 'admin', label: 'Quản trị viên / HLV' },
            ]}
          />
          {createError && (
            <p className="text-sm text-danger">{createError}</p>
          )}
          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              loading={creating}
              onClick={handleCreate}
              disabled={!newEmail || !newPassword}
              className="flex-1"
            >
              Tạo tài khoản
            </Button>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Chỉnh sửa */}
      <Modal
        open={!!editOpen}
        onClose={() => setEditOpen(null)}
        title={`Chỉnh sửa — ${editOpen?.full_name ?? editOpen?.email}`}
      >
        <div className="space-y-4">
          <Input
            label="Họ và tên"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="Nguyễn Văn A"
          />
          <Select
            label="Vai trò"
            value={editRole}
            onChange={e => setEditRole(e.target.value as 'user' | 'admin')}
            options={[
              { value: 'user', label: 'Học viên' },
              { value: 'admin', label: 'Quản trị viên / HLV' },
            ]}
          />
          {editError && <p className="text-sm text-danger">{editError}</p>}
          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              loading={editSaving}
              onClick={handleEdit}
              className="flex-1"
            >
              Lưu thay đổi
            </Button>
            <Button variant="secondary" onClick={() => setEditOpen(null)}>
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Giao giáo án */}
      <Modal
        open={!!assignOpen}
        onClose={() => setAssignOpen(null)}
        title={`Giao giáo án cho ${assignOpen?.full_name ?? assignOpen?.email}`}
      >
        <div className="space-y-4">
          <Select
            label="Khối tập luyện"
            value={selectedBlock}
            onChange={e => setSelectedBlock(e.target.value)}
            options={blocks.map(b => ({ value: b.id, label: b.name }))}
            placeholder="Chọn khối tập..."
          />
          <Input
            label="Ngày bắt đầu"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
          <div className="flex gap-2 pt-2">
            <Button
              variant="herb"
              loading={assigning}
              onClick={handleAssign}
              disabled={!selectedBlock}
              className="flex-1"
            >
              Giao giáo án
            </Button>
            <Button variant="secondary" onClick={() => setAssignOpen(null)}>
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Gửi chương trình (Magic Link) */}
      <Modal
        open={!!magicLinkOpen}
        onClose={() => { setMagicLinkOpen(null); setMagicResult(null); setMagicError(null) }}
        title="Chia sẻ Chương trình"
      >
        <div className="space-y-5">
          {/* Subtitle */}
          <p className="text-sm text-ink/55">
            Tạo liên kết truy cập riêng cho{' '}
            <strong className="text-ink font-semibold">{magicLinkOpen?.full_name ?? magicLinkOpen?.email}</strong>.
            {' '}Học viên có thể ghi nhận buổi tập mà không cần tài khoản.
          </p>

          {/* Loading state */}
          {magicGenerating && (
            <div className="flex items-center justify-center gap-3 py-6">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink/15 border-t-amber" />
              <p className="text-sm text-ink/50">Đang tạo liên kết...</p>
            </div>
          )}

          {/* Error state */}
          {magicError && !magicGenerating && (
            <div className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2.5">
              <p className="text-sm font-semibold text-danger">Tạo liên kết thất bại</p>
              <p className="text-xs text-danger/70 mt-0.5">{magicError}</p>
              <button
                type="button"
                onClick={() => magicLinkOpen && openMagicLink(magicLinkOpen)}
                className="mt-2 text-xs font-semibold text-danger/80 hover:text-danger underline underline-offset-2"
              >
                Thử lại
              </button>
            </div>
          )}

          {/* Success state */}
          {magicResult && !magicGenerating && (
            <div className="space-y-3">
              {/* Link display */}
              <div className="rounded-xl border border-herb/25 bg-herb/5 p-3">
                <p className="text-xs font-semibold text-herb/80 uppercase tracking-wide mb-1.5">
                  Liên kết truy cập
                </p>
                <p className="text-sm font-mono text-ink break-all leading-relaxed">
                  {magicResult.url}
                </p>
              </div>

              {/* Copy button */}
              <button
                type="button"
                onClick={copyMagicLink}
                className={`w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                  magicCopied
                    ? 'border-herb/40 bg-herb/8 text-herb'
                    : 'border-ink/20 bg-white text-ink hover:border-amber/40 hover:bg-amber/5 hover:text-amber'
                }`}
              >
                {magicCopied ? (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Đã sao chép!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Sao chép liên kết
                  </>
                )}
              </button>

              {/* Hint */}
              <p className="text-xs text-ink/35 text-center">
                Liên kết này không thay đổi — bạn có thể chia sẻ lại bất cứ lúc nào.
              </p>
            </div>
          )}

          {/* Close */}
          <Button
            variant="secondary"
            onClick={() => { setMagicLinkOpen(null); setMagicResult(null); setMagicError(null) }}
            className="w-full"
          >
            Đóng
          </Button>
        </div>
      </Modal>

      {/* ── Confirm: xoá học viên ──────────────────────────────────────────── */}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Xoá tài khoản học viên"
        description="Bạn có chắc chắn muốn xoá tài khoản học viên này? Toàn bộ dữ liệu liên quan sẽ bị xoá vĩnh viễn và hành động này không thể hoàn tác."
        confirmLabel="Xoá tài khoản"
        onConfirm={() => {
          const id = confirmDeleteId!
          setConfirmDeleteId(null)
          void handleDelete(id)
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  )
}
