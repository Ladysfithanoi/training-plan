/**
 * Training Split Configuration — Eric Helms' Practical Programming framework
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no Supabase, no React.
 *
 * Split recommendations based on weekly training frequency:
 *   2–3 sessions/week → Fullbody        (Toàn thân)
 *   4   sessions/week → Upper/Lower     (Trên/Dưới)
 *   5–6 sessions/week → Push/Pull/Legs  (PPL)
 *
 * Movement pattern filter keywords are matched case-insensitively
 * against movement_patterns.name from the DB seed data:
 *   'Squat' | 'Hinge' | 'Push' | 'Pull' | 'Carry' | 'Isolation'
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SplitType = 'fullbody' | 'upper_lower' | 'ppl'

export type DayType = 'fullbody' | 'upper' | 'lower' | 'push' | 'pull' | 'legs'

/** A single coach-editable day slot within a phase split. */
export interface SplitDay {
  /** Stable client-generated UUID — stored in phases.split_days JSONB. */
  id: string
  /** Movement category determines the default pattern filter. */
  type: DayType
  /** Editable Vietnamese label (e.g. "Đẩy A", "Trên 1"). */
  label: string
}

export interface TrainingSplitConfig {
  type: SplitType
  /** Vietnamese display label */
  label: string
  description: string
  /** Recommended weekly session range [min, max] */
  frequencyRange: [number, number]
  /** Default day slots generated when this split is first selected */
  defaultDays: Omit<SplitDay, 'id'>[]
}

// ─── Split definitions ────────────────────────────────────────────────────────

export const SPLIT_CONFIGS: Record<SplitType, TrainingSplitConfig> = {
  fullbody: {
    type: 'fullbody',
    label: 'Toàn thân (Fullbody)',
    description: 'Mỗi buổi tập tất cả nhóm cơ chính — lý tưởng cho 2–3 buổi/tuần',
    frequencyRange: [2, 3],
    defaultDays: [
      { type: 'fullbody', label: 'Toàn thân' },
    ],
  },

  upper_lower: {
    type: 'upper_lower',
    label: 'Trên / Dưới (Upper/Lower)',
    description: 'Phân chia thân trên và thân dưới — lý tưởng cho 4 buổi/tuần',
    frequencyRange: [4, 4],
    defaultDays: [
      { type: 'upper', label: 'Thân trên' },
      { type: 'lower', label: 'Thân dưới' },
    ],
  },

  ppl: {
    type: 'ppl',
    label: 'Đẩy / Kéo / Chân (PPL)',
    description: 'Push, Pull, Legs — lý tưởng cho 5–6 buổi/tuần (2 vòng/tuần)',
    frequencyRange: [5, 6],
    defaultDays: [
      { type: 'push',  label: 'Đẩy (Push)' },
      { type: 'pull',  label: 'Kéo (Pull)' },
      { type: 'legs',  label: 'Chân (Legs)' },
    ],
  },
}

// ─── Movement pattern names allowed per day type ──────────────────────────────
// These match movement_patterns.name values from seed.sql exactly (case-insensitive).
// An empty array means "show all patterns" (no filter).

export const PATTERN_NAMES_BY_DAY: Record<DayType, string[]> = {
  fullbody: [],                                         // all patterns
  upper:    ['Push', 'Pull', 'Carry', 'Isolation'],
  lower:    ['Squat', 'Hinge', 'Isolation'],
  push:     ['Push', 'Isolation'],
  pull:     ['Pull', 'Isolation'],
  legs:     ['Squat', 'Hinge', 'Isolation'],
}

/** Vietnamese label for each day type. */
export const DAY_TYPE_LABELS: Record<DayType, string> = {
  fullbody: 'Toàn thân',
  upper:    'Thân trên',
  lower:    'Thân dưới',
  push:     'Đẩy (Push)',
  pull:     'Kéo (Pull)',
  legs:     'Chân (Legs)',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recommend a split type based on weekly training frequency.
 * Helms: 2-3 → fullbody, 4 → upper/lower, 5-6 → PPL
 */
export function recommendSplit(frequencyPerWeek: number): SplitType {
  if (frequencyPerWeek <= 3) return 'fullbody'
  if (frequencyPerWeek === 4) return 'upper_lower'
  return 'ppl'
}

/** Get the configuration for a given split type. */
export function getSplitConfig(type: SplitType): TrainingSplitConfig {
  return SPLIT_CONFIGS[type]
}

/**
 * Generate default day slots for a newly selected split type.
 * Each slot gets a fresh UUID so they can be independently renamed/deleted.
 */
export function generateDefaultDays(type: SplitType): SplitDay[] {
  const config = SPLIT_CONFIGS[type]
  return config.defaultDays.map(d => ({
    ...d,
    id: crypto.randomUUID(),
  }))
}

/**
 * Filter movement patterns by the pattern names allowed for a given day type.
 * Returns all patterns when dayType is 'fullbody' or PATTERN_NAMES_BY_DAY is empty.
 */
export function filterPatternsByDay<T extends { name: string }>(
  patterns: T[],
  dayType: DayType,
): T[] {
  const allowed = PATTERN_NAMES_BY_DAY[dayType]
  if (!allowed || allowed.length === 0) return patterns
  const lc = allowed.map(n => n.toLowerCase())
  return patterns.filter(p => lc.includes(p.name.toLowerCase()))
}

/** Day types available to add for a given split type. */
export function availableDayTypes(splitType: SplitType): DayType[] {
  const map: Record<SplitType, DayType[]> = {
    fullbody:    ['fullbody'],
    upper_lower: ['upper', 'lower'],
    ppl:         ['push', 'pull', 'legs'],
  }
  return map[splitType]
}

/** Select-dropdown options for split type. */
export const SPLIT_TYPE_OPTIONS = Object.values(SPLIT_CONFIGS).map(s => ({
  value: s.type as string,
  label: s.label,
}))
