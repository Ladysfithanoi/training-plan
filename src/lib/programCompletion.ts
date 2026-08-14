/**
 * Program-completion detection ("hoàn thành lộ trình")
 * ───────────────────────────────────────────────────
 * Answers one question: was the buổi tập just logged the LAST session of the
 * LAST week of the LAST meso of the block?
 *
 * The DB has no "session finished the program" flag — `user_programs.status`
 * only flips to `completed` when the final meso expires by DATE
 * (see autoAdvancePhaseIfExpired). An athlete who trains ahead of schedule
 * finishes every prescribed session days before that happens, so the
 * congratulation has to be derived from what was actually logged.
 *
 * A week is finished when every training day of that week that carries
 * exercises has at least one logged set. Days are the split_days of the meso;
 * a meso without a split is a single repeated session, so the session being
 * logged IS the week.
 *
 * Pure functions — no I/O, safe on both server and client.
 */

import type { PhaseExercise } from '@/types'

export interface SplitDayLike {
  id: string
  type: string
  label: string
}

export interface FinalSessionInput {
  /** True when the meso being logged is the last one of its block. */
  isFinalPhase: boolean
  /** Week the session belongs to (1-based). */
  activeWeek: number
  /** Total weeks of the meso. */
  durationWeeks: number
  /** The week's effective prescription — already resolved by resolveWeekExercises(). */
  weekExercises: PhaseExercise[]
  /** Training days configured on the meso. Empty = no split. */
  splitDays: SplitDayLike[]
  /**
   * Day tab that was just completed — counts as logged even before the server
   * round-trip lands. Pass null to judge purely on `loggedExerciseIds`.
   */
  activeDayId: string | null
  /** Every exercise_id with a logged set in this week (from stored sessions). */
  loggedExerciseIds: Set<string>
}

/**
 * True when the whole block is finished: the final week of the final meso has
 * no training day left unlogged.
 */
export function isFinalSessionOfProgram({
  isFinalPhase,
  activeWeek,
  durationWeeks,
  weekExercises,
  splitDays,
  activeDayId,
  loggedExerciseIds,
}: FinalSessionInput): boolean {
  if (!isFinalPhase) return false
  if (durationWeeks <= 0) return false
  if (activeWeek !== durationWeeks) return false
  if (weekExercises.length === 0) return false

  // Only days that actually carry exercises count — an empty day tab is not a
  // session the athlete owes anyone.
  const daysWithWork = splitDays.filter(d =>
    weekExercises.some(pe => pe.day_id === d.id),
  )

  // No split (or nothing pinned to a day) → the meso is one repeated session,
  // so finishing it finishes the week.
  if (daysWithWork.length === 0) {
    return activeDayId !== null || loggedExerciseIds.size > 0
  }

  return daysWithWork.every(day => {
    if (day.id === activeDayId) return true   // just completed
    const dayExerciseIds = weekExercises
      .filter(pe => pe.day_id === day.id)
      .map(pe => pe.exercise_id)
    return dayExerciseIds.some(id => loggedExerciseIds.has(id))
  })
}

/** Collect every exercise_id that has a logged set in a given week. */
export function collectLoggedExerciseIds(
  weekSessions: { week: number; sets?: { exercise_id: string }[] }[],
  week: number,
): Set<string> {
  const ids = new Set<string>()
  for (const session of weekSessions) {
    if (session.week !== week) continue
    for (const set of session.sets ?? []) ids.add(set.exercise_id)
  }
  return ids
}

// ─── Next-step guidance ───────────────────────────────────────────────────────

export interface CompletionStep {
  icon: string
  title: string
  detail: string
}

/**
 * What to do after a block ends, in the order a coach would say it.
 * Shared by the coach view and the athlete's guest view so both get the same
 * advice; each view appends its own final call-to-action (pick a new block vs.
 * contact the coach).
 */
export const COMPLETION_STEPS: CompletionStep[] = [
  {
    icon: '🛌',
    title: 'Nghỉ chủ động 5–7 ngày',
    detail:
      'Ngưng tải nặng hoặc chỉ tập nhẹ (RIR ≥ 5, dưới 50% mức tạ quen thuộc). Gân, khớp và hệ thần kinh cần khoảng thời gian này để bắt kịp cơ bắp trước khối mới.',
  },
  {
    icon: '📏',
    title: 'Đo lại chỉ số cơ thể',
    detail:
      'Ghi lại cân nặng, số đo vòng cơ và mức tạ tốt nhất ở các bài chính. Đây là mốc so sánh để biết khối vừa rồi mang lại gì.',
  },
  {
    icon: '📊',
    title: 'Xem lại mục Tiến độ',
    detail:
      'Đối chiếu khối lượng (volume) và 1RM ước tính của từng bài qua các meso — nhóm cơ nào đang tiến, nhóm nào chững lại sẽ quyết định trọng tâm của khối kế tiếp.',
  },
  {
    icon: '🎯',
    title: 'Chốt mục tiêu tiếp theo',
    detail:
      'Tăng cơ, tăng sức mạnh hay giữ phong độ? Mục tiêu mới quyết định cấu trúc meso, tần suất và vùng rep của lộ trình sau.',
  },
]
