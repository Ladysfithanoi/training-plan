/**
 * Shared glossary of training jargon used across the app.
 * One source of truth for both inline <HelpTip> bubbles and the
 * /huong-dan guide page so definitions never drift apart.
 */
export interface GlossaryEntry {
  /** Display term (Vietnamese-friendly, may include the English abbreviation) */
  term: string
  /** One- or two-sentence plain-language definition in Vietnamese */
  def: string
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  rir: {
    term: 'RIR — Reps In Reserve',
    def: 'Số lần lặp còn lại trong khả năng khi bạn dừng hiệp. RIR 2 = còn gắng thêm được ~2 reps. Số càng nhỏ thì hiệp càng nặng.',
  },
  rpe: {
    term: 'RPE — Mức gắng sức',
    def: 'Thang gắng sức cảm nhận 1–10. RPE = 10 − RIR. RPE 8 ≈ còn 2 reps dự trữ (RIR 2).',
  },
  amrap: {
    term: 'AMRAP',
    def: 'As Many Reps As Possible — hiệp cuối thực hiện tối đa số reps tới khi gần lực kiệt (RPE 10), để đo năng lực thực tế.',
  },
  meso: {
    term: 'Meso / Giai đoạn',
    def: 'Một khối tập kéo dài vài tuần với mục tiêu riêng (nền tảng, tích lũy, cường độ…). Nhiều giai đoạn ghép lại thành một khối tập lớn.',
  },
  deload: {
    term: 'Deload — Tuần giảm tải',
    def: 'Tuần giảm khối lượng/cường độ (~50%) để cơ thể hồi phục, tránh quá tải tích lũy.',
  },
  repZones: {
    term: 'Vùng reps',
    def: 'Khoảng số lần lặp mục tiêu cho từng loại bài — ví dụ 5–10 cho bài phức hợp, 10–20 cho máy, 20–30 cho cáp.',
  },
  e1rm: {
    term: 'e1RM — 1RM ước tính',
    def: 'Sức mạnh tối đa ước tính cho 1 lần lặp, tính từ tạ × reps × RIR (công thức Brzycki). Dùng để theo dõi tiến bộ theo thời gian.',
  },
  activeRest: {
    term: 'Nghỉ tích cực',
    def: 'Giai đoạn tải rất nhẹ (≤50% tạ, RIR cao) giúp cơ thể hồi phục mà vẫn duy trì vận động.',
  },
  maintenance: {
    term: 'Duy trì',
    def: 'Giai đoạn giảm khối lượng (≈1/3) để giữ thành quả, thường đặt trước kỳ nghỉ hoặc trước khi đổi khối tập.',
  },
  frequency: {
    term: 'Tần suất',
    def: 'Số buổi tập cho mỗi nhóm cơ trong một tuần.',
  },
  loadingStyle: {
    term: 'Kiểu thực hiện (Ngang / Dọc)',
    def: 'Ngang: hoàn thành hết các hiệp của một bài rồi mới sang bài khác. Dọc: luân phiên giữa các bài cùng nhóm (superset).',
  },
  autoregulation: {
    term: 'Tự điều chỉnh (Autoregulation)',
    def: 'Điều chỉnh tải của tuần sau dựa trên khảo sát cuối buổi (hiệu suất, cảm giác RIR, hồi phục) theo phương pháp Eric Helms.',
  },
  intraSessionLoad: {
    term: 'Tự điều chỉnh tải trong buổi',
    def: 'Hiệp 1 chọn tạ ước đạt giữa/cận dưới dải rep ở RIR mục tiêu, rồi dừng đúng RIR đó. Nếu reps trong dải → giữ tạ (reps tụt dần là bình thường); nếu ngoài dải → chỉnh ~4% mỗi rep lệch. Đạt đỉnh dải ở RIR mục tiêu thì buổi sau tăng tạ.',
  },
  magicLink: {
    term: 'Magic link',
    def: 'Liên kết riêng giúp học viên xem giáo án và ghi buổi tập mà không cần tài khoản đăng nhập.',
  },
}
