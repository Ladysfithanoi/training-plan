/**
 * Volume Load engine — progressive overload tracking
 * ──────────────────────────────────────────────────────────────────────────────
 * Volume Load (VL) = Reps × Weight (kg)  — per set
 * Weekly VL      = Σ VL across all working sets in a calendar week
 *
 * This is the primary quantitative measure of progressive overload in
 * resistance training.  A consistent upward trend in weekly VL confirms that
 * the athlete is overloading the system week-over-week regardless of whether
 * that comes from more sets, more reps, or heavier load.
 *
 * Definitions used throughout:
 *   Working set  — non-warmup set with at least reps recorded
 *   Volume Load  — reps × weight_kg for a single working set (0 for bodyweight)
 *
 * All functions are pure (no I/O, no React, no Supabase).
 */

// ─── Input shapes (minimal — callers cast their wider types to these) ─────────

export interface SetForVolume {
  actual_reps: number | null
  weight_kg:   number | null
  is_warmup:   boolean
}

export interface SetForVolumeWithPattern extends SetForVolume {
  exercise: {
    movement_pattern: { name: string } | null
  } | null
}

export interface SessionForVolume {
  session_date: string
  /** 'planned' and 'skipped' sessions are excluded from all calculations */
  status: string
  sets: SetForVolume[]
}

export interface SessionForVolumeWithPattern {
  session_date: string
  status: string
  sets: SetForVolumeWithPattern[]
}

// ─── Output shapes ────────────────────────────────────────────────────────────

/**
 * One data point per calendar week for the volume progression line chart.
 * Weeks are keyed by the ISO date of their Monday.
 */
export interface WeeklyVolumePoint {
  /** "Tuần 1", "Tuần 2", … counted from oldest week in the returned window */
  weekLabel: string
  /** ISO date string for the Monday of this week (YYYY-MM-DD) */
  weekStart: string
  /** Sum of actual_reps × weight_kg for all working sets this week (kg) */
  totalVolumeKg: number
  /** Count of non-warmup sets that have at least reps recorded */
  workingSets: number
  /** Number of sessions (completed / in-progress) that contributed */
  sessionsCount: number
}

/**
 * Working-set counts per movement pattern for a single calendar week.
 * Used to display "how many sets of Squat / Bench / Row this week" breakdowns.
 */
export interface WeeklyPatternPoint {
  weekLabel: string
  weekStart: string
  /** movement pattern name → working set count for that week */
  patternSets: Record<string, number>
}

// ─── Set-level helpers ────────────────────────────────────────────────────────

/**
 * Volume load for a single set: actual_reps × weight_kg.
 * Returns 0 for warmup sets, sets with missing reps, or bodyweight-only sets
 * (weight_kg = null).  Never negative.
 */
export function computeSetVolume(set: SetForVolume): number {
  if (set.is_warmup)           return 0
  if (set.actual_reps == null) return 0
  if (set.weight_kg == null)   return 0
  return set.actual_reps * set.weight_kg
}

/**
 * Total volume load across an array of sets (session-level).
 * Warmup sets and bodyweight-only sets contribute 0.
 */
export function computeSessionVolume(sets: SetForVolume[]): number {
  return sets.reduce((sum, s) => sum + computeSetVolume(s), 0)
}

/**
 * Count of working (non-warmup) sets with at least reps recorded.
 * Used for weekly set-count tracking independent of weight.
 */
export function computeSessionWorkingSets(sets: SetForVolume[]): number {
  return sets.filter(s => !s.is_warmup && s.actual_reps != null).length
}

// ─── Week-grouping helpers ─────────────────────────────────────────────────────

/**
 * Return the ISO date string (YYYY-MM-DD) for the Monday of the week
 * containing `dateStr`.  Uses UTC to avoid DST-induced off-by-one shifts.
 */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getUTCDay()               // 0 = Sun, 1 = Mon, … 6 = Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + offsetToMonday)
  return d.toISOString().slice(0, 10)
}

// ─── Weekly aggregation ───────────────────────────────────────────────────────

