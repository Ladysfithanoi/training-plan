import type { PhaseType, ProgramStatus, SessionStatus, ExerciseType } from '@/types'
import { daysBetweenISO, todayISO } from './date'

// ─── Class merging ────────────────────────────────────────────────────────────
/** Minimal clsx-like utility (no dependency needed) */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr))
}

export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + weeks * 7)
  return result
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Returns the week number (1-based) within a phase, on the Vietnam calendar.
 *
 * Counted from `phase_start_date`, so week 2 begins on the same weekday the
 * meso started — at LOCAL midnight. This used to be derived from the server's
 * UTC clock, which made every week (and with it every meso rollover) arrive
 * seven hours late: 07:00 Vietnam time instead of 00:00. See `@/lib/date`.
 */
export function currentWeekInPhase(phaseStartDate: string): number {
  return weekOfDateInPhase(phaseStartDate, todayISO())
}

/**
 * Returns the 1-based week number within a phase for an arbitrary date
 * (e.g. a past session's `session_date`), so logged sessions can be bucketed
 * back into the week they belong to.
 */
export function weekOfDateInPhase(phaseStartDate: string, dateStr: string): number {
  const days = daysBetweenISO(phaseStartDate, dateStr)
  if (Number.isNaN(days)) return 1
  return Math.max(1, Math.floor(days / 7) + 1)
}

/**
 * True once the phase has run its full length — from the first day that would
 * otherwise be week `durationWeeks + 1`.
 *
 * Deliberately the exact complement of `currentWeekInPhase`: the meso expires
 * on the very same day the week counter would overrun ("Tuần 5/4"), so the two
 * can never drift apart the way they could when one compared timestamps and
 * the other compared whole days.
 */
export function isPhaseExpired(phaseStartDate: string, durationWeeks: number): boolean {
  if (!phaseStartDate || !durationWeeks || durationWeeks < 1) return false
  const days = daysBetweenISO(phaseStartDate, todayISO())
  if (Number.isNaN(days)) return false
  return days >= durationWeeks * 7
}

// ─── Label helpers (Vietnamese) ───────────────────────────────────────────────
export function phaseTypeLabel(type: PhaseType): string {
  return {
    training: 'Tập luyện',
    maintenance: 'Duy trì',
    active_rest: 'Nghỉ tích cực',
  }[type]
}

export function phaseTypeBadgeClass(type: PhaseType): string {
  return {
    training: 'bg-herb/15 text-herb border border-herb/30',
    maintenance: 'bg-slate/15 text-slate border border-slate/30',
    active_rest: 'bg-amber/15 text-amber border border-amber/30',
  }[type]
}

export function programStatusLabel(status: ProgramStatus): string {
  return {
    active: 'Đang hoạt động',
    completed: 'Đã hoàn thành',
    paused: 'Tạm dừng',
  }[status]
}

export function sessionStatusLabel(status: SessionStatus): string {
  return {
    planned: 'Đã lên kế hoạch',
    in_progress: 'Đang tập',
    completed: 'Hoàn thành',
    skipped: 'Bỏ qua',
  }[status]
}

export function exerciseTypeLabel(type: ExerciseType): string {
  return {
    compound: 'Phức hợp',
    machine: 'Máy tập',
    cable: 'Cáp',
    bodyweight: 'Trọng lượng cơ thể',
    dumbbell: 'Tạ đơn',
    resistance_band: 'Dây kháng lực',
  }[type]
}

// ─── Rep-range helpers ────────────────────────────────────────────────────────
export function repRangeLabel(min: number, max: number): string {
  return `${min}–${max}`
}

/** Returns the colour zone label for a rep range (Vietnamese) */
export function repZoneLabel(min: number, max: number): string {
  if (max <= 10) return 'Sức mạnh'
  if (max <= 20) return 'Tăng cơ'
  return 'Sức bền'
}

// ─── Number formatting ────────────────────────────────────────────────────────
export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return '—'
  return `${kg} kg`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
