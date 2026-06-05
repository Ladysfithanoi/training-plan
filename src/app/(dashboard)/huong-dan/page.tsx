import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/Card'
import { GLOSSARY } from '@/lib/glossary'

export const metadata = { title: 'Hướng dẫn sử dụng' }
export const dynamic = 'force-dynamic'

interface Step { title: string; desc: string }

// ── Role-specific quick-start steps ──────────────────────────────────────────
const COACH_STEPS: Step[] = [
  { title: 'Thêm học viên', desc: 'Vào “Danh sách Học viên” → Thêm Học viên, nhập email & mật khẩu tạm. Bạn chỉ quản lý học viên do chính mình tạo.' },
  { title: 'Chuẩn bị giáo án', desc: 'Vào “Giáo án tập luyện” để tạo khối tập của riêng bạn, hoặc dùng lại giáo án có sẵn trong kho chung (chỉ xem, không sửa được của người khác).' },
  { title: 'Giao giáo án', desc: 'Ở “Danh sách Học viên”, bấm “Giáo án” để gán một khối tập cho học viên và chọn ngày bắt đầu.' },
  { title: 'Gửi liên kết', desc: 'Bấm “🔗 Gửi link” để tạo magic link — học viên mở link là ghi được buổi tập, không cần tài khoản.' },
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

const STUDENT_STEPS: Step[] = [
  { title: 'Xem chương trình', desc: 'Mở “Chương trình của tôi” để xem khối tập, các giai đoạn và bài tập HLV đã giao.' },
  { title: 'Ghi buổi tập', desc: 'Trong mỗi buổi, nhập số reps và mức tạ cho từng hiệp. Cột “Mục tiêu” cho biết reps & RIR cần đạt.' },
  { title: 'Đánh giá cuối buổi', desc: 'Hoàn thành nhanh phần “Đánh giá buổi tập” — app sẽ gợi ý điều chỉnh tải cho tuần sau.' },
  { title: 'Xem tiến độ', desc: 'Mở “Tiến độ tập luyện” để theo dõi khối lượng, sức mạnh ước tính (e1RM) tăng dần theo thời gian.' },
]

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

  const isStaff = profile?.role === 'admin' || profile?.role === 'coach'
  const isCoach = profile?.role === 'coach'
  const steps = isStaff ? COACH_STEPS : STUDENT_STEPS

  return (
    <div className="space-y-8">
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

      {/* Quick start */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50 mb-4">
          {isStaff ? 'Bắt đầu nhanh — Quản lý học viên' : 'Bắt đầu nhanh'}
        </h2>
        <Card>
          <CardBody>
            <StepList steps={steps} />
          </CardBody>
        </Card>
      </section>

      {/* Coach/Admin: train for yourself */}
      {isStaff && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50 mb-4">
            Tự chọn lịch tập cho bản thân
          </h2>
          <p className="text-sm text-ink/55 -mt-2 mb-4 leading-relaxed">
            HLV/Admin cũng có thể tự tập theo giáo án giống học viên. Các bước dưới đây hướng dẫn cách
            chọn và theo dõi lịch tập của riêng bạn trong mục “Lịch tập của tôi”.
          </p>
          <Card>
            <CardBody>
              <StepList steps={COACH_SELF_STEPS} />
            </CardBody>
          </Card>
        </section>
      )}

      {/* Glossary */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50 mb-4">
          Thuật ngữ thường gặp
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.values(GLOSSARY).map(entry => (
            <div key={entry.term} className="rounded-xl border border-ink/8 bg-white px-4 py-3">
              <p className="font-semibold text-sm text-ink">{entry.term}</p>
              <p className="text-sm text-ink/55 mt-1 leading-relaxed">{entry.def}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-ink/35">
        Cần hỗ trợ thêm? Liên hệ quản trị viên của bạn.
      </p>
    </div>
  )
}
