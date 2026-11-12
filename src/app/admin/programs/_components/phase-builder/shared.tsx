'use client'

import { useState } from 'react'
import type { SplitType, SplitDay } from '@/lib/trainingSplit'
import type { Phase, Exercise, PhaseExercise, TrainingBlock } from '@/types'

// Constants, types and small helpers shared by PhaseExerciseBuilder and the
// components split out of it (./phase-builder/*).

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Kiểu xếp lịch — Loading style options used in the add-exercise form.
 *
 * Horizontal Loading (Tập đơn lẻ):
 *   Coach completes ALL sets of exercise A before moving to B, then C, etc.
 *   Order labels are auto-assigned as simple letter sequences: A → B → C …
 *
 * Vertical Loading (Tập Superset / Cặp):
 *   Sets are grouped; the coach rotates between exercises in the same group.
 *   Order labels are manually entered as composite tags: A1, A2, B1, B2 …
 *   Exercises sharing the same letter prefix belong to the same superset.
 */
export const LOADING_STYLE_OPTIONS = [
  {
    value: 'horizontal' as const,
    label: 'Horizontal Loading (Tập đơn lẻ)',
    desc: 'Hoàn thành tất cả hiệp rồi mới chuyển bài. Mã STT tự động: A, B, C…',
  },
  {
    value: 'vertical' as const,
    label: 'Vertical Loading (Tập Superset / Cặp)',
    desc: 'Xoay vòng giữa các bài trong cùng nhóm. Nhập mã tùy chỉnh: A1, A2, B1, B2…',
  },
]

/**
 * Trần số buổi thêm được cho MỖI loại trong một lượt "Thêm ngày".
 * Đủ rộng cho mọi giáo án thực tế (tối đa vài vòng split/tuần) mà vẫn chặn được
 * trường hợp bấm nhầm giữ nút rồi sinh ra hàng trăm buổi trống.
 */
export const MAX_NEW_DAYS_PER_TYPE = 14

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for the STT order badge.
 * Colors are keyed by the first letter so all exercises in the same
 * superset group (A1, A2 …) share a consistent visual indicator.
 */
export function orderBadgeClass(label: string): string {
  const ch = label[0]?.toUpperCase()
  if (ch === 'A') return 'bg-amber/15 text-amber border-amber/40'
  if (ch === 'B') return 'bg-herb/15 text-herb border-herb/35'
  if (ch === 'C') return 'bg-sky-500/10 text-sky-600 border-sky-400/30'
  if (ch === 'D') return 'bg-violet-500/10 text-violet-600 border-violet-400/30'
  return 'bg-ink/8 text-ink/55 border-ink/20'
}

/**
 * Compute the next horizontal order label for a day given how many exercises
 * are already assigned to it (0 → 'A', 1 → 'B', … 25 → 'Z', 26 → 'A2', …).
 */
export function computeHorizontalLabel(existingCount: number): string {
  const idx   = existingCount % 26
  const cycle = Math.floor(existingCount / 26)
  return cycle > 0
    ? `${String.fromCharCode(65 + idx)}${cycle + 1}`
    : String.fromCharCode(65 + idx)
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A training block with its phases pre-joined (mirrors the Supabase query shape). */
export type BlockWithPhases = TrainingBlock & { phases: Phase[] }

export interface PhaseExerciseRow extends PhaseExercise {
  exercise: Exercise
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'nochange'

/** Stable signature of a split config (type + ordered days) for change detection. */
export function splitSig(type: SplitType | null, days: SplitDay[]): string {
  return JSON.stringify({
    type: type ?? null,
    days: (days ?? []).map(d => ({ id: d.id, type: d.type, label: d.label })),
  })
}

/** The inline numeric fields of the prescription table, with their legal bounds. */
export type NumericField = 'target_sets' | 'target_rep_min' | 'target_rep_max' | 'rir_target'

export const NUMERIC_LIMITS: Record<NumericField, { min: number; max: number }> = {
  target_sets:    { min: 1, max: 10 },
  target_rep_min: { min: 1, max: 100 },
  target_rep_max: { min: 1, max: 100 },
  rir_target:     { min: 0, max: 10 },
}

/**
 * Read a numeric form field, clamped to what the column may legally hold.
 * A blank / non-numeric entry keeps `fallback` — the value already stored —
 * rather than collapsing to a constant like 1.
 */
export function parseNumericField(field: NumericField, raw: string, fallback: number): number {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  const { min, max } = NUMERIC_LIMITS[field]
  return Math.min(max, Math.max(min, n))
}

/**
 * One inline number cell in the prescription table.
 *
 * Typing only moves a LOCAL draft — the PATCH fires once, on blur or Enter.
 * The previous version saved on every keystroke, so editing "8" → "10" sent two
 * writes ({…:1} then {…:10}). Those requests race: when the first landed last,
 * the DB kept the intermediate digit and the coach's rep window snapped back to
 * things like 1-1 or 10-1 the next time the meso was opened.
 *
 * Escape abandons the draft, so a half-typed number can always be backed out of.
 */
export function InlineNumberCell({
  value, field, title, onCommit,
}: {
  value:    number | null | undefined
  field:    NumericField
  title:    string
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const limits = NUMERIC_LIMITS[field]

  function commit() {
    const raw = draft
    setDraft(null)
    if (raw !== null) onCommit(raw)
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      title={title}
      value={draft ?? String(value ?? '')}
      min={limits.min}
      max={limits.max}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter')  e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      className="w-12 text-center bg-transparent border border-transparent focus:border-amber/50 rounded focus:outline-none text-sm font-mono tabular-nums text-ink"
    />
  )
}
