import type { PhaseType, ProgramStatus, SessionStatus, ExerciseType } from '@/types'

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

/** Returns the week number (1-based) within a phase */
export function currentWeekInPhase(phaseStartDate: string): number {
  const start = new Date(phaseStartDate)
  const today = new Date()
  const days = diffDays(start, today)
  return Math.max(1, Math.floor(days / 7) + 1)
}

/** True if the phase has exceeded its duration */
export function isPhaseExpired(phaseStartDate: string, durationWeeks: number): boolean {
  const end = addWeeks(new Date(phaseStartDate), durationWeeks)
  return new Date() > end
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
