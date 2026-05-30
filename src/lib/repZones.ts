/**
 * Rep Zone Allocation — Eric Helms' "Muscle and Strength Pyramid" framework
 * ─────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no Supabase, no React.
 *
 * Zone definitions:
 *   Heavy    1–5  reps  (strength / neurological adaptation)
 *   Moderate 6–12 reps  (primary hypertrophy stimulus)
 *   Light    13+  reps  (metabolic / endurance)
 *
 * Helms' allocation targets:
 *   Hypertrophy goal → ≥ 60–70% sets in Moderate zone
 *   Strength goal    → ≥ 60% sets in Heavy zone
 */

// ─── Rep zone types ───────────────────────────────────────────────────────────

export type RepZone = 'heavy' | 'moderate' | 'light'

export interface RepZoneCounts {
  heavy: number
  moderate: number
  light: number
  total: number
}

export interface RepZonePcts {
  heavy: number    // 0–100
  moderate: number
  light: number
}

export type PhaseGoal = 'hypertrophy' | 'strength' | 'mixed'

// ─── Zone classification ──────────────────────────────────────────────────────

/** Classify a single rep count into its zone. */
export function classifyReps(reps: number): RepZone {
  if (reps <= 5) return 'heavy'
  if (reps <= 12) return 'moderate'
  return 'light'
}

/**
 * Classify a prescribed rep range into a zone using the midpoint.
 * Heavy-biased tie-break: if mid is exactly 5.5 (range 1–10), use the lower bound.
 */
export function classifyRepRange(repMin: number, repMax: number): RepZone {
  // If the range spans multiple zones, use the lower bound as the primary intent
  if (repMax <= 5) return 'heavy'
  if (repMin >= 13) return 'light'
  if (repMax <= 12 && repMin >= 6) return 'moderate'
  // Ambiguous ranges: use midpoint
  const mid = (repMin + repMax) / 2
  return classifyReps(Math.round(mid))
}

// ─── Count builders ───────────────────────────────────────────────────────────

/** Build zone counts from logged working sets (using actual_reps). */
export function countLoggedZones(
  sets: Array<{ actual_reps: number | null }>,
): RepZoneCounts {
  const counts: RepZoneCounts = { heavy: 0, moderate: 0, light: 0, total: 0 }
  for (const s of sets) {
    if (s.actual_reps == null || s.actual_reps < 1) continue
    counts[classifyReps(s.actual_reps)]++
    counts.total++
  }
  return counts
}

/**
 * Build zone counts from programmed phase exercises.
 * Each PhaseExercise contributes `target_sets` sets to its zone.
 */
export function countProgrammedZones(
  phaseExercises: Array<{
    target_sets: number
    target_rep_min: number
    target_rep_max: number
  }>,
): RepZoneCounts {
  const counts: RepZoneCounts = { heavy: 0, moderate: 0, light: 0, total: 0 }
  for (const pe of phaseExercises) {
    const zone = classifyRepRange(pe.target_rep_min, pe.target_rep_max)
    counts[zone] += pe.target_sets
    counts.total += pe.target_sets
  }
  return counts
}

// ─── Percentage helper ────────────────────────────────────────────────────────

export function toPcts(counts: RepZoneCounts): RepZonePcts {
  const t = counts.total || 1
  return {
    heavy: Math.round((counts.heavy / t) * 100),
    moderate: Math.round((counts.moderate / t) * 100),
    light: Math.round((counts.light / t) * 100),
  }
}

// ─── Phase goal detection ─────────────────────────────────────────────────────

/**
 * Infer the training goal from the phase name (keyword matching first) and
 * the pre-computed phase category from progression.ts as a fallback.
 */
export function detectPhaseGoal(
  phaseName: string,
  phaseCategory: 'volume' | 'load' | 'peak' | 'other',
): PhaseGoal {
  const n = phaseName.toLowerCase()

  if (
    n.includes('tăng cơ') || n.includes('hypertrophy') || n.includes('phì đại') ||
    n.includes('tích lũy') || n.includes('accumul') || n.includes('volume') ||
    n.includes('khối lượng')
  ) return 'hypertrophy'

  if (
    n.includes('sức mạnh') || n.includes('strength') || n.includes('tăng tải') ||
    n.includes('cường độ') || n.includes('load') || n.includes('intensif') ||
    n.includes('đạt đỉnh') || n.includes('taper') || n.includes('peak')
  ) return 'strength'

  // Positional fallback
  if (phaseCategory === 'volume') return 'hypertrophy'
  if (phaseCategory === 'load' || phaseCategory === 'peak') return 'strength'

  return 'mixed'
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface RepZoneAudit {
  /** Distribution of this week's actually-logged working sets */
  loggedCounts: RepZoneCounts
  loggedPcts: RepZonePcts
  /** Distribution of the programmed plan (phase_exercises × target_sets) */
  programmedCounts: RepZoneCounts
  programmedPcts: RepZonePcts
  /** Which distribution is shown as the primary display */
  primarySource: 'logged' | 'programmed'
  goal: PhaseGoal
  /**
   * Soft advisory tip (null = distribution acceptable or goal unknown).
   * Based on the primary source distribution vs. Helms' targets.
   */
  tip: string | null
  isOnTarget: boolean
}

/**
 * Run the full rep-zone audit.
 *
 * Uses logged counts as the primary source if any sets were logged this week;
 * falls back to programmed counts so coaches see the plan balance.
 */
export function auditRepZones(
  loggedCounts: RepZoneCounts,
  programmedCounts: RepZoneCounts,
  goal: PhaseGoal,
): RepZoneAudit {
  const hasLoggedData = loggedCounts.total > 0
  const primarySource: 'logged' | 'programmed' = hasLoggedData ? 'logged' : 'programmed'
  const primary = hasLoggedData ? loggedCounts : programmedCounts

  const loggedPcts = toPcts(loggedCounts)
  const programmedPcts = toPcts(programmedCounts)
  const primaryPcts = hasLoggedData ? loggedPcts : programmedPcts

  let tip: string | null = null
  let isOnTarget = true

  if (primary.total === 0) {
    // No data at all — no tip
  } else if (goal === 'hypertrophy') {
    if (primaryPcts.moderate < 60) {
      isOnTarget = false
      tip =
        'Eric Helms khuyên dùng: Nên phân bổ 2/3 khối lượng tập vào ngưỡng 6–12 reps để tối ưu tăng cơ. ' +
        `Hiện tại vùng Tăng cơ chỉ đạt ${primaryPcts.moderate}% — tăng số set bài trung bình và giảm bài tập nhẹ (13+ reps) hoặc nặng đơn lẻ.`
    }
  } else if (goal === 'strength') {
    if (primaryPcts.heavy < 60) {
      isOnTarget = false
      tip =
        'Giai đoạn Tăng sức mạnh: Nên phân bổ 2/3 tổng số set vào ngưỡng 1–5 reps để luyện kỹ năng sức mạnh, ' +
        `phần còn lại hỗ trợ tăng cơ. Hiện tại vùng Sức mạnh đạt ${primaryPcts.heavy}% — tăng tỉ trọng set đơn nặng.`
    }
  }

  return {
    loggedCounts,
    loggedPcts,
    programmedCounts,
    programmedPcts,
    primarySource,
    goal,
    tip,
    isOnTarget,
  }
}
