import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PhaseTimeline } from '@/components/programs/PhaseTimeline'
import { RepRangeMatrix } from '@/components/programs/RepRangeMatrix'
import { programStatusLabel, formatDate, cn } from '@/lib/utils'
import type { UserProgram } from '@/types'
import Link from 'next/link'

export const metadata = { title: 'Chương trình của tôi' }

export default async function ProgramsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: programs } = await supabase
    .from('user_programs')
    .select(`
      *,
      block:training_blocks (
        *,
        phases (*)
      ),
      current_phase:phases (*)
    `)
    .eq('user_id', user.id)
    .order('assigned_at', { ascending: false })

  const userPrograms = (programs ?? []) as UserProgram[]
  const active = userPrograms.find(p => p.status === 'active')
  const past = userPrograms.filter(p => p.status !== 'active')

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Tập luyện</p>
        <h1 className="text-2xl font-bold text-ink">Chương trình của tôi</h1>
      </div>

      {userPrograms.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-center py-8 text-ink/50">
              Hiện tại chưa có chương trình tập luyện nào được giao. Huấn luyện viên của bạn sẽ sớm cập nhật.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Chương trình đang hoạt động */}
      {active && (
        <section className="space-y-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-herb">
            Đang hoạt động
          </h2>

          <Card accent="herb">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-xl font-bold text-ink">{active.block?.name}</h3>
                {active.block?.description && (
                  <p className="text-sm text-ink/50 mt-1">{active.block.description}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 text-xs text-ink/40">
                <span>Bắt đầu {formatDate(active.start_date)}</span>
                <span>Giao bởi HLV</span>
              </div>
            </div>

            {/* Phase timeline */}
            <div className="mb-6">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-3">
                Tiến trình giai đoạn
              </h4>
              <PhaseTimeline
                phases={(active.block as any)?.phases ?? []}
                userProgram={active}
              />
            </div>

            {/* Rep range matrix */}
            {((active.block as any)?.phases ?? []).some(
              (p: any) => p.phase_type === 'training',
            ) && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-3">
                  Mở rộng vùng Reps
                </h4>
                <RepRangeMatrix phases={(active.block as any)?.phases ?? []} />
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Chương trình đã qua */}
      {past.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">
            Giáo án đã qua
          </h2>
          <div className="space-y-3">
            {past.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-4 rounded-xl bg-white border border-ink/8 px-5 py-4 opacity-70"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink">{p.block?.name}</p>
                  <p className="text-xs text-ink/40 mt-0.5">
                    {formatDate(p.start_date)}
                  </p>
                </div>
                <Badge variant={p.status === 'completed' ? 'slate' : 'default'}>
                  {programStatusLabel(p.status)}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
