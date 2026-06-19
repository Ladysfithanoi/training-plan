import type { PhaseExercise } from '@/types'

/**
 * Per-week prescription resolver (migration 011).
 *
 * A meso's exercises are stored in `phase_exercises` with an optional
 * `week_number`:
 *   • null  → BASE row (applies to any week without an override)
 *   • 1..N  → OVERRIDE row for exactly that week
 *
 * For a given week W: if the phase has ANY override rows for W, that week is
 * "customised" and uses ONLY its week-W rows; otherwise it falls back to the
 * base (week_number == null) rows.
 *
 * Tolerant of the column not existing yet (pre-migration): a missing/undefined
 * week_number is treated as base, so every row is base and nothing changes.
 */
export function resolveWeekExercises<T extends Pick<PhaseExercise, 'week_number'>>(
  all: T[],
  week: number,
): T[] {
  const hasOverride = all.some(pe => (pe.week_number ?? null) === week)
  return hasOverride
    ? all.filter(pe => (pe.week_number ?? null) === week)
    : all.filter(pe => (pe.week_number ?? null) === null)
}

/** True when the phase has at least one override row for the given week. */
export function isWeekCustomized<T extends Pick<PhaseExercise, 'week_number'>>(
  all: T[],
  week: number,
): boolean {
  return all.some(pe => (pe.week_number ?? null) === week)
}

/** Only the base (applies-to-all-weeks) rows. */
export function baseExercises<T extends Pick<PhaseExercise, 'week_number'>>(all: T[]): T[] {
  return all.filter(pe => (pe.week_number ?? null) === null)
}
