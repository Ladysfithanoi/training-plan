/**
 * "Tạo bằng AI" — questionnaire, prompt and plan validation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions only (no I/O), shared by the modal and the API routes.
 *
 * Flow:
 *   1. The coach answers the questionnaire            → AiBlockAnswers
 *   2. buildPrompt() turns answers + exercise library → prompt for Gemini
 *   3. Gemini answers JSON following PLAN_SCHEMA
 *   4. sanitizePlan() checks every value and resolves the exercises → AiPlan
 *   5. The coach previews the AiPlan, then the server creates the block from it
 *      (after running sanitizePlan again — the plan comes back from the browser).
 *
 * The model may only pick exercises from the existing Kho bài tập: it is given
 * short reference codes (E1, E2 …) instead of database ids, and anything it
 * returns that is not on the list is dropped.
 */

import { availableDayTypes, recommendSplit, DAY_TYPE_LABELS } from '@/lib/trainingSplit'
import type { DayType, SplitType } from '@/lib/trainingSplit'
import type { ExerciseType, PhaseType, RepRange } from '@/types'

// ─── Questionnaire ────────────────────────────────────────────────────────────

export type AiGoal      = 'hypertrophy' | 'strength' | 'fat_loss' | 'general'
export type AiLevel     = 'beginner' | 'intermediate' | 'advanced'
export type AiGender    = 'female' | 'male' | 'unspecified'
export type AiEnding    = 'none' | 'maintenance' | 'active_rest'
export type AiEquipment = 'full_gym' | 'machines_dumbbells' | 'home_minimal'

export interface AiBlockAnswers {
  /** Optional — when blank the AI names the block. */
  blockName:       string
  goal:            AiGoal
  level:           AiLevel
  gender:          AiGender
  age:             number | null
  sessionsPerWeek: number
  sessionMinutes:  number
  mesoCount:       number
  weeksPerMeso:    number
  ending:          AiEnding
  equipment:       AiEquipment
  focusMuscles:    string[]
  limitations:     string
  notes:           string
}

interface Option<T extends string> {
  value: T
  /** Shown to the coach. */
  label: string
  /** Sent to the model. */
  brief: string
}

export const GOAL_OPTIONS: Option<AiGoal>[] = [
  { value: 'hypertrophy', label: 'Tăng cơ',                brief: 'muscle hypertrophy' },
  { value: 'strength',    label: 'Tăng sức mạnh',          brief: 'maximal strength on the main compound lifts' },
  { value: 'fat_loss',    label: 'Giảm mỡ, giữ cơ',        brief: 'fat loss while retaining muscle (client is in a calorie deficit)' },
  { value: 'general',     label: 'Khoẻ & săn chắc chung',  brief: 'general fitness and body toning' },
]

export const LEVEL_OPTIONS: Option<AiLevel>[] = [
  { value: 'beginner',     label: 'Mới tập (dưới 6 tháng)', brief: 'beginner (under 6 months of consistent training)' },
  { value: 'intermediate', label: 'Trung cấp (6 tháng – 2 năm)', brief: 'intermediate (6 months to 2 years)' },
  { value: 'advanced',     label: 'Nâng cao (trên 2 năm)',  brief: 'advanced (over 2 years)' },
]

export const GENDER_OPTIONS: Option<AiGender>[] = [
  { value: 'female',      label: 'Nữ',         brief: 'female' },
  { value: 'male',        label: 'Nam',        brief: 'male' },
  { value: 'unspecified', label: 'Không nêu',  brief: 'not specified' },
]

export const ENDING_OPTIONS: Option<AiEnding>[] = [
  { value: 'none',        label: 'Không cần',                 brief: 'no closing phase' },
  { value: 'maintenance', label: 'Giai đoạn duy trì',         brief: 'a closing MAINTENANCE phase' },
  { value: 'active_rest', label: 'Giai đoạn nghỉ tích cực',   brief: 'a closing ACTIVE REST phase' },
]

export const EQUIPMENT_OPTIONS: Option<AiEquipment>[] = [
  { value: 'full_gym',           label: 'Phòng gym đầy đủ',             brief: 'fully equipped gym (barbells, machines, cables, dumbbells)' },
  { value: 'machines_dumbbells', label: 'Máy, cáp và tạ đơn (không tạ đòn)', brief: 'machines, cables and dumbbells only — no barbell' },
  { value: 'home_minimal',       label: 'Tập tại nhà (tạ đơn, dây kháng lực)', brief: 'home training with dumbbells, resistance bands and bodyweight only' },
]

