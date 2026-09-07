/**
 * Lịch theo múi giờ Việt Nam
 * ──────────────────────────
 * Mọi mốc "ngày" của ứng dụng (ngày tập, tuần trong meso, hạn kết thúc meso)
 * đều phải tính theo lịch mà học viên đang sống, không theo đồng hồ của máy chủ.
 *
 * Trước đây các chỗ này dùng `new Date().toISOString().split('T')[0]` — tức là
 * NGÀY THEO UTC. Máy chủ Vercel chạy ở UTC, Việt Nam là UTC+7, nên từ 00:00 đến
 * 07:00 giờ Việt Nam ứng dụng vẫn coi là "hôm qua":
 *   • buổi tập ghi lúc 5h sáng thứ Hai bị lưu vào ngày Chủ nhật;
 *   • tuần mới chỉ nhảy lúc 7h sáng thay vì lúc nửa đêm;
 *   • meso hết hạn cũng chỉ được chuyển từ 7h sáng trở đi.
 *
 * Các hàm dưới đây neo toàn bộ phép tính vào một chuỗi ngày `YYYY-MM-DD` theo
 * `Asia/Ho_Chi_Minh`, nên máy chủ (UTC) và trình duyệt (giờ máy học viên) luôn
 * cho ra cùng một kết quả.
 */

export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year:  'numeric',
  month: '2-digit',
  day:   '2-digit',
})

/** Hôm nay theo lịch Việt Nam, dạng `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): string {
  const parts = dayFormatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Số ngày kể từ 1970-01-01 của một chuỗi ngày.
 * Chấp nhận cả `YYYY-MM-DD` lẫn timestamp đầy đủ (chỉ lấy 10 ký tự đầu), nên
 * dùng thẳng được với cột DATE của Supabase.
 * Trả về `NaN` khi chuỗi không hợp lệ — nơi gọi phải tự phòng thủ.
 */
export function dayNumber(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr ?? '')
  if (!m) return NaN
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000)
}

/** Số ngày trọn vẹn từ `fromISO` đến `toISO` (âm khi `toISO` ở trước). */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  return dayNumber(toISO) - dayNumber(fromISO)
}

/** Cộng thêm `days` ngày vào một chuỗi `YYYY-MM-DD`, trả lại cùng định dạng. */
export function addDaysISO(dateStr: string, days: number): string {
  const n = dayNumber(dateStr)
  if (Number.isNaN(n)) return dateStr
  return new Date((n + days) * 86_400_000).toISOString().slice(0, 10)
}
