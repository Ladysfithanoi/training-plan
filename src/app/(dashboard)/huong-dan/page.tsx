import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GLOSSARY } from '@/lib/glossary'
import { formatDate } from '@/lib/utils'
import { listAnnouncements } from '@/lib/announcements.server'
import { ANNOUNCEMENT_MAX_VISIBLE } from '@/lib/announcements'
import type { Announcement } from '@/types'

export const metadata = { title: 'Hướng dẫn sử dụng' }
export const dynamic = 'force-dynamic'

interface Step { title: string; desc: string }

// ── Role-specific quick-start steps ──────────────────────────────────────────
const COACH_STEPS: Step[] = [
  { title: 'Thêm học viên', desc: 'Vào “Danh sách Học viên” → Thêm Học viên, nhập email & mật khẩu tạm. Bạn chỉ quản lý học viên do chính mình tạo.' },
  { title: 'Chuẩn bị giáo án', desc: 'Vào “Giáo án tập luyện” để tạo khối tập của riêng bạn, hoặc dùng lại giáo án có sẵn trong kho chung (chỉ xem, không sửa được của người khác).' },
  { title: 'Giao giáo án', desc: 'Ở “Danh sách Học viên”, bấm “Giáo án” để gán một khối tập cho học viên và chọn ngày bắt đầu.' },
  { title: 'Gửi liên kết', desc: 'Bấm “🔗 Gửi link” để tạo magic link — học viên mở link là ghi được buổi tập, không cần tài khoản.' },
  { title: 'Học viên tự đăng nhập theo dõi', desc: 'Ngoài magic link, học viên còn có thể đăng nhập thẳng vào web bằng email & mật khẩu bạn đã tạo lúc thêm tài khoản. Sau khi đăng nhập, họ tự xem “Chương trình của tôi” và “Tiến độ tập luyện” (biểu đồ khối lượng, e1RM…). Hãy gửi cho học viên địa chỉ web cùng email/mật khẩu đăng nhập.' },
  { title: 'Theo dõi tiến độ', desc: 'Xem “Bảng điều khiển HLV” cho hoạt động gần đây, hoặc mở “📊 Tiến độ” của từng học viên để xem biểu đồ khối lượng & e1RM.' },
]

// Coach/Admin training FOR THEMSELVES — distinct from building/assigning to students.
const COACH_SELF_STEPS: Step[] = [
  { title: 'Mở “Lịch tập của tôi”', desc: 'Mục này nằm trên thanh menu bên trái (chỉ HLV/Admin thấy) — đây là nơi bạn tự tập theo giáo án, giống như một học viên.' },
  { title: 'Chuẩn bị khối tập', desc: 'Khối tập phải có sẵn trong “Giáo án tập luyện” (do bạn tạo hoặc dùng chung) thì mới chọn được cho bản thân ở bước sau.' },
  { title: 'Chọn khối tập cho bản thân', desc: 'Lần đầu vào, ở “Chọn khối tập để bắt đầu” → tìm/lọc khối muốn theo → bấm “Bắt đầu chương trình” để kích hoạt cho chính mình.' },
  { title: 'Tập theo tuần & ngày', desc: 'Chọn tuần và ngày tập, rồi nhập số reps và mức tạ cho từng hiệp trong bảng bài tập. Cột “Mục tiêu” cho biết reps & RIR cần đạt.' },
  { title: 'Đánh giá cuối buổi', desc: 'Hoàn thành “Đánh giá buổi tập” để app gợi ý điều chỉnh tải cho tuần sau (autoregulation).' },
  { title: 'Đổi khối tập khi cần', desc: 'Muốn theo giáo án khác? Bấm nút “Đổi” ở đầu trang “Lịch tập của tôi” để chọn lại khối tập.' },
]