/** Exercise types the model may use for each equipment answer (null = all). */
const EQUIPMENT_TYPES: Record<AiEquipment, ExerciseType[] | null> = {
  full_gym:           null,
  machines_dumbbells: ['machine', 'cable', 'dumbbell', 'bodyweight', 'resistance_band'],
  home_minimal:       ['dumbbell', 'bodyweight', 'resistance_band'],
}

export const FOCUS_MUSCLE_OPTIONS = [
  'Mông', 'Đùi trước', 'Đùi sau', 'Lưng', 'Ngực', 'Vai', 'Tay', 'Bụng / Core',
] as const

export const SESSIONS_PER_WEEK = { min: 2, max: 6 }
export const SESSION_MINUTES   = [45, 60, 75, 90]
export const MESO_COUNT        = { min: 1, max: 4 }
export const WEEKS_PER_MESO    = { min: 3, max: 6 }

export const DEFAULT_AI_ANSWERS: AiBlockAnswers = {
  blockName:       '',
  goal:            'hypertrophy',
  level:           'beginner',
  gender:          'female',
  age:             null,
  sessionsPerWeek: 3,
  sessionMinutes:  60,
  mesoCount:       3,
  weeksPerMeso:    4,
  ending:          'none',
  equipment:       'full_gym',
  focusMuscles:    [],
  limitations:     '',
  notes:           '',
}

// ─── Small parsing helpers ────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Integer inside [min, max]; `fallback` when the value is not a number. */
function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Trimmed single-spaced text, cut to `max` characters. */
function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Check + clamp a questionnaire coming from the browser. */
export function sanitizeAnswers(raw: unknown): AiBlockAnswers {
  const r = asRecord(raw)
  const d = DEFAULT_AI_ANSWERS
  const focusAllowed: readonly string[] = FOCUS_MUSCLE_OPTIONS
  const ageRaw = r.age === null || r.age === undefined || r.age === '' ? null : int(r.age, 10, 90, NaN)

  return {
    blockName:       text(r.blockName, 80),
    goal:            oneOf(r.goal, GOAL_OPTIONS.map(o => o.value), d.goal),
    level:           oneOf(r.level, LEVEL_OPTIONS.map(o => o.value), d.level),
    gender:          oneOf(r.gender, GENDER_OPTIONS.map(o => o.value), d.gender),
    age:             ageRaw !== null && Number.isFinite(ageRaw) ? ageRaw : null,
    sessionsPerWeek: int(r.sessionsPerWeek, SESSIONS_PER_WEEK.min, SESSIONS_PER_WEEK.max, d.sessionsPerWeek),
    sessionMinutes:  SESSION_MINUTES.includes(Number(r.sessionMinutes)) ? Number(r.sessionMinutes) : d.sessionMinutes,
    mesoCount:       int(r.mesoCount, MESO_COUNT.min, MESO_COUNT.max, d.mesoCount),
    weeksPerMeso:    int(r.weeksPerMeso, WEEKS_PER_MESO.min, WEEKS_PER_MESO.max, d.weeksPerMeso),
    ending:          oneOf(r.ending, ENDING_OPTIONS.map(o => o.value), d.ending),
    equipment:       oneOf(r.equipment, EQUIPMENT_OPTIONS.map(o => o.value), d.equipment),
    focusMuscles:    Array.isArray(r.focusMuscles)
      ? [...new Set(r.focusMuscles.filter((m): m is string => typeof m === 'string' && focusAllowed.includes(m)))]
      : [],
    limitations:     text(r.limitations, 300),
    notes:           text(r.notes, 500),
  }
}

// ─── Exercise library given to the model ──────────────────────────────────────

export interface AiLibraryExercise {
  id:      string
  name:    string
  type:    ExerciseType
  /** Movement pattern name (Squat / Hinge / Push / Pull / Carry / Isolation). */
  pattern: string | null
  muscles: string[]
}

/** Fewer usable exercises than this → the equipment filter is not applied. */
export const MIN_LIBRARY_SIZE = 8

/**
 * Keep only the exercises the client's equipment allows. When that leaves too
 * few to build a program, the whole library is used and `relaxed` is true.
 */
