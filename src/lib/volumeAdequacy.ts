/**
 * Weekly Volume Adequacy Assesser — Eric Helms' Practical Effective Dose framework
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no Supabase, no React.
 *
 * Helms' weekly set targets per muscle group:
 *   < 10 sets  → Insufficient (below Minimum Effective Volume)
 *   10–20 sets → Optimal (Practical Effective Dose window)
 *   > 20 sets  → Excessive (risk of recovery issues / junk volume)
 *
 * Fractional set algorithm:
 *   muscle_groups[0] = primary mover  → target_sets × 1.0
 *   muscle_groups[1+] = synergists     → target_sets × 0.5
 */

import { classifyRepRange } from './repZones'

// ─── Constants ────────────────────────────────────────────────────────────────
export const MEV = 10  // Minimum Effective Volume (sets / muscle / week)
export const MAV = 20  // Maximum Adaptive Volume  (sets / muscle / week)

// ─── Vietnamese muscle group names ───────────────────────────────────────────
export const MUSCLE_VI: Record<string, string> = {
  quads:             'Đùi trước',
  glutes:            'Mông',
  adductors:         'Cơ khép đùi',
  core:              'Cốt lõi',
  hamstrings:        'Đùi sau',
  erectors:          'Lưng dưới',
  chest:             'Ngực',
  front_delt:        'Vai trước',
  lateral_delt:      'Vai ngang',
  rear_delt:         'Vai sau',
  triceps:           'Tam đầu',
  biceps:            'Nhị đầu',
  brachialis:        'Cơ cánh tay',
  lats:              'Lưng rộng',
  mid_back:          'Lưng giữa',
  external_rotators: 'Cơ xoay ngoài',
  calves:            'Bắp chân',
  abs:               'Bụng',
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type VolumeStatus = 'insufficient' | 'optimal' | 'excessive'

export interface MuscleZoneBreakdown {
  heavy: number
  moderate: number
  light: number
  total: number
}

export interface MuscleGroupVolume {
  muscle: string           // slug key, e.g. "quads"
  muscleVi: string         // Vietnamese display name
  /** Fractional sets from the active phase plan (1.0 primary / 0.5 secondary) */
  programmedSets: number
  /** Fractional sets logged this week (0 when no sets recorded yet) */
  loggedSets: number
  /** Rep zone breakdown for this muscle's programmed sets */
  programmedZones: MuscleZoneBreakdown
  status: VolumeStatus
  /** How many sets below MEV (0 when ≥ MEV) */
  deficit: number
  /** How many sets above MAV (0 when ≤ MAV) */
  excess: number
  /**
   * Percentage of this muscle's programmed sets that fall in the 6–12 rep zone.
   * Used for the hypertrophy cross-check.
   */
  moderatePct: number
}

export interface VolumeAdequacyResult {
  muscleVolumes: MuscleGroupVolume[]
  insufficientCount: number
  optimalCount: number
  excessiveCount: number
}

// ─── Phase exercise input shape ───────────────────────────────────────────────
export interface PhaseExerciseForAudit {
  target_sets: number
  target_rep_min: number
  target_rep_max: number
  exercise: { muscle_groups: string[] } | null
}

// ─── Logged-set input shape ───────────────────────────────────────────────────
export interface LoggedExerciseForAudit {
  muscle_groups: string[]
  /** Number of working sets performed this week for this exercise */
  setCount: number
}

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute fractional weekly set counts per muscle group from the active phase
 * plan and optionally from this week's logged working sets.
 *
 * Sort order: insufficient → optimal → excessive, then alphabetical by
 * Vietnamese name within each group.
 */
export function computeMuscleVolumes(
  phaseExercises: PhaseExerciseForAudit[],
  loggedByExercise: LoggedExerciseForAudit[] = [],
): VolumeAdequacyResult {
  // ── Accumulate programmed volume ──────────────────────────────────────────
  const progMap: Record<string, MuscleZoneBreakdown> = {}

  for (const pe of phaseExercises) {
    const muscles = pe.exercise?.muscle_groups ?? []
    const zone = classifyRepRange(pe.target_rep_min, pe.target_rep_max)

    for (let i = 0; i < muscles.length; i++) {
      const m = muscles[i]
      const fraction = i === 0 ? 1.0 : 0.5
      const contribution = pe.target_sets * fraction

      if (!progMap[m]) progMap[m] = { heavy: 0, moderate: 0, light: 0, total: 0 }
      progMap[m][zone] += contribution
      progMap[m].total += contribution
    }
  }

  // ── Accumulate logged volume ───────────────────────────────────────────────
  const logMap: Record<string, number> = {}

  for (const item of loggedByExercise) {
    for (let i = 0; i < item.muscle_groups.length; i++) {
      const m = item.muscle_groups[i]
      const fraction = i === 0 ? 1.0 : 0.5
      logMap[m] = (logMap[m] ?? 0) + item.setCount * fraction
    }
  }

  // ── Build result entries ───────────────────────────────────────────────────
  const allMuscles = new Set([...Object.keys(progMap), ...Object.keys(logMap)])
  const muscleVolumes: MuscleGroupVolume[] = []

  for (const muscle of allMuscles) {
    const prog = progMap[muscle] ?? { heavy: 0, moderate: 0, light: 0, total: 0 }
    const logged = logMap[muscle] ?? 0
    const total = prog.total

    let status: VolumeStatus
    if (total < MEV)       status = 'insufficient'
    else if (total > MAV)  status = 'excessive'
    else                   status = 'optimal'

    const moderatePct = total > 0 ? Math.round((prog.moderate / total) * 100) : 0

    muscleVolumes.push({
      muscle,
      muscleVi: MUSCLE_VI[muscle] ?? muscle,
      programmedSets: round1(total),
      loggedSets: round1(logged),
      programmedZones: {
        heavy:    round1(prog.heavy),
        moderate: round1(prog.moderate),
        light:    round1(prog.light),
        total:    round1(total),
      },
      status,
      deficit: Math.max(0, round1(MEV - total)),
      excess:  Math.max(0, round1(total - MAV)),
      moderatePct,
    })
  }

  // Sort: insufficient first, then optimal, then excessive; alpha within group
  const ORDER: Record<VolumeStatus, number> = { insufficient: 0, optimal: 1, excessive: 2 }
  muscleVolumes.sort((a, b) => {
    const sd = ORDER[a.status] - ORDER[b.status]
    return sd !== 0 ? sd : a.muscleVi.localeCompare(b.muscleVi, 'vi')
  })

  return {
    muscleVolumes,
    insufficientCount: muscleVolumes.filter(m => m.status === 'insufficient').length,
    optimalCount:      muscleVolumes.filter(m => m.status === 'optimal').length,
    excessiveCount:    muscleVolumes.filter(m => m.status === 'excessive').length,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Generate a Vietnamese status label and colour key for a muscle group row. */
export function volumeStatusLabel(mv: MuscleGroupVolume): {
  label: string
  colorKey: 'danger' | 'herb' | 'amber'
} {
  if (mv.status === 'insufficient') {
    return {
      label: `Thiếu ${mv.deficit} set`,
      colorKey: 'danger',
    }
  }
  if (mv.status === 'excessive') {
    return {
      label: `Vượt ${mv.excess} set`,
      colorKey: 'amber',
    }
  }
  return {
    label: 'Đạt chuẩn (Đủ)',
    colorKey: 'herb',
  }
}