// Coach/Admin: building a program from scratch — block → meso → config → exercises.
const COACH_BUILD_STEPS: Step[] = [
  { title: 'Tạo khối tập mới', desc: 'Vào “Giáo án tập luyện”. Ở cột “Các Khối Tập”, bấm “+ Tạo mới”, đặt tên, mô tả (tuỳ chọn) rồi chọn một cấu trúc giai đoạn (preset 3 Meso, 3 Meso + Nghỉ tích cực, hoặc “Tuỳ chỉnh” để tạo khối trống). Bấm “Tạo khối tập”.' },
  { title: 'Thêm Meso (giai đoạn)', desc: 'Chọn khối vừa tạo, bấm “+ Thêm Meso” (hoặc “+ Thêm giai đoạn đầu tiên” nếu khối còn trống). Trong cửa sổ “Thêm Giai Đoạn Mới”: đặt tên (VD: “Meso 1 — Nền tảng”), chọn loại giai đoạn (tập luyện / duy trì / nghỉ tích cực), số tuần, số buổi/tuần và các vùng reps. Lặp lại để thêm nhiều meso.' },
  { title: 'Chỉnh cấu hình giáo án', desc: 'Với mỗi meso, ở mục cấu hình chọn “— Chọn kiểu split —” (kiểu chia buổi tập). Có thể đổi tên ngày, “+ Thêm ngày” hoặc sắp xếp lại thứ tự ngày. Sau khi chỉnh, BẮT BUỘC bấm “Lưu cấu hình giáo án” — dấu * báo còn thay đổi chưa lưu.' },
  { title: 'Gán bài tập cho từng ngày', desc: 'Chọn ngày tập rồi bấm “+ Thêm bài tập” để tìm và gán bài từ kho, đặt số hiệp (sets) và vùng reps mục tiêu. Đảm bảo mỗi ngày đều có đủ bài trước khi giao cho học viên.' },
  { title: 'Kiểm tra & giao', desc: 'Xem lại “Tiến trình giai đoạn”, “Ma trận vùng Reps” và “Cấu trúc Phân kỳ” để chắc chắn khối tập hợp lý, sau đó giao cho học viên ở “Danh sách Học viên” → “Giáo án”.' },
]

const STUDENT_STEPS: Step[] = [
  { title: 'Xem chương trình', desc: 'Mở “Chương trình của tôi” để xem khối tập, các giai đoạn và bài tập HLV đã giao.' },
  { title: 'Ghi buổi tập', desc: 'Trong mỗi buổi, nhập số reps và mức tạ cho từng hiệp. Cột “Mục tiêu” cho biết reps & RIR cần đạt.' },
  { title: 'Đánh giá cuối buổi', desc: 'Hoàn thành nhanh phần “Đánh giá buổi tập” — app sẽ gợi ý điều chỉnh tải cho tuần sau.' },
  { title: 'Xem tiến độ', desc: 'Mở “Tiến độ tập luyện” để theo dõi khối lượng, sức mạnh ước tính (e1RM) tăng dần theo thời gian.' },
]

/**
 * Collapsible section built on native <details> so it works inside a server
 * component without client-side JS. Keeps the long guide compact — only the
 * first section is open by default; the rest expand on demand.
 */
