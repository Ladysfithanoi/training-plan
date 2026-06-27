/**
 * Eric Helms Autoregulation Decision Tree
 * ─────────────────────────────────────────
 * Evaluates 3 post-workout signals (performance, RIR accuracy, joint recovery)
 * and returns a Vietnamese-language training recommendation for the next week.
 *
 * Reference: Helms E. et al. — "RPE-based Periodization" & "The Muscle & Strength
 * Pyramids" (2nd ed.).  The 27 leaf outcomes collapse to 9 archetypal load-
 * adjustment decisions: +heavy, +light, hold, hold+volume, −5%, −10%, deload,
 * technique-check, recovery-first.
 */

import type { SurveyPerformance, SurveyRirFeel, SurveyRecovery, SessionSurvey } from '@/types'

export type { SurveyPerformance, SurveyRirFeel, SurveyRecovery, SessionSurvey }

// ─── Decision tree (27 leaf nodes: 3 × 3 × 3) ───────────────────────────────
// Key format: `${performance}_${rir_feel}_${recovery}`
const SUGGESTION_TREE: Record<string, string> = {

  // ── Vượt mục tiêu (exceed) ──────────────────────────────────────────────────

  exceed_easier_great:
    '🏆 Cơ thể phản hồi xuất sắc — dấu hiệu siêu phục hồi (supercompensation). Tăng tạ tuần sau: +2.5–5 kg bài phức hợp, +1–2.5 kg bài phụ (dumbbell/cable). Duy trì số hiệp.',

  exceed_easier_normal:
    '✅ Hiệu suất tốt vượt kỳ vọng. Tăng tạ nhẹ (+2.5 kg) tuần sau. Duy trì số hiệp và dải rep. Theo dõi cảm giác khớp trong tuần.',

  exceed_easier_sore:
    '⚠️ Vượt mục tiêu nhưng khớp có dấu hiệu mệt mỏi. Giữ nguyên tạ, giảm tổng volume 10–15% tuần sau. Ưu tiên phục hồi — kéo giãn, ngủ đủ giấc, dinh dưỡng — trước khi tăng tải.',

  exceed_on_target_great:
    '✅ Hiệu suất và nỗ lực cân bằng hoàn hảo. Áp dụng lũy tiến kép: thêm 1–2 rep mỗi hiệp tuần sau, sau đó tăng tạ khi đạt ngưỡng trên của dải rep.',

  exceed_on_target_normal:
    '✅ Đúng hướng. Duy trì tạ hiện tại, tăng thêm 1 rep mỗi hiệp để lấp đầy dải rep mục tiêu trước khi tăng tạ. Không vội tăng tải.',

  exceed_on_target_sore:
    '⚠️ Giữ nguyên tạ và volume tuần sau. Tập trung phục hồi: kéo giãn chủ động, ngủ chất lượng, đủ protein. Đánh giá lại tình trạng khớp đầu tuần trước khi quyết định.',

  exceed_too_hard_great:
    '🔍 Vượt rep nhưng RPE thực tế cao hơn kế hoạch — có thể đang underestimate RIR. Giữ nguyên tạ. Tuần sau: hiệu chỉnh lại cách xác định RIR, tập trung vào cảm giác thực tế từng hiệp.',

  exceed_too_hard_normal:
    '🔍 Vượt rep nhưng cảm thấy quá sức. Giữ tạ, kiểm tra lại kỹ thuật thực hiện và biên độ chuyển động (ROM). Đảm bảo ROM đầy đủ trước khi tăng tải.',

  exceed_too_hard_sore:
    '⛔ Dừng tăng tải. Giảm tạ 5–10%, giảm 1 hiệp mỗi bài. Cơ thể đang tích lũy mệt mỏi (accumulated fatigue) — ưu tiên phục hồi toàn diện tuần này.',

  // ── Đạt mục tiêu (meet) ─────────────────────────────────────────────────────

  meet_easier_great:
    '✅ Cơ thể thích nghi và sẵn sàng cho kích thích mới. Tăng tạ nhẹ (+2.5 kg) tuần sau — cơ thể đang phát tín hiệu muốn tăng tải.',

  meet_easier_normal:
    '✅ Cảm giác tốt, đúng kế hoạch. Tăng nhẹ (+2.5 kg) hoặc thêm 1 hiệp phụ tuần sau — chọn một trong hai, không cả hai cùng lúc.',

  meet_easier_sore:
    '⚠️ Dù nhẹ nhàng nhưng khớp có dấu hiệu mệt. Giữ nguyên tạ, giảm volume nhẹ (−1 hiệp ở bài gây đau). Ngủ đủ giấc và bổ sung dinh dưỡng phục hồi tuần này.',

  meet_on_target_great:
    '✅ Hoàn hảo theo kế hoạch. Duy trì tạ và volume. Nếu cảm giác tương tự tuần sau, đây là thời điểm tăng +2.5 kg theo nguyên tắc lũy tiến.',

  meet_on_target_normal:
    '✅ Đúng kế hoạch, không cần thay đổi. Tính nhất quán là chìa khóa — tiếp tục chương trình hiện tại và theo dõi xu hướng dài hạn.',

  meet_on_target_sore:
    '⚠️ Giảm 1–2 hiệp ở các bài gây đau nhức tuần sau. Duy trì cường độ (giữ nguyên tạ) nhưng giảm tổng volume 15–20%.',

  meet_too_hard_great:
    '↓ RIR thực tế thấp hơn mục tiêu dù cơ thể ổn. Giảm tạ 5% tuần sau để khôi phục vùng rep tối ưu và kiểm soát RIR chính xác hơn trong từng hiệp.',

  meet_too_hard_normal:
    '↓ Giảm tạ 5–7.5% tuần sau. Tập trung thực hiện đúng RIR mục tiêu xuyên suốt tất cả các hiệp — chất lượng quan trọng hơn số lượng.',

  meet_too_hard_sore:
    '⛔ Giảm tạ 10% và bớt 1 hiệp mỗi bài tuần sau. Cơ thể đang tích lũy mệt mỏi — phải giải phóng fatigue trước khi tiếp tục tăng tải, nếu không nguy cơ chấn thương sẽ tăng cao.',

  // ── Trượt mục tiêu (miss) ───────────────────────────────────────────────────

  miss_easier_great:
    '🔍 Không đạt rep nhưng cảm thấy nhẹ nhàng — kiểm tra kỹ thuật và biên độ chuyển động (ROM). Giữ tạ, thêm 1 hiệp phụ với tạ giảm 20% cuối buổi để tích lũy volume.',

  miss_easier_normal:
    '🔍 Không đạt rep dù không mệt. Kiểm tra các yếu tố ngoài tập (giấc ngủ, dinh dưỡng, stress). Giữ nguyên tạ, tập trung kỹ thuật và kiểm soát tempo tuần sau.',

  miss_easier_sore:
    '⚠️ Giữ nguyên tạ, giảm 1 hiệp. Cơ thể chưa phục hồi đủ — ưu tiên nghỉ ngơi chất lượng và dinh dưỡng tuần này trước khi tăng bất kỳ thứ gì.',

  miss_on_target_great:
    '↔ Đúng RIR nhưng chưa đủ rep — có thể thiếu volume tích lũy. Giữ tạ, thêm 1 hiệp nhẹ (70% tạ làm việc) vào cuối buổi để xây dựng base volume.',

  miss_on_target_normal:
    '↔ Duy trì tạ và số hiệp. Không thay đổi — thực hiện nhất quán và đúng kỹ thuật trong từng hiệp là ưu tiên tuần sau.',

  miss_on_target_sore:
    '⛔ Không đạt và cơ thể mệt mỏi. Tuần sau: giảm 1 hiệp mỗi bài, giữ nguyên tạ. Phục hồi là ưu tiên tuyệt đối — không thêm bất kỳ kích thích mới nào.',

  miss_too_hard_great:
    '↓ Tạ quá cao so với khả năng hiện tại dù cơ thể cảm thấy ổn. Giảm 7.5–10% tuần sau và kiểm tra lại toàn bộ thông số kỹ thuật: tempo, ROM, điểm hỗ trợ.',

  miss_too_hard_normal:
    '↓ Deload nhẹ: giảm tạ 10%, giảm 1–2 hiệp. Xây dựng lại nền tảng kỹ thuật và kiểm soát RIR trong suốt tuần sau trước khi nghĩ đến tăng tải.',

  miss_too_hard_sore:
    '⛔ DELOAD NGAY. Giảm tạ 15–20%, giảm tổng volume 30%. Cơ thể đang ở ngưỡng quá tải — tiếp tục với cường độ hiện tại sẽ dẫn đến chấn thương. Nghỉ ngơi tích cực (active rest) tuần này.',
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full 27-node decision tree — used on the authenticated workout logger.
 * Evaluates the 3-axis post-workout survey and returns a Vietnamese-language
 * recommendation string for the next week.
 */
export function buildNextWeekSuggestion(survey: SessionSurvey): string {
  const key = `${survey.performance}_${survey.rir_feel}_${survey.recovery}`
  return (
    SUGGESTION_TREE[key] ??
    'Duy trì chương trình hiện tại. Theo dõi phản hồi cơ thể và đánh giá lại buổi tập tới.'
  )
}

/**
 * Simplified 3-outcome decision tree — used on the guest workout logger (/p/[token]).
 *
 * Decision logic (maps A/B/C labels from the guest survey):
 *   C = miss | too_hard | sore  →  fatigue/reduce
 *   A = exceed | easier | great →  increase (if present and no C)
 *   B = meet | on_target | normal → maintain (all three are B)
 */
export function buildGuestSuggestion(survey: SessionSurvey): string {
  const hasC =
    survey.performance === 'miss' ||
    survey.rir_feel    === 'too_hard' ||
    survey.recovery    === 'sore'

  const hasA =
    survey.performance === 'exceed' ||
    survey.rir_feel    === 'easier' ||
    survey.recovery    === 'great'

  if (hasC) {
    return 'Hệ thần kinh/cơ bắp có dấu hiệu mệt mỏi tích tụ hoặc tạch tạ. Tuần sau khuyến nghị giữ nguyên hoặc giảm nhẹ 5% mức tạ để đảm bảo form và hồi phục.'
  }
  if (hasA) {
    return 'Phong độ cực kỳ bùng nổ! Tuần sau tự tin tăng 2.5%–5% mức tạ (hoặc cố gắng giữ mức tạ này và tăng thêm 1–2 Reps mỗi hiệp).'
  }
  return 'Cơ thể đang thích nghi rất tốt. Tuần sau duy trì mức tạ và thể tích hiện tại, tập trung tối ưu hóa chất lượng chuyển động.'
}

// ─────────────────────────────────────────────────────────────────────────────
// Within-session (intra-session) load autoregulation — Eric Helms
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The set-to-set load protocol applied DURING a workout (vs. the post-workout
 * survey above which plans the next WEEK):
 *
 *   1. Hiệp 1 — chọn tạ ước đạt giữa/cận dưới dải rep ở mức RIR mục tiêu.
 *   2. Dừng đúng RIR mục tiêu mỗi hiệp.
 *   3. Nếu hiệp 1 nằm TRONG dải → giữ nguyên tạ; reps tụt dần là bình thường.
 *   4. Nếu hiệp 1 NGOÀI dải → chỉnh tạ ~4% cho mỗi rep lệch khỏi dải.
 *   5. Khi đạt đỉnh dải ở RIR mục tiêu → buổi sau tăng tạ.
 *
 * These are pure functions: no I/O, safe to import in both server and client.
 */

const PCT_PER_REP = 0.04   // ~4% load change per rep outside the target range

/** Round a load to the nearest 0.5 kg (barbell-friendly). */
function roundToHalfKg(kg: number): number {
  return Math.round(kg * 2) / 2
}

/** Strip a trailing ".0" for display (40.0 → "40", 42.5 → "42.5"). */
function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1)
}

