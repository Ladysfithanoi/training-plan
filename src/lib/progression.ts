/**
 * Progression Algorithms — The Muscle and Strength Pyramid
 * ─────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no Supabase, no React.
 * Import these in both API routes and client components.
 */

import type { ExerciseType, DoubleProgressionHint, PhaseContext, PhasicSetTarget } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// 1. Running Estimated 1RM  (Brzycki formula with RIR adjustment)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the estimated 1-rep max using the Brzycki formula extended with RIR.
 *
 *   e1RM = load / (1.0278 − 0.0278 × effectiveReps)
 *   effectiveReps = actual_reps + rir  (total reps-to-failure equivalent)
 *
 * Valid for effectiveReps 1–12.  Returns null for warmup-level inputs or when
 * the denominator is ≤ 0 (would produce infinite/negative values).
 */
export function computeE1RM(
  weightKg: number,
  actualReps: number,
  rir: number,
): number | null {
  if (weightKg <= 0 || actualReps < 1) return null
  const effectiveReps = actualReps + rir
  if (effectiveReps < 1 || effectiveReps > 12) return null
  const denom = 1.0278 - 0.0278 * effectiveReps
  if (denom <= 0) return null
  return Math.round((weightKg / denom) * 10) / 10  // 1 decimal place
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Autoregulated Double Progression  (isolation / machine / cable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether the logged set should trigger a weight-increase recommendation
 * for the next session.
 *
 * Rules (per "The Muscle and Strength Pyramid"):
 *  • Compound exercises use phasic progression, not double progression → skip.
 *  • Only the FIRST working set acts as the indicator (setNumber === 1).
 *  • actualReps must reach the upper rep boundary (targetRepMax).
 *  • rir must be ≤ rirTarget, confirming the set was genuinely hard enough.
 *  • Recommended increment: ~4.5%, rounded to the nearest 0.5 kg.
 */
export function checkDoubleProgression(params: {
  setNumber: number
  actualReps: number
  targetRepMax: number
  rir: number | null
  rirTarget: number
  weightKg: number | null
  exerciseType: ExerciseType
}): DoubleProgressionHint | null {
  const { setNumber, actualReps, targetRepMax, rir, rirTarget, weightKg, exerciseType } = params

  // Compounds use phasic logic, not double progression
  if (exerciseType === 'compound') return null

  // Only the first working set is the progression indicator
  if (setNumber !== 1) return null

  const shouldIncrease =
    actualReps >= targetRepMax &&
    rir != null &&
    rir <= rirTarget

  let suggestedWeightKg: number | null = null
  if (shouldIncrease && weightKg != null && weightKg > 0) {
    const rawIncrease = weightKg * 0.045                        // +4.5%
    const rounded = Math.max(Math.round(rawIncrease / 0.5) * 0.5, 0.5) // ≥0.5 kg
    suggestedWeightKg = Math.round((weightKg + rounded) * 4) / 4        // nearest 0.25 kg
  }

  return {
    type: 'double_progression',
    shouldIncrease,
    suggestedWeightKg,
    currentWeightKg: weightKg,
    targetRepMax,
    actualReps,
    rir,
    rirTarget,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Phase Classification  (Volume → Load → Peak)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the current phase into a progression category.
 *
 * Keyword matching takes priority over positional fallback, allowing coach
 * creativity in phase naming while still auto-routing to the right prescription.
 */
export function classifyPhaseCategory(
  phaseOrder: number,
  totalPhases: number,
  phaseName?: string,
): PhaseContext['category'] {
  // ── Keyword match (priority) ───────────────────────────────────────────────
  if (phaseName) {
    const n = phaseName.toLowerCase()
    if (
      n.includes('peak') || n.includes('taper') || n.includes('đạt đỉnh') ||
      n.includes('thi đấu') || n.includes('competition')
    ) return 'peak'

    if (
      n.includes('load') || n.includes('strength') || n.includes('intensif') ||
      n.includes('cường độ') || n.includes('tăng tải') || n.includes('sức mạnh')
    ) return 'load'

    if (
      n.includes('volume') || n.includes('accumul') || n.includes('hypertrophy') ||
      n.includes('tích lũy') || n.includes('khối lượng') || n.includes('phì đại')
    ) return 'volume'
  }

  // ── Positional fallback for 3-phase blocks ─────────────────────────────────
  if (totalPhases >= 3) {
    if (phaseOrder >= totalPhases) return 'peak'
    if (phaseOrder === totalPhases - 1) return 'load'
    return 'volume'
  }

  // Single or two-phase blocks
  if (totalPhases === 2) {
    return phaseOrder === 1 ? 'volume' : 'load'
  }

  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Phasic Linear Progression Targets  (compound / main lifts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an ordered array of set prescriptions for the compound main lift,
 * tailored to the current phase category AND the week within that phase.
 *
 * Load phase: back-off reps decrease linearly from 5 → 3 across phase weeks
 * so athletes progressively expose themselves to heavier singles.
 */
export function getPhasicTargets(
  category: PhaseContext['category'],
  weekInPhase: number,
  durationWeeks: number,
): PhasicSetTarget[] {
  if (category === 'volume') {
    return [
      {
        label: '1 set đơn nặng',
        sets: 1,
        repMin: 1,
        repMax: 1,
        rpeMin: 5,
        rpeMax: 8,
        isBackOff: false,
        note: 'Theo dõi 1RM ước tính — không đẩy đến kiệt sức',
      },
    ]
  }

  if (category === 'load') {
    // Back-off reps: 5 in week 1, 3 in final week — linear interpolation
    const week = Math.max(1, weekInPhase)
    const totalWeeks = Math.max(durationWeeks, 1)
    const progress = totalWeeks > 1 ? (week - 1) / (totalWeeks - 1) : 0
    const backOffReps = Math.max(3, Math.round(5 - progress * 2))  // 5 → 3

    return [
      {
        label: 'Set đơn nặng',
        sets: 1,
        repMin: 1,
        repMax: 1,
        rpeMin: 6,
        rpeMax: 9,
        isBackOff: false,
        note: 'RIR 1–4 — thách thức nhưng còn kiểm soát',
      },
      {
        label: `${backOffReps} reps nhịp (×2)`,
        sets: 2,
        repMin: backOffReps,
        repMax: backOffReps,
        rpeMin: 6,
        rpeMax: 8,
        isBackOff: true,
        note: 'Giảm 10–15% tạ so với set đơn nặng',
      },
    ]
  }

  if (category === 'peak') {
    return [
      {
        label: 'Set đơn cực nặng',
        sets: 1,
        repMin: 1,
        repMax: 1,
        rpeMin: 8,
        rpeMax: 10,
        isBackOff: false,
        note: 'Kiểm tra lực — đẩy gần tối đa',
      },
      {
        label: '1 rep nhịp (×1)',
        sets: 1,
        repMin: 1,
        repMax: 2,
        rpeMin: 7,
        rpeMax: 8,
        isBackOff: true,
        note: 'Không có bài phụ trong giai đoạn đỉnh',
      },
    ]
  }

  return []
}