function Accordion({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-ink/8 bg-white overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none px-5 py-4 hover:bg-ink/[0.015] transition-colors [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          {title}
        </h2>
        <svg
          className="h-4 w-4 shrink-0 text-ink/40 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-ink/5">{children}</div>
    </details>
  )
}

/**
 * Bảng tin — admin-posted announcements (newest first, max 3). Rendered above
 * the guide for staff so HLV learn about new features / programs. Hidden when
 * there is nothing to show. Cover images are inline base64 data-URLs, so a
 * plain <img> is used (no next/image domain config needed).
 */
function AnnouncementBoard({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber/12 text-amber">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Bảng tin</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <article
            key={item.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-ink/8 bg-white"
          >
            {item.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt={item.title}
                className="h-40 w-full object-cover bg-ink/5"
              />
            )}
            <div className="flex flex-1 flex-col p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber">
                {formatDate(item.created_at)}
              </p>
              <h3 className="mt-1 text-base font-bold text-ink leading-snug">{item.title}</h3>
              <p className="mt-2 text-sm text-ink/60 leading-relaxed whitespace-pre-line">
                {item.content}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-ink text-paper text-xs font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <div>
            <p className="font-semibold text-sm text-ink">{s.title}</p>
            <p className="text-sm text-ink/55 mt-0.5 leading-relaxed">{s.desc}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default async function GuidePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Trial (Trải nghiệm) accounts use the coach UI, so they get the coach guide.
  const isStaff = profile?.role === 'admin' || profile?.role === 'coach' || profile?.role === 'trial'
  const isCoach = profile?.role === 'coach' || profile?.role === 'trial'
  const steps = isStaff ? COACH_STEPS : STUDENT_STEPS

  // Bảng tin — only staff (HLV) need feature/program updates. Fetched live
  // (force-dynamic) and self-purging at 48h via listAnnouncements.
  const announcements = isStaff ? await listAnnouncements(ANNOUNCEMENT_MAX_VISIBLE) : []

  return (
    <div className="space-y-8">
      <AnnouncementBoard items={announcements} />

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
          {isStaff ? (isCoach ? 'Huấn luyện viên' : 'Quản trị viên / HLV') : 'Học viên'}
        </p>
        <h1 className="text-2xl font-bold text-ink">Hướng dẫn sử dụng</h1>
        <p className="text-sm text-ink/50 mt-1">
          Những bước cơ bản và giải thích thuật ngữ để bạn dùng app nhanh chóng.
        </p>
      </div>

      {/* Coach permission note */}
      {isCoach && (
        <div className="rounded-xl border border-amber/20 bg-amber/5 px-5 py-4">
          <p className="text-sm font-semibold text-amber/90">Quyền của Huấn luyện viên</p>
          <p className="text-sm text-ink/60 mt-1 leading-relaxed">
            Bạn thấy được toàn bộ kho bài tập và giáo án dùng chung, nhưng chỉ sửa/xoá được những
            mục do <strong>chính bạn tạo</strong>. Với học viên, bạn chỉ thấy và quản lý
            <strong> học viên của mình</strong>. Bạn vẫn có thể giao bất kỳ giáo án nào nhìn thấy
            cho học viên của mình.
          </p>
        </div>
      )}

      {/* Collapsible sections — keep the guide compact: only the first opens
          by default, the rest expand on demand so there is far less scrolling. */}
      <div className="space-y-3">
        <Accordion
          title={isStaff ? 'Bắt đầu nhanh — Quản lý học viên' : 'Bắt đầu nhanh'}
          defaultOpen
        >
          <StepList steps={steps} />
        </Accordion>

        {/* Coach/Admin: train for yourself */}
        {isStaff && (
          <Accordion title="Tự chọn lịch tập cho bản thân">
            <p className="text-sm text-ink/55 mb-4 leading-relaxed">
              HLV/Admin cũng có thể tự tập theo giáo án giống học viên. Các bước dưới đây hướng dẫn cách
              chọn và theo dõi lịch tập của riêng bạn trong mục “Lịch tập của tôi”.
            </p>
            <StepList steps={COACH_SELF_STEPS} />
          </Accordion>
        )}

        {/* Coach/Admin: build a program (block → meso → config → exercises) */}
        {isStaff && (
          <Accordion title="Xây dựng giáo án — khối tập, meso & cấu hình">
            <p className="text-sm text-ink/55 mb-4 leading-relaxed">
              Hướng dẫn tạo một giáo án hoàn chỉnh: thêm khối tập mới, thêm các giai đoạn (meso),
              chỉnh cấu hình split của chương trình rồi gán bài tập cho từng ngày.
            </p>
            <StepList steps={COACH_BUILD_STEPS} />
          </Accordion>
        )}

        {/* Glossary */}
        <Accordion title="Thuật ngữ thường gặp">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.values(GLOSSARY).map(entry => (
              <div key={entry.term} className="rounded-xl border border-ink/8 bg-white px-4 py-3">
                <p className="font-semibold text-sm text-ink">{entry.term}</p>
                <p className="text-sm text-ink/55 mt-1 leading-relaxed">{entry.def}</p>
              </div>
            ))}
          </div>
        </Accordion>
      </div>

      <p className="text-xs text-ink/35">
        Cần hỗ trợ thêm? Liên hệ quản trị viên của bạn.
      </p>
    </div>
  )
}