export type IntraSessionStatus = 'in_range' | 'too_light' | 'too_heavy'

export interface IntraSessionGuidance {
  status: IntraSessionStatus
  /** Set-1 load, echoed for display. */
  currentWeightKg: number | null
  /** Load to use for the REMAINING sets this session (= current when in range). */
  suggestedWeightKg: number | null
  /** How many reps set 1 was outside the target range (0 when inside). */
  repsOutOfRange: number
  /** Hit the top of the range at/under the RIR target → increase load next session. */
  progressReady: boolean
  /** Vietnamese coach line shown live under the exercise. */
  message: string
}

/**
 * Pre-set advisory for choosing the load on set 1 (rule 1). Shown as a tooltip
 * on the target cell before any set is logged.
 */
export function firstSetTargetHint(repMin: number, repMax: number, rirTarget: number): string {
  const mid = Math.round((repMin + repMax) / 2)
  return (
    `Hiệp 1: chọn mức tạ bạn nghĩ đạt ~${mid} lần (giữa/cận dưới dải ${repMin}–${repMax}) ` +
    `ở RIR ${rirTarget} — tức ~${mid + rirTarget}RM — rồi dừng đúng RIR ${rirTarget}.`
  )
}

/**
 * Evaluate the first working set against the prescription and recommend the load
 * for the remaining sets (rules 3–5). Drives the live guidance line in the logger.
 *
 * Reps below the range ⇒ load too heavy ⇒ trim ~4%/rep short.
 * Reps above the range ⇒ load too light ⇒ add ~4%/rep over (and flag next-session ↑).
 * Reps inside the range ⇒ keep the load; flag ↑ only when set 1 lands at the very
 * top of the range at/under the RIR target.
 */
