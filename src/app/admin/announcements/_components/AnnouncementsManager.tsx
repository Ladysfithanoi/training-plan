'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import { ANNOUNCEMENT_MAX_ITEMS, ANNOUNCEMENT_MAX_VISIBLE } from '@/lib/announcements'
import { AnnouncementBoard } from '@/components/announcements/AnnouncementBoard'
import type { Announcement } from '@/types'

const PAGE_SIZE = 3

/**
 * Resize + recompress a picked image entirely in the browser so the stored
 * base64 data-URL stays small (keeps the DB light — see migration 010). Caps
 * the longest edge at 1280px and re-encodes as JPEG. Transparent pixels are
 * flattened onto white.
 */
async function fileToCompressedDataUrl(file: File, maxDim = 1280, quality = 0.8): Promise<string> {
  const sourceUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Tệp không phải ảnh hợp lệ.'))
    image.src = sourceUrl
  })

  let { width, height } = img
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return sourceUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; item: Announcement }
  | null

export function AnnouncementsManager({ initialItems }: { initialItems: Announcement[] }) {
  const [items, setItems] = useState(initialItems)
  const [page, setPage] = useState(1)

  // Editor (create / edit) modal
  const [editor, setEditor] = useState<EditorState>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const atCapacity = items.length >= ANNOUNCEMENT_MAX_ITEMS
  // Live preview — the 3 newest, exactly what HLV see on the guide board.
  const previewItems = items.slice(0, ANNOUNCEMENT_MAX_VISIBLE)

  // Pagination
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function openCreate() {
    setEditor({ mode: 'create' })
    setTitle('')
    setContent('')
    setImage(null)
    setFormError(null)
  }

  function openEdit(item: Announcement) {
    setEditor({ mode: 'edit', item })
    setTitle(item.title)
    setContent(item.content)
    setImage(item.image_url)
    setFormError(null)
  }

  function closeEditor() {
    setEditor(null)
    setFormError(null)
  }

  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file later
    if (!file) return
    setImageBusy(true)
    setFormError(null)
    try {
      setImage(await fileToCompressedDataUrl(file))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không xử lý được ảnh.')
    } finally {
      setImageBusy(false)
    }
  }

  async function handleSave() {
    if (!editor) return
    if (!title.trim() || !content.trim()) {
      setFormError('Vui lòng nhập tiêu đề và nội dung.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const isEdit = editor.mode === 'edit'
      const url = isEdit ? `/api/announcements/${editor.item.id}` : '/api/announcements'
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), image_url: image }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lưu thất bại')

      const saved = data.announcement as Announcement
      if (isEdit) {
        setItems(prev => prev.map(it => (it.id === saved.id ? saved : it)))
      } else {
        setItems(prev => [saved, ...prev])
        setPage(1)
      }
      closeEditor()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Lỗi không xác định')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE' })
    if (res.ok) {
      const updated = items.filter(it => it.id !== id)
      setItems(updated)
      const newTotal = Math.max(1, Math.ceil(updated.length / PAGE_SIZE))
      if (currentPage > newTotal) setPage(newTotal)
    }
  }

  return (
    <>
      {/* ── Live preview — đúng như HLV nhìn thấy ở "Hướng dẫn sử dụng" ─────── */}
      <div className="rounded-2xl border border-dashed border-amber/30 bg-amber/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber/80">
            Xem trước
          </p>
          <p className="text-[11px] text-ink/40">
            Đúng như HLV thấy ở “Hướng dẫn sử dụng” · {ANNOUNCEMENT_MAX_VISIBLE} tin mới nhất
          </p>
        </div>
        {previewItems.length > 0 ? (
          <AnnouncementBoard items={previewItems} />
        ) : (
          <div className="rounded-xl border border-ink/10 bg-white py-8 text-center">
            <p className="text-sm text-ink/40">
              Chưa có tin nào để hiển thị. Đăng tin đầu tiên để xem trước Bảng tin.
            </p>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink/50">
          {items.length}/{ANNOUNCEMENT_MAX_ITEMS} tin
        </p>
        <Button onClick={openCreate} disabled={atCapacity}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Thêm tin
        </Button>
      </div>

      {atCapacity && (
        <div className="rounded-xl border border-amber/25 bg-amber/5 px-4 py-2.5">
          <p className="text-sm text-amber/90">
            Đã đạt tối đa {ANNOUNCEMENT_MAX_ITEMS} tin. Hãy xoá bớt một tin trước khi thêm mới.
          </p>
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-gray-100 bg-white py-10">
          <p className="text-sm text-center text-ink/40">Chưa có tin nào. Hãy thêm tin đầu tiên ở trên.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pageItems.map(item => (
            <article
              key={item.id}
              className="flex gap-4 rounded-2xl border border-ink/8 bg-white p-4"
            >
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.image_url}
                  alt={item.title}
                  className="h-20 w-28 shrink-0 rounded-lg object-cover bg-ink/5"
                />
              ) : (
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink/25">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber">
                  {formatDate(item.created_at)}
                </p>
                <h3 className="mt-0.5 text-base font-bold text-ink leading-snug truncate">{item.title}</h3>
                <p className="mt-1 text-sm text-ink/55 leading-relaxed line-clamp-2 whitespace-pre-line">
                  {item.content}
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>Sửa</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(item.id)}
                  className="text-danger hover:bg-danger/8"
                >
                  Xoá
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
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
      )}

      {/* Editor modal */}
      <Modal
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.mode === 'edit' ? 'Sửa tin' : 'Thêm tin mới'}
      >
        <div className="space-y-4">
          {/* Image picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">Ảnh</span>
            <div className="flex items-center gap-3">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="Xem trước" className="h-20 w-28 shrink-0 rounded-lg object-cover bg-ink/5" />
              ) : (
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink/20 bg-ink/[0.02] text-ink/25">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickImage}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={imageBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {image ? 'Đổi ảnh' : 'Chọn ảnh'}
                </Button>
                {image && (
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    className="text-xs font-medium text-danger/80 hover:text-danger text-left"
                  >
                    Bỏ ảnh
                  </button>
                )}
              </div>
            </div>
          </div>

          <Input
            label="Tiêu đề"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="VD: Đã có chương trình tập mới cho mùa hè"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ann-content" className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Nội dung
            </label>
            <textarea
              id="ann-content"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={5}
              placeholder="Viết nội dung chi tiết của tin..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink bg-white placeholder:text-ink/35 outline-none transition-colors focus:border-amber focus:ring-1 focus:ring-amber resize-y"
            />
          </div>

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSave}
              disabled={!title.trim() || !content.trim() || imageBusy}
              className="flex-1"
            >
              {editor?.mode === 'edit' ? 'Lưu thay đổi' : 'Đăng tin'}
            </Button>
            <Button variant="secondary" onClick={closeEditor}>Huỷ</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Xoá tin"
        description="Bạn có chắc chắn muốn xoá tin này khỏi bảng tin? Hành động này không thể hoàn tác."
        confirmLabel="Xoá tin"
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