/**
 * Group sessions into calendar weeks and compute Volume Load + working-set
 * counts per week.
 *
 * Weeks are returned in **ascending** chronological order (oldest first) so
 * they map naturally to a left→right chart axis.
 *
 * @param sessions  Raw session array — any status; non-contributing statuses
 *                  ('planned', 'skipped') are filtered out internally.
 * @param maxWeeks  Return at most this many most-recent weeks (default 12).
 *                  Older weeks beyond the window are silently dropped.
 */
export function computeWeeklyVolumes(
  sessions: SessionForVolume[],
  maxWeeks = 12,
): WeeklyVolumePoint[] {
  type Acc = { totalVolumeKg: number; workingSets: number; sessionsCount: number }
  const weekMap = new Map<string, Acc>()

  for (const session of sessions) {
    if (session.status === 'planned' || session.status === 'skipped') continue

    const weekStart = getWeekStart(session.session_date)
    const acc: Acc = weekMap.get(weekStart) ?? { totalVolumeKg: 0, workingSets: 0, sessionsCount: 0 }

    acc.totalVolumeKg += computeSessionVolume(session.sets)
    acc.workingSets   += computeSessionWorkingSets(session.sets)
    acc.sessionsCount += 1
    weekMap.set(weekStart, acc)
  }

  if (weekMap.size === 0) return []

  const sorted = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))  // ascending date order
    .slice(-maxWeeks)                         // most-recent N weeks only

  return sorted.map(([weekStart, acc], index) => ({
    weekLabel:     `Tuần ${index + 1}`,
    weekStart,
    totalVolumeKg: Math.round(acc.totalVolumeKg),
    workingSets:   acc.workingSets,
    sessionsCount: acc.sessionsCount,
  }))
}

/**
 * Group working sets per movement pattern per calendar week.
 * Useful for "how many Squat / Bench / Row sets did I do this week?" views.
 *
 * Returns weeks in ascending chronological order, same window logic as
 * `computeWeeklyVolumes`.
 */
export function computeWeeklyPatternSets(
  sessions: SessionForVolumeWithPattern[],
  maxWeeks = 12,
): WeeklyPatternPoint[] {
  const weekMap = new Map<string, Record<string, number>>()

  for (const session of sessions) {
    if (session.status === 'planned' || session.status === 'skipped') continue

    const weekStart = getWeekStart(session.session_date)
    const patternAcc = weekMap.get(weekStart) ?? {}

    for (const set of session.sets) {
      if (set.is_warmup || set.actual_reps == null) continue
      const name = set.exercise?.movement_pattern?.name ?? 'Khác'
      patternAcc[name] = (patternAcc[name] ?? 0) + 1
    }

    weekMap.set(weekStart, patternAcc)
  }

  const sorted = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxWeeks)

  return sorted.map(([weekStart, patternSets], index) => ({
    weekLabel: `Tuần ${index + 1}`,
    weekStart,
    patternSets,
  }))
}

// ─── Aggregate helpers ────────────────────────────────────────────────────────

/**
 * Compute lifetime totals across the entire session history window.
 * Used for the summary stats row above the chart.
 */
export function computeAllTimeSummary(data: WeeklyVolumePoint[]): {
  totalVolumeKg: number
  totalWorkingSets: number
  totalSessions: number
  avgVolumePerWeek: number
  avgVolumePerSession: number
} {
  const totalVolumeKg   = data.reduce((s, d) => s + d.totalVolumeKg, 0)
  const totalWorkingSets = data.reduce((s, d) => s + d.workingSets, 0)
  const totalSessions    = data.reduce((s, d) => s + d.sessionsCount, 0)

  return {
    totalVolumeKg,
    totalWorkingSets,
    totalSessions,
    avgVolumePerWeek:    data.length > 0 ? Math.round(totalVolumeKg / data.length) : 0,
    avgVolumePerSession: totalSessions > 0 ? Math.round(totalVolumeKg / totalSessions) : 0,
  }
}

/**
 * Compact number formatter for chart axis labels.
 * 1 500 → "1.5k"  |  999 → "999"  |  0 → "0"
 */
export function fmtVol(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg % 1000 === 0 ? 0 : 1)}k`
  return String(kg)
}
