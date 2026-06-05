// ─── Domain enums ────────────────────────────────────────────────────────────
//   admin — super user; coach (HLV) — staff with a private roster; user — student.
export type UserRole = 'admin' | 'coach' | 'user'

// ─── Post-workout autoregulation survey ──────────────────────────────────────
/** Did the athlete beat, meet, or miss their rep target? */
export type SurveyPerformance = 'exceed' | 'meet' | 'miss'
/** How did the actual effort feel relative to the RIR target? */
export type SurveyRirFeel = 'easier' | 'on_target' | 'too_hard'
/** Joint and muscle recovery status entering this session */
export type SurveyRecovery = 'great' | 'normal' | 'sore'

export interface SessionSurvey {
  performance: SurveyPerformance
  rir_feel: SurveyRirFeel
  recovery: SurveyRecovery
}
export type PhaseType = 'training' | 'maintenance' | 'active_rest'

/**
 * Training stimulus character for a phase/mesocycle (migration 006).
 *   'standard' — normal progressive-overload week
 *   'deload'   — planned fatigue-management week (~50% volume/intensity)
 *   'taper'    — pre-competition volume reduction, intensity maintained
 *   'peaking'  — maximal-strength testing / near-maximal load accumulation
 */
export type WeekType = 'standard' | 'deload' | 'taper' | 'peaking'
export type ProgramStatus = 'active' | 'completed' | 'paused'
export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped'
export type ExerciseType = 'compound' | 'machine' | 'cable' | 'bodyweight' | 'dumbbell'

// ─── Rep Range ───────────────────────────────────────────────────────────────
export interface RepRange {
  min: number
  max: number
  /** Targets a specific exercise type (e.g. cable/machine only in the high zone) */
  exercise_type?: ExerciseType
  label?: string
}

// ─── Profiles ────────────────────────────────────────────────────────────────
export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  created_at: string
  /** Coach-generated shareable token — null until first generated (migration 003) */
  magic_token?: string | null
  /** Which coach created this student — null = owned by admin (migration 007) */
  created_by?: string | null
}

// ─── Movement Patterns ───────────────────────────────────────────────────────
export interface MovementPattern {
  id: string
  name: string
  description: string | null
  created_at: string
}

// ─── Exercises ───────────────────────────────────────────────────────────────
export interface Exercise {
  id: string
  name: string
  movement_pattern_id: string | null
  movement_pattern?: MovementPattern
  type: ExerciseType
  optimal_rep_min: number
  optimal_rep_max: number
  description: string | null
  muscle_groups: string[]
  /** Which staff member authored this exercise — null = admin (migration 007) */
  created_by?: string | null
  created_at: string
}

// ─── Phase / Mesocycle ───────────────────────────────────────────────────────
export interface Phase {
  id: string
  block_id: string
  name: string
  phase_order: number
  phase_type: PhaseType
  duration_weeks: number

  /** Sessions per week per muscle group */
  frequency_per_week: number

  /** Expanding rep zone array: [{min:5,max:10}, {min:10,max:20}, …] */
  rep_ranges: RepRange[]

  // ── Maintenance-specific ─────────────────────────────────────────────────
  /** Fraction of Meso-2 weekly sets (e.g. 0.333 = 1/3) */
  target_set_reduction_factor: number
  /** True when this maintenance phase ends with a deload week */
  includes_deload: boolean

  // ── Active-Rest-specific ─────────────────────────────────────────────────
  /** Maximum Reps In Reserve allowed (default 10) */
  max_rir: number | null
  /** Max weight as fraction of working weight (e.g. 0.5 = <50%) */
  max_weight_percent: number | null

  // ── Training split configuration (migration 002) ─────────────────────────
  /** Training split type; null when not configured yet. */
  split_type: 'fullbody' | 'upper_lower' | 'ppl' | null
  /**
   * Coach-editable day-slot list stored as JSONB.
   * Each entry: { id: string, type: DayType, label: string }
   * Empty array = no custom days defined; use split_type defaults.
   */
  split_days: Array<{ id: string; type: string; label: string }>

  /**
   * Training stimulus character for the phase/mesocycle (migration 006).
   * Drives the execution context shown to the athlete at log time.
   */
  week_type: WeekType

  created_at: string
}

// ─── Phase Exercise Configuration ─────────────────────────────────────────────
export interface PhaseExercise {
  id: string
  phase_id: string
  exercise_id: string
  target_sets: number
  target_rep_min: number
  target_rep_max: number
  rir_target: number
  notes: string | null
  day_of_week: number[] | null

  // ── Day assignment (migration 005) ───────────────────────────────────────────
  /**
   * UUID string matching a SplitDay.id stored in phases.split_days JSONB.
   * Null = exercise is not pinned to a specific training day.
   */
  day_id: string | null