export function computeIntraSessionGuidance(input: {
  firstSetReps: number
  firstSetWeightKg: number | null
  firstSetRir: number | null
  repMin: number
  repMax: number
  rirTarget: number
}): IntraSessionGuidance {
  const { firstSetReps, firstSetWeightKg: w, firstSetRir, repMin, repMax, rirTarget } = input

  // ── Below range → too heavy → reduce ──────────────────────────────────────
  if (firstSetReps < repMin) {
    const under = repMin - firstSetReps
    const suggested = w != null && w > 0 ? roundToHalfKg(w * (1 - PCT_PER_REP * under)) : null
    return {
      status: 'too_heavy',
      currentWeightKg: w,
      suggestedWeightKg: suggested,
      repsOutOfRange: under,
      progressReady: false,
      message:
        `Hiệp 1 đạt ${firstSetReps} lần — dưới dải ${repMin}–${repMax}. Tạ hơi nặng: ` +
        (suggested != null
          ? `giảm xuống ~${fmtKg(suggested)} kg cho các hiệp còn lại.`
          : `giảm ~${Math.round(PCT_PER_REP * under * 100)}% cho các hiệp còn lại.`),
    }
  }

  // ── Above range → too light → increase ────────────────────────────────────
  if (firstSetReps > repMax) {
    const over = firstSetReps - repMax
    const suggested = w != null && w > 0 ? roundToHalfKg(w * (1 + PCT_PER_REP * over)) : null
    return {
      status: 'too_light',
      currentWeightKg: w,
      suggestedWeightKg: suggested,
      repsOutOfRange: over,
      progressReady: true,
      message:
        `Hiệp 1 đạt ${firstSetReps} lần — trên dải ${repMin}–${repMax}. Tạ hơi nhẹ: ` +
        (suggested != null
          ? `tăng lên ~${fmtKg(suggested)} kg cho các hiệp còn lại (buổi sau bắt đầu từ mức này).`
          : `tăng ~${Math.round(PCT_PER_REP * over * 100)}% cho các hiệp còn lại.`),
    }
  }

  // ── Inside range → keep the load ──────────────────────────────────────────
  const atTop = firstSetReps >= repMax
  const rirOk = firstSetRir == null || firstSetRir <= rirTarget
  const progressReady = atTop && rirOk
  const loadLabel = w != null && w > 0 ? `${fmtKg(w)} kg` : 'tạ'
  return {
    status: 'in_range',
    currentWeightKg: w,
    suggestedWeightKg: w,
    repsOutOfRange: 0,
    progressReady,
    message: progressReady
      ? `Hiệp 1 đạt ${firstSetReps} lần ở đỉnh dải ${repMin}–${repMax}` +
        `${firstSetRir != null ? ` (RIR ${firstSetRir})` : ''} — giữ ${loadLabel} hôm nay, ` +
        `sẵn sàng tăng tạ buổi sau ↑.`
      : `Hiệp 1 đạt ${firstSetReps} lần — trong dải ${repMin}–${repMax}. Giữ nguyên ${loadLabel} ` +
        `cho các hiệp còn lại; reps giảm dần do mệt mỏi là bình thường.`,
  }
}
