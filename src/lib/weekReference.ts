/**
 * Week-over-week exercise reference
 * ─────────────────────────────────
 * Answers "what did I do on this lift last time, and what should I load today?"
 * for the week currently being logged.
 *
 * The reference is normally last week. When the athlete skipped that lift for
 * one or more weeks, we walk further back to the most recent week that actually
 * has sets — otherwise week 3 would show nothing at all just because week 2 was
 * missed. A gap changes the recommendation: instead of progressing off last
 * week, the cue becomes a detraining deload off the last known load.
 *
 * Pure functions — no I/O, safe on both server and client.
 */

import { buildProgressionCue } from './autoregulation'
import type { ProgressionCue } from './autoregulation'
import type { PhaseExercise, WorkoutSession, WorkoutSet } from '@/types'

/** A stored session tagged with the phase week it belongs to. */
export type WeekSessionRow = WorkoutSession & { week: number; sets: WorkoutSet[] }

export interface ExAverage {
  avgKg:   number | null
  avgReps: number
  avgRir:  number | null
  count:   number
}

/**
 * Per-exercise reference to the most recent week that lift was actually logged.
 * `missedWeeks` is 0 when that's last week, ≥1 when weeks were skipped.
 */
export interface PrevWeekRef {
  /** Week the reference numbers come from. */
  week:        number
  /** Display label, e.g. "20kg × 10 reps". */
  label:       string
  /** Weeks skipped between `week` and the week being logged (0 = last week). */
  missedWeeks: number
  /** Keep/increase/decrease recommendation — absent for AMRAP & peaking weeks. */
  cue?:        ProgressionCue
}

/** Average working-set weight & reps for one exercise across a given week. */
export function averageForWeekExercise(
  weekSessions: WeekSessionRow[],
  week: number,
  exerciseId: string,
): ExAverage | null {
  const sets = weekSessions
    .filter(s => s.week === week)
    .flatMap(s => (s.sets ?? []) as WorkoutSet[])
    .filter(s => s.exercise_id === exerciseId && !s.is_warmup && s.actual_reps != null)
  if (sets.length === 0) return null

  const kgSets = sets.filter(s => s.weight_kg != null)
  const avgKg = kgSets.length
    ? Math.round((kgSets.reduce((a, s) => a + (s.weight_kg ?? 0), 0) / kgSets.length) * 4) / 4
    : null
  const avgReps = Math.round(sets.reduce((a, s) => a + (s.actual_reps ?? 0), 0) / sets.length)
  const rirSets = sets.filter(s => s.rir != null)
  const avgRir = rirSets.length
    ? Math.round(rirSets.reduce((a, s) => a + (s.rir ?? 0), 0) / rirSets.length)
    : null

  return { avgKg, avgReps, avgRir, count: sets.length }
}

/**
 * Most recent week strictly before `activeWeek` that has logged sets for this
 * exercise, or null when the lift has never been done in this phase.
 */
export function findLastLoggedWeek(
  weekSessions: WeekSessionRow[],
  activeWeek: number,
  exerciseId: string,
): { week: number; avg: ExAverage } | null {
  for (let w = activeWeek - 1; w >= 1; w--) {
    const avg = averageForWeekExercise(weekSessions, w, exerciseId)
    if (avg) return { week: w, avg }
  }
  return null
}

/**
 * Build the inline reference + load cue for every exercise on the active week.
 *
 * Week 1 returns an empty map (nothing behind it). From week 2 on, each lift is
 * resolved independently — two lifts on the same day can reference different
 * weeks if one of them was skipped.
 */
export function buildPrevWeekRefs(
  rows: PhaseExercise[],
  weekSessions: WeekSessionRow[],
  activeWeek: number,
  isPeaking: boolean,
): Record<string, PrevWeekRef> | undefined {
  if (activeWeek <= 1) return undefined

  const refs: Record<string, PrevWeekRef> = {}
  for (const pe of rows) {
    const found = findLastLoggedWeek(weekSessions, activeWeek, pe.exercise_id)
    if (!found) continue

    const { week, avg } = found
    // Weeks skipped between the reference and the week being logged: 0 when the
    // reference is last week, 1 when one week in between was missed, etc.
    const missedWeeks = activeWeek - week - 1

    refs[pe.exercise_id] = {
      week,
      missedWeeks,
      label: `${avg.avgKg != null ? `${avg.avgKg}kg` : '—'} × ${avg.avgReps} reps`,
      // Rep-range logic doesn't apply to AMRAP or peaking/%1RM weeks — skip those.
      cue: !pe.is_amrap && !isPeaking
        ? buildProgressionCue({
            avgKg:     avg.avgKg,
            avgReps:   avg.avgReps,
            avgRir:    avg.avgRir,
            repMin:    pe.target_rep_min,
            repMax:    pe.target_rep_max,
            rirTarget: pe.rir_target,
            missedWeeks,
          })
        : undefined,
    }
  }

  return Object.keys(refs).length > 0 ? refs : undefined
}
