import type { PhaseExerciseRow } from './shared'

// Weekly / per-session volume helpers for the phase exercise builder.

/**
 * Per-session ceiling: more than ~11 working sets for one muscle group in a
 * single workout yields diminishing returns, so the builder flags it.
 */
export const SESSION_SET_CAP = 11

/**
 * Maps a weekly set count to bar/text Tailwind classes and a range label.
 *
 * Thresholds follow Eric Helms / Renaissance Periodization volume landmarks:
 *   < 6   → Sub-MEV  (below Minimum Effective Volume — grey)
 *   6–11  → MEV zone (effective minimum — herb green)
 *  12–19  → MAV zone (Maximum Adaptive Volume — amber)
 *  ≥ 20   → At/above MRV (Maximum Recoverable Volume — danger red)
 */
export function getVolumeColor(sets: number): {
  barClass:   string
  textClass:  string
  rangeLabel: string
} {
  if (sets >= 20) return { barClass: 'bg-danger/65', textClass: 'text-danger',  rangeLabel: '≥ MRV ↑' }
  if (sets >= 12) return { barClass: 'bg-amber',     textClass: 'text-amber',   rangeLabel: 'MAV ✓'   }
  if (sets >= 6)  return { barClass: 'bg-herb',      textClass: 'text-herb',    rangeLabel: 'MEV ✓'   }
  return               { barClass: 'bg-ink/25',    textClass: 'text-ink/40',  rangeLabel: '< MEV'   }
}

/**
 * Formats a fractional set count for display.
 * Whole numbers → plain integer string.  Halves → one decimal (e.g. "4.5").
 */
export function formatSets(sets: number): string {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1)
}

// ── Anatomy mapping engine ────────────────────────────────────────────────────
//
// Maps a (movement-pattern name, exercise name) pair to the anatomical muscle
// groups it recruits, weighted by their role as primary (1.0) or secondary
// driver (0.5) per Eric Helms / RP synergist literature.
//
// PRIMARY driver  (1.0) — muscle is the main target of the movement.
// SECONDARY driver (0.5) — muscle is significantly recruited but not the
//   primary target; coaches should count these at half-credit when evaluating
//   weekly volume against MEV/MAV/MRV thresholds.
//
// The "Push" pattern requires sub-classification because a bench press and an
// overhead press share the same pattern label but recruit completely different
// primary movers.  Exercise-name keywords are used as a heuristic.

const VERTICAL_PUSH_KEYWORDS = [
  'overhead', 'ohp', 'shoulder press', 'military press',
  'arnold', 'push press', 'z press', 'landmine press',
  'pike push', 'standing press', 'seated press',
]

function isPushVertical(exerciseName: string): boolean {
  const lower = exerciseName.toLowerCase()
  return VERTICAL_PUSH_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Returns a Record<muscleName, fraction> for a given exercise.
 * fraction: 1.0 = primary, 0.5 = secondary.
 */
export function getMuscleContributions(
  patternName: string,
  exerciseName: string,
): Record<string, number> {
  const p = patternName.toLowerCase()

  // ── Push ──────────────────────────────────────────────────────────────────
  if (
    p.includes('push') ||
    p.includes('press') ||
    p.includes('bench') ||
    p.includes('chest') ||
    p.includes('fly')
  ) {
    if (
      p.includes('shoulder') ||
      p.includes('overhead') ||
      p.includes('ohp') ||
      isPushVertical(exerciseName)
    ) {
      // Vertical push — OHP / shoulder-press focus
      return {
        'Vai (Delts)':        1.0,
        'Tay sau (Triceps)':  0.5,
      }
    }
    // Horizontal push — bench / chest focus
    return {
      'Ngực (Chest)':           1.0,
      'Vai trước (Ant. Delt)':  0.5,
      'Tay sau (Triceps)':      0.5,
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────────
  if (
    p.includes('pull') ||
    p.includes('row')  ||
    p.includes('chin') ||
    p.includes('lat')  ||
    p.includes('back')
  ) {
    return {
      'Lưng (Back)':           1.0,
      'Tay trước (Biceps)':    0.5,
      'Vai sau (Rear Delt)':   0.5,
    }
  }

  // ── Squat ─────────────────────────────────────────────────────────────────
  if (
    p.includes('squat') ||
    p.includes('leg press') ||
    p.includes('lunge') ||
    p.includes('split squat') ||
    p.includes('bulgarian')
  ) {
    return {
      'Đùi trước (Quads)': 1.0,
      'Mông (Glutes)':      0.5,
    }
  }

  // ── Hinge ─────────────────────────────────────────────────────────────────
  if (
    p.includes('hinge') ||
    p.includes('deadlift') ||
    p.includes('rdl') ||
    p.includes('good morning') ||
    p.includes('hip thrust') ||
    p.includes('glute bridge')
  ) {
    return {
      'Đùi sau / Mông (Ham/Glutes)': 1.0,
      'Lưng dưới (Lower Back)':       1.0,
    }
  }

  // ── Arm isolations (sometimes given their own pattern) ────────────────────
  if (p.includes('bicep') || p.includes('curl')) {
    return { 'Tay trước (Biceps)': 1.0 }
  }
  if (p.includes('tricep') || p.includes('extension') || p.includes('dip')) {
    return { 'Tay sau (Triceps)': 1.0 }
  }

  // ── Shoulder isolation ────────────────────────────────────────────────────
  if (p.includes('shoulder') || p.includes('lateral') || p.includes('delt')) {
    return { 'Vai (Delts)': 1.0 }
  }

  // ── Unrecognised — keep raw pattern name so no volume silently disappears ─
  return { [patternName.length > 0 ? patternName : 'Chưa phân loại']: 1.0 }
}

/**
 * Fractional set credit per anatomical muscle group for a list of prescription
 * rows (primary driver 1.0×, secondary driver 0.5× — Eric Helms / RP), rounded
 * to one decimal and sorted from most to least volume.
 *
 * `setMultiplier` scales each row's target_sets: 1 for a single session or a
 * split-configured week, frequency_per_week when the phase has no split.
 */
export function sumMuscleVolume(rows: PhaseExerciseRow[], setMultiplier: number) {
  const map = new Map<string, number>()
  for (const pe of rows) {
    const patternName  = pe.exercise.movement_pattern?.name ?? ''
    const exerciseName = pe.exercise.name ?? ''
    const sessionSets  = (pe.target_sets ?? 0) * setMultiplier
    const contributions = getMuscleContributions(patternName, exerciseName)
    for (const [muscle, fraction] of Object.entries(contributions)) {
      map.set(muscle, (map.get(muscle) ?? 0) + sessionSets * fraction)
    }
  }
  return Array.from(map.entries())
    .map(([name, sets]) => ({ name, sets: Math.round(sets * 10) / 10 }))
    .sort((a, b) => b.sets - a.sets)
}