export function filterLibraryByEquipment(
  library: AiLibraryExercise[],
  equipment: AiEquipment,
): { library: AiLibraryExercise[]; relaxed: boolean } {
  const allowed = EQUIPMENT_TYPES[equipment]
  if (!allowed) return { library, relaxed: false }
  const filtered = library.filter(e => allowed.includes(e.type))
  if (filtered.length < MIN_LIBRARY_SIZE) return { library, relaxed: true }
  return { library: filtered, relaxed: false }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an evidence-based strength & conditioning coach (Eric Helms' Muscle & Strength Pyramid, Renaissance Periodization volume landmarks). You design a complete training block for a personal trainer's client inside a training-plan app.

Hard rules:
- Use ONLY exercises from the EXERCISE LIBRARY, referenced by their code (E1, E2 …) in the "ref" field. Never invent an exercise and never repeat one inside the same session.
- Write every name, label, description and note in Vietnamese. Exercise codes stay as given.
- Return exactly the requested number of TRAINING phases (mesocycles), in order, plus the closing phase when one is requested.

Block structure:
- phase_type "training": one mesocycle. Progress from one mesocycle to the next (more weekly sets, or heavier loading with lower reps / lower RIR) so the block has a clear direction. Name them "Meso 1 — …", "Meso 2 — …".
- phase_type "maintenance" (closing phase only): 2–3 weeks, about one third of the weekly sets of the last mesocycle, same main lifts.
- phase_type "active_rest" (closing phase only): 1–2 weeks, 2 easy sessions per week, light loads, rir 4–5, 3–4 exercises per session.

Sessions:
- Each phase lists its distinct weekly sessions in "days". The number of days equals the sessions per week of that phase.
- split_type by sessions per week: 2–3 → "fullbody", 4 → "upper_lower", 5–6 → "ppl".
- Day "type" must fit the split: fullbody → "fullbody"; upper_lower → "upper" or "lower"; ppl → "push", "pull" or "legs". Use "other" only for a session that fits none of these.
- Give each day a short Vietnamese label that tells sessions apart (e.g. "Toàn thân A", "Thân trên 1", "Đẩy 2").
- Order exercises as they are performed: heavy multi-joint lifts first, isolation work last.
- Exercises per session by session length: 45 min → 4–5, 60 min → 5–6, 75 min → 6–7, 90 min → 7–8.

Prescription:
- sets: 2–4 per exercise. Keep each muscle group at or below about 10 sets in one session.
- Weekly sets per muscle group: beginner 6–10, intermediate 10–16, advanced 12–20. Put priority muscle groups at the upper end and the rest near the lower end.
- Rep ranges by goal: hypertrophy 6–12 on compound lifts and 10–20 on machine / cable / isolation work; strength 3–6 on main lifts and 6–12 on accessories; fat loss and general fitness 8–15.
- rir (reps in reserve): beginners 3 → 2 across the block; intermediate and advanced 3 → 1. Never 0 for a beginner.
- rep_ranges of a phase: the 1–3 rep zones that phase uses (e.g. 6–10 and 10–15).
- Respect injuries and limitations: leave out movements that load the affected area and choose a safer alternative from the library.
- note: one short coaching cue in Vietnamese (technique, tempo or rest), at most 120 characters. Use "" when there is nothing useful to say.`

/** A, B … Z, A2, B2 … — the STT label of the n-th exercise of a day (0-based). */
export function orderLabelFor(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26))
  const cycle = Math.floor(index / 26)
  return cycle > 0 ? `${letter}${cycle + 1}` : letter
}

const briefOf = <T extends string>(options: Option<T>[], value: T) =>
  options.find(o => o.value === value)?.brief ?? value

/**
 * Build the prompt. `refToId` maps the codes shown to the model back to the
 * exercise ids, for sanitizePlan().
 */
export function buildPrompt(
  answers: AiBlockAnswers,
  library: AiLibraryExercise[],
): { system: string; prompt: string; refToId: Map<string, string> } {
  const refToId = new Map<string, string>()
  const lines = library.map((e, i) => {
    const ref = `E${i + 1}`
    refToId.set(ref, e.id)
    const muscles = e.muscles.length > 0 ? e.muscles.join(', ') : '-'
    return `${ref} | ${e.name} | ${e.type} | ${e.pattern ?? '-'} | ${muscles}`
  })

  const profile = [
    `- Goal: ${briefOf(GOAL_OPTIONS, answers.goal)}`,
    `- Training experience: ${briefOf(LEVEL_OPTIONS, answers.level)}`,
    `- Sex: ${briefOf(GENDER_OPTIONS, answers.gender)}`,
    answers.age !== null ? `- Age: ${answers.age}` : null,
    `- Sessions per week: ${answers.sessionsPerWeek}`,
    `- Session length: about ${answers.sessionMinutes} minutes`,
    `- Equipment: ${briefOf(EQUIPMENT_OPTIONS, answers.equipment)}`,
    `- Priority muscle groups: ${answers.focusMuscles.length > 0 ? answers.focusMuscles.join(', ') : 'none — balanced development'}`,
    `- Injuries / limitations: ${answers.limitations || 'none reported'}`,
    answers.notes ? `- Extra notes from the coach: ${answers.notes}` : null,
  ].filter(Boolean).join('\n')

  const structure = [
    `- ${answers.mesoCount} training phase(s) (mesocycles), each ${answers.weeksPerMeso} weeks long`,
    `- Closing phase: ${briefOf(ENDING_OPTIONS, answers.ending)}`,
    answers.blockName
      ? `- Block name (use exactly): ${answers.blockName}`
      : '- Block name: propose a short Vietnamese name that reflects the goal',
  ].join('\n')

  const prompt = [
    'CLIENT PROFILE', profile, '',
    'BLOCK STRUCTURE', structure, '',
    'EXERCISE LIBRARY (code | name | equipment type | movement pattern | muscle groups)',
    lines.join('\n'), '',
    'Design the training block now.',
  ].join('\n')

  return { system: SYSTEM_PROMPT, prompt, refToId }
}

/** JSON Schema of the answer requested from Gemini. */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name:        { type: 'string', description: 'Block name in Vietnamese.' },
    description: { type: 'string', description: '1–2 Vietnamese sentences: who the block is for and how it progresses.' },
    phases: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          name:           { type: 'string' },
          phase_type:     { type: 'string', enum: ['training', 'maintenance', 'active_rest'] },
          duration_weeks: { type: 'integer', minimum: 1, maximum: 12 },
          split_type:     { type: 'string', enum: ['fullbody', 'upper_lower', 'ppl'] },
          rep_ranges: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: { min: { type: 'integer' }, max: { type: 'integer' } },
              required: ['min', 'max'],
            },
          },
          days: {
            type: 'array',
            minItems: 1,
            maxItems: 7,
            items: {
              type: 'object',
              properties: {
                type:  { type: 'string', enum: ['fullbody', 'upper', 'lower', 'push', 'pull', 'legs', 'other'] },
                label: { type: 'string' },
                exercises: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: 'object',
                    properties: {
                      ref:     { type: 'string', description: 'Exercise code from the library, e.g. E12.' },
                      sets:    { type: 'integer', minimum: 1, maximum: 6 },
                      rep_min: { type: 'integer', minimum: 1, maximum: 30 },
                      rep_max: { type: 'integer', minimum: 1, maximum: 30 },
                      rir:     { type: 'integer', minimum: 0, maximum: 5 },
                      note:    { type: 'string' },
                    },
                    required: ['ref', 'sets', 'rep_min', 'rep_max', 'rir', 'note'],
                  },
                },
              },
              required: ['type', 'label', 'exercises'],
            },
          },
        },
        required: ['name', 'phase_type', 'duration_weeks', 'split_type', 'rep_ranges', 'days'],
      },
    },
  },
  required: ['name', 'description', 'phases'],
}

// ─── Validated plan ───────────────────────────────────────────────────────────

export interface AiPlanExercise {
  exercise_id: string
  /** Display name, from Kho bài tập. */
  name:        string
  sets:        number
  rep_min:     number
  rep_max:     number
  rir:         number
  note:        string | null
}

export interface AiPlanDay {
  type:      DayType
  label:     string
  exercises: AiPlanExercise[]
}

export interface AiPlanPhase {
  name:               string
  phase_type:         PhaseType
  duration_weeks:     number
  frequency_per_week: number
  split_type:         SplitType
  rep_ranges:         RepRange[]
  days:               AiPlanDay[]
}

export interface AiPlan {
  name:        string
  description: string | null
  phases:      AiPlanPhase[]
}

export const PLAN_LIMITS = { phases: 6, days: 7, exercisesPerDay: 12 }

const PHASE_TYPES: readonly PhaseType[] = ['training', 'maintenance', 'active_rest']
const SPLIT_TYPES: readonly SplitType[] = ['fullbody', 'upper_lower', 'ppl']

/**
 * Turn an untrusted plan (straight from the model, or sent back by the browser)
 * into a valid AiPlan.
 *
 * `resolve` maps one raw exercise entry to a library exercise, or null when it
 * is not in the library — such entries are dropped and counted in `dropped`.
 * Days left without exercises are removed, and so are training phases left
 * without days. Returns plan = null when nothing usable remains.
 */
export function sanitizePlan(
  raw: unknown,
  resolve: (entry: Record<string, unknown>) => { id: string; name: string } | null,
): { plan: AiPlan | null; dropped: number } {
  const root = asRecord(raw)
  const rawPhases = Array.isArray(root.phases) ? root.phases.slice(0, PLAN_LIMITS.phases) : []
  let dropped = 0
  const phases: AiPlanPhase[] = []

  for (const rawPhase of rawPhases) {
    const p = asRecord(rawPhase)
    const phaseType = oneOf(p.phase_type, PHASE_TYPES, 'training')
    const rawDays = Array.isArray(p.days) ? p.days.slice(0, PLAN_LIMITS.days) : []
    const splitType = oneOf(p.split_type, SPLIT_TYPES, recommendSplit(rawDays.length || 3))
    const allowedDayTypes = availableDayTypes(splitType)

    const days: AiPlanDay[] = []
    const usedLabels = new Set<string>()
    const typeTally: Partial<Record<DayType, number>> = {}

    for (const rawDay of rawDays) {
      const d = asRecord(rawDay)
      const type = oneOf(d.type, allowedDayTypes, 'other')
      const rawExercises = Array.isArray(d.exercises) ? d.exercises : []

      const exercises: AiPlanExercise[] = []
      const seen = new Set<string>()
      for (const rawExercise of rawExercises) {
        if (exercises.length >= PLAN_LIMITS.exercisesPerDay) break
        const e = asRecord(rawExercise)
        const found = resolve(e)
        if (!found) { dropped++; continue }
        if (seen.has(found.id)) continue
        seen.add(found.id)

        let repMin = int(e.rep_min, 1, 100, 8)
        let repMax = int(e.rep_max, 1, 100, 12)
        if (repMin > repMax) [repMin, repMax] = [repMax, repMin]

        exercises.push({
          exercise_id: found.id,
          name:        found.name,
          sets:        int(e.sets, 1, 10, 3),
          rep_min:     repMin,
          rep_max:     repMax,
          rir:         int(e.rir, 0, 10, 2),
          note:        text(e.note, 300) || null,
        })
      }
      if (exercises.length === 0) continue

      const n = (typeTally[type] = (typeTally[type] ?? 0) + 1)
      const base = text(d.label, 40) || `${DAY_TYPE_LABELS[type]} ${n}`
      let label = base
      for (let k = 2; usedLabels.has(label); k++) label = `${base} (${k})`
      usedLabels.add(label)

      days.push({ type, label, exercises })
    }

    // A training phase with no usable session is not a phase.
    if (days.length === 0 && phaseType === 'training') continue

    const allExercises = days.flatMap(d => d.exercises)
    let repRanges: RepRange[] = (Array.isArray(p.rep_ranges) ? p.rep_ranges : [])
      .slice(0, 3)
      .map(rr => {
        const r = asRecord(rr)
        const min = int(r.min, 1, 100, 0)
        const max = int(r.max, 1, 100, 0)
        return { min: Math.min(min, max), max: Math.max(min, max) }
      })
      .filter(rr => rr.min > 0)
    if (phaseType === 'active_rest') {
      repRanges = []
    } else if (repRanges.length === 0) {
      repRanges = allExercises.length > 0
        ? [{
            min: Math.min(...allExercises.map(e => e.rep_min)),
            max: Math.max(...allExercises.map(e => e.rep_max)),
          }]
        : [{ min: 8, max: 12 }]
    }

    phases.push({
      name:               text(p.name, 80) || `Meso ${phases.length + 1}`,
      phase_type:         phaseType,
      duration_weeks:     int(p.duration_weeks, 1, 12, 4),
      frequency_per_week: days.length > 0 ? Math.min(7, days.length) : int(p.frequency_per_week, 1, 7, 2),
      split_type:         splitType,
      rep_ranges:         repRanges,
      days,
    })
  }

  if (phases.length === 0) return { plan: null, dropped }

  return {
    plan: {
      name:        text(root.name, 80) || 'Khối tập AI',
      description: text(root.description, 500) || null,
      phases,
    },
    dropped,
  }
}

/** Phase columns that depend only on the phase type (same values as the presets). */
export function phaseTypeDefaults(type: PhaseType): {
  target_set_reduction_factor: number
  includes_deload:             boolean
  max_rir:                     number | null
  max_weight_percent:          number | null
} {
  if (type === 'maintenance') {
    return { target_set_reduction_factor: 0.333, includes_deload: true, max_rir: null, max_weight_percent: null }
  }
  if (type === 'active_rest') {
    return { target_set_reduction_factor: 0.5, includes_deload: false, max_rir: 10, max_weight_percent: 0.5 }
  }
  return { target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null }
}
