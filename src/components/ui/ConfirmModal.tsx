'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

interface ConfirmModalProps {
  open: boolean
  /** Modal heading — rendered in font-sans so it stays UI-chrome weight */
  title?: string
  /** Explanatory copy below the title */
  description: string
  /** Label for the confirm/destructive button */
  confirmLabel?: string
  /** Label for the cancel button */
  cancelLabel?: string
  /**
   * 'danger'  → red trash-icon + danger button (default, for destructive actions)
   * 'warning' → amber icon + primary button (for non-destructive confirmations)
   */
  variant?: 'danger' | 'warning'
  /** Called when the user presses the confirm button */
  onConfirm: () => void
  /** Called when the user presses Cancel, the Escape key, or the backdrop */
  onCancel: () => void
}

/**
 * ConfirmModal
 * ─────────────────────────────────────────────────────────────────────────────
 * A polished, brand-aligned replacement for browser `window.confirm()`.
 * Uses the same backdrop/panel language as <Modal> (bg-ink/40, rounded-2xl,
 * bg-paper, shadow-2xl) so it feels native to the design system.
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *
 *   <ConfirmModal
 *     open={open}
 *     title="Xoá bài tập"
 *     description="Hành động này không thể hoàn tác."
 *     confirmLabel="Xoá"
 *     onConfirm={() => { doDelete(); setOpen(false) }}
 *     onCancel={() => setOpen(false)}
 *   />
 */
export function ConfirmModal({
  open,
  title = 'Xác nhận',
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // ── Escape key → cancel ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const isDanger = variant === 'danger'

  return (
    <div
      role="alertdialog"
      aria-modal
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      {/* Backdrop click = cancel */}
      <div className="absolute inset-0" onClick={onCancel} aria-hidden />

      {/* ── Modal sheet ───────────────────────────────────────────────────── */}
      <div className="relative bg-paper rounded-2xl shadow-2xl border border-ink/8 max-w-md w-full p-6 mx-4">

        {/* Icon badge */}
        <div
          className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border ${
            isDanger
              ? 'bg-danger/8 border-danger/20'
              : 'bg-amber/8 border-amber/20'
          }`}
        >
          {isDanger ? (
            /* Trash icon */
            <svg
              className="h-5 w-5 text-danger"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          ) : (
            /* Warning icon */
            <svg
              className="h-5 w-5 text-amber"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          )}
        </div>

        {/* Title — explicit font-sans so it stays UI-chrome weight, not editorial serif */}
        <h3
          id="confirm-modal-title"
          className="font-sans text-base font-semibold text-ink mb-2"
        >
          {title}
        </h3>

        {/* Description */}
        <p
          id="confirm-modal-desc"
          className="text-sm text-ink/55 leading-relaxed mb-6"
        >
          {description}
        </p>

        {/* ── Action row ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