  // ── Sequence ordering (migration 005) ────────────────────────────────────────
  /**
   * Coach-assigned sequence tag rendered in the "STT" column.
   * Horizontal (standalone): A, B, C, D …
   * Vertical (superset/pair): A1, A2, B1, B2, B3 …
   */
  order_label: string | null

  /**
   * How sets are executed across the training day microcycle.
   *   'horizontal' → complete all sets of exercise A before moving to B
   *   'vertical'   → rotate between exercises in the same superset group
   */
  loading_style: 'horizontal' | 'vertical' | null

  // ── AMRAP & load prescription (migration 006) ─────────────────────────────────
  /**
   * When true, the final working set is executed as AMRAP (As Many Reps As
   * Possible) to RPE 10 / technical failure — an Eric Helms hypertrophy
   * technique for tracking real-world capacity within a mesocycle.
   */
  is_amrap: boolean

  /**
   * Explicit load prescription as percentage of the athlete's 1-Rep Max.
   * Non-null only in strength/peaking phases where load, not rep volume,
   * is the primary stimulus (e.g. 85%, 90%, 95% of 1RM).
   * Null = load prescribed by RPE/RIR (standard hypertrophy approach).
   */
  target_percentage_1rm: number | null

  exercise?: Exercise
}

// ─── Training Block (Macro) ──────────────────────────────────────────────────
export interface TrainingBlock {
  id: string
  name: string
  description: string | null
  total_mesocycles: number
  created_by: string | null
  phases?: Phase[]
  created_at: string
}

// ─── User Program Assignment ─────────────────────────────────────────────────
export interface UserProgram {
  id: string
  user_id: string
  block_id: string
  current_phase_id: string | null
  /** When the overall program started */
  start_date: string
  /** When the current phase started */
  phase_start_date: string | null
  status: ProgramStatus
  assigned_by: string | null
  assigned_at: string
  notes: string | null
  block?: TrainingBlock
  current_phase?: Phase
  user?: Profile
}

// ─── Workout Session ─────────────────────────────────────────────────────────
export interface WorkoutSession {
  id: string
  user_id: string
  phase_id: string | null
  user_program_id: string | null
  session_date: string
  status: SessionStatus
  duration_minutes: number | null
  overall_rir: number | null
  notes: string | null
  // Post-workout autoregulation survey (migration 004)
  survey_performance?: SurveyPerformance | null
  survey_rir_feel?: SurveyRirFeel | null
  survey_recovery?: SurveyRecovery | null
  /** Decision-tree recommendation. Requires migration 004 to be deployed. */
  next_week_suggestion?: string | null
  created_at: string
  sets?: WorkoutSet[]
  phase?: Phase
}

// ─── Workout Set (logged) ────────────────────────────────────────────────────
export interface WorkoutSet {
  id: string
  session_id: string
  exercise_id: string
  set_number: number
  target_reps: number | null
  actual_reps: number | null
  weight_kg: number | null
  /** Reps In Reserve */
  rir: number | null
  /** Rate of Perceived Exertion (10 − RIR) */
  rpe: number | null
  /**
   * Brzycki estimated 1RM — computed server-side on every working set that has
   * weight, reps, and RIR.  Null for warmup sets or missing effort data.
   */
  estimated_1rm: number | null
  is_warmup: boolean
  notes: string | null
  logged_at: string
  exercise?: Exercise
}

// ─── Progression types ────────────────────────────────────────────────────────

/**
 * Returned by POST /api/workouts/[id]/sets when the autoregulated double
 * progression criteria are met for isolation / machine / cable lifts.
 */
export interface DoubleProgressionHint {
  type: 'double_progression'
  /** true = all criteria met; false = criteria partially met but no increase yet */
  shouldIncrease: boolean
  /** Current × 1.045, rounded to nearest 0.25 kg. Null if no weight logged. */
  suggestedWeightKg: number | null
  currentWeightKg: number | null
  targetRepMax: number
  actualReps: number
  rir: number | null
  rirTarget: number
}

/**
 * Phase context derived server-side and passed into WorkoutLogger.
 * Drives the phasic prescription card for compound exercises.
 */
export interface PhaseContext {
  phaseName: string
  phaseOrder: number       // 1-based within block
  totalPhases: number      // total phases in this block
  weekInPhase: number      // current week (1-based)
  durationWeeks: number
  /** Derived from name keywords + positional fallback */
  category: 'volume' | 'load' | 'peak' | 'other'
  /** Training stimulus character stored on the phase (migration 006) */
  weekType: WeekType
}

/**
 * A single set-group prescription within a phasic target.
 * An array of these is returned by getPhasicTargets().
 */
export interface PhasicSetTarget {
  label: string          // e.g. "Set đơn nặng"
  sets: number
  repMin: number
  repMax: number
  rpeMin: number
  rpeMax: number
  isBackOff: boolean
  note: string           // coaching cue in Vietnamese
}

// ─── API response shapes ─────────────────────────────────────────────────────
export interface ApiError {
  error: string
  details?: unknown
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
}
