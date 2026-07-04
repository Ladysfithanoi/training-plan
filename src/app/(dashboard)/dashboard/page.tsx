import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PhaseTimeline } from '@/components/programs/PhaseTimeline'
import { autoAdvancePhaseIfExpired } from '@/lib/transitions'
import { phaseTypeLabel, phaseTypeBadgeClass, currentWeekInPhase, formatDate, cn } from '@/lib/utils'
import type { UserProgram, WorkoutSession } from '@/types'
import Link from 'next/link'

export const metadata = { title: 'Bảng điều khiển' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch active program
  const { data: rawProgram } = await supabase
    .from('user_programs')
    .select('*, block:training_blocks(*, phases(*)), current_phase:phases(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let activeProgram = rawProgram as UserProgram | null

  // ── Tự động chuyển giai đoạn hết hạn ──────────────────────────────────────
  let advanceResult = { advanced: false, completed: false, nextPhaseName: null as string | null }
  if (activeProgram?.current_phase && activeProgram.phase_start_date) {
    advanceResult = await autoAdvancePhaseIfExpired({
      id: activeProgram.id,
      block_id: activeProgram.block_id,
      current_phase_id: activeProgram.current_phase_id!,
      phase_start_date: activeProgram.phase_start_date,
      current_phase: activeProgram.current_phase,
    })
    if (advanceResult.advanced && !advanceResult.completed) {
      const { data: refreshed } = await supabase
        .from('user_programs')
        .select('*, block:training_blocks(*, phases(*)), current_phase:phases(*)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (refreshed) activeProgram = refreshed as UserProgram
    }
  }

  // Các buổi tập gần đây (include set count for live indicator)
  const { data: recentSessions } = await supabase
    .from('workout_sessions')
    .select('*, sets:workout_sets(count)')
    .eq('user_id', user.id)
    .order('session_date', { ascending: false })
    .limit(5)

  type SessionWithCount = WorkoutSession & { sets: { count: number }[] }
  const sessions = (recentSessions ?? []) as SessionWithCount[]
  const phases = (activeProgram?.block as any)?.phases ?? []
  const weekNum = activeProgram?.phase_start_date
    ? currentWeekInPhase(activeProgram.phase_start_date)
    : null

  // Tổng khối lượng tuần này
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const { data: weekSessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .gte('session_date', weekStart.toISOString().split('T')[0])

  const weekSessionIds = weekSessions?.map(s => s.id) ?? []
  let weeklyVolume = 0
  if (weekSessionIds.length > 0) {
    const { data: weekSets } = await supabase
      .from('workout_sets')
      .select('actual_reps, weight_kg')
      .in('session_id', weekSessionIds)
      .eq('is_warmup', false)
      .not('actual_reps', 'is', null)
      .not('weight_kg', 'is', null)
    weeklyVolume = weekSets?.reduce((s, r) => s + ((r.actual_reps ?? 0) * (r.weight_kg ?? 0)), 0) ?? 0
  }

  // ── Phát hiện tín hiệu cần Deload ────────────────────────────────────────────
  // Nếu 3 buổi hoàn thành gần nhất đều có bài tập compound ở RPE 10 / RIR 0 → gợi ý deload
  let needsDeload = false
  try {
    const { data: last3 } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('session_date', { ascending: false })
      .limit(3)

    if ((last3?.length ?? 0) >= 3) {
      const sessionIds = last3!.map(s => s.id)
      const { data: peakSets } = await supabase
        .from('workout_sets')
        .select('session_id, exercise:exercises(type)')
        .in('session_id', sessionIds)
        .eq('is_warmup', false)
        .or('rir.eq.0,rpe.eq.10')

      if (peakSets && peakSets.length > 0) {
        const sessionsWithCompoundPeak = new Set(
          peakSets
            .filter(s => (s.exercise as any)?.type === 'compound')
            .map(s => s.session_id),
        )
        needsDeload = sessionIds.every(id => sessionsWithCompoundPeak.has(id))
      }
    }
  } catch {
    // Advisory-only — never crash the dashboard
  }

  const sessionStatusVi: Record<string, string> = {
    completed: 'Hoàn thành',
    skipped: 'Bỏ qua',
    in_progress: 'Đang tập',
    planned: 'Đã lên kế hoạch',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Tổng quan</p>
        <h1 className="text-2xl font-bold text-ink">Bảng điều khiển</h1>
      </div>

      {/* Banner: tự động chuyển giai đoạn thành công */}
      {advanceResult.advanced && !advanceResult.completed && (
        <div className="rounded-xl border border-slate/25 bg-slate/8 px-5 py-4 flex items-center gap-4">
          <div className="h-8 w-8 rounded-lg bg-slate/15 flex items-center justify-center shrink-0">
            <svg className="h-4 w-4 text-slate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate">Giai đoạn đã được tự động chuyển</p>
            <p className="text-xs text-slate/70">
              Bạn đã chuyển sang <strong>{advanceResult.nextPhaseName}</strong>. Mục tiêu tập luyện đã được cập nhật.
            </p>
          </div>
        </div>
      )}

      {/* Banner: hoàn thành giáo án */}
      {advanceResult.advanced && advanceResult.completed && (
        <div className="rounded-xl border border-amber/25 bg-amber/8 px-5 py-4 flex items-center gap-4">
          <div className="h-8 w-8 rounded-lg bg-amber/15 flex items-center justify-center shrink-0">
            <svg className="h-4 w-4 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber">Hoàn thành khối tập luyện!</p>
            <p className="text-xs text-amber/70">
              Chúc mừng — bạn đã hoàn thành tất cả các giai đoạn. Hãy liên hệ huấn luyện viên để nhận giáo án tiếp theo.
            </p>
          </div>
        </div>
      )}

      {/* Banner: gợi ý Deload */}
      {needsDeload && (
        <div className="rounded-xl border border-danger/25 bg-danger/5 px-5 py-4 flex items-start gap-4">
          <div className="h-9 w-9 rounded-xl bg-danger/10 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="h-5 w-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-danger">Phát hiện dấu hiệu quá tải cơ bắp</p>
            <p className="text-sm text-ink/60 mt-1 leading-relaxed">
              Bạn đã tập đến mức tối đa (RPE 10 / RIR 0) ở các bài compound trong{' '}
              <strong className="text-ink">3 buổi liên tiếp</strong> gần nhất. Hãy cân nhắc kích hoạt{' '}
              <strong className="text-ink">Tuần Xả Tải (Deload)</strong> để phục hồi tối ưu và tránh chấn thương.
            </p>
            <p className="text-xs text-ink/40 mt-2">
              Liên hệ huấn luyện viên để điều chỉnh giáo án, hoặc tự giảm 40–50% khối lượng trong tuần tới.
            </p>
          </div>
        </div>
      )}

      {/* Thống kê */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card accent="herb">
          <CardHeader><CardTitle>Khối tập kích hoạt</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold text-ink leading-tight">
              {activeProgram?.block?.name ?? '—'}
            </p>
            <p className="text-xs text-ink/40 mt-1">
              {activeProgram ? `Từ ${formatDate(activeProgram.start_date)}` : 'Chưa được cấp giáo án'}
            </p>
          </CardBody>
        </Card>

        <Card accent="slate">
          <CardHeader><CardTitle>Giai đoạn hiện tại</CardTitle></CardHeader>
          <CardBody>
            {activeProgram?.current_phase ? (
              <>
                <p className="text-xl font-bold text-ink leading-tight">
                  {activeProgram.current_phase.name}
                </p>
                <span className={cn('inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5', phaseTypeBadgeClass(activeProgram.current_phase.phase_type))}>
                  {phaseTypeLabel(activeProgram.current_phase.phase_type)}
                </span>
              </>
            ) : (
              <p className="text-xl font-bold text-ink">—</p>
            )}
          </CardBody>
        </Card>

        <Card accent="amber">
          <CardHeader><CardTitle>Tuần trong giai đoạn</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold font-mono text-ink tabular-nums">
              {weekNum !== null && activeProgram?.current_phase
                ? `${weekNum} / ${activeProgram.current_phase.duration_weeks}`
                : '—'}
            </p>
            {activeProgram?.current_phase && (
              <p className="text-xs text-ink/40 mt-1">{activeProgram.current_phase.frequency_per_week}× mỗi tuần</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Khối lượng tuần này</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold font-mono text-ink tabular-nums">
              {weeklyVolume > 0 ? `${(weeklyVolume / 1000).toFixed(1)}t` : '—'}
            </p>
            <p className="text-xs text-ink/40 mt-1">Hiệp × Số lần × Mức tạ</p>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Tiến trình giáo án */}
        <div className="lg:col-span-3">
          <h2 className="text-xs font-semibold text-ink/50 uppercase tracking-wide mb-3">Tiến trình giáo án</h2>
          {activeProgram && phases.length > 0 ? (
            <PhaseTimeline phases={phases} userProgram={activeProgram} />
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-center py-6 text-ink/40">
                  {activeProgram
                    ? 'Khối tập này chưa có giai đoạn nào.'
                    : 'Bạn chưa được giao giáo án nào. Hãy liên hệ với huấn luyện viên của bạn!'}
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Các buổi tập gần đây */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Các buổi tập gần đây</h2>
            <Link href="/admin/my-training" className="text-xs text-amber hover:underline underline-offset-2">Tất cả →</Link>
          </div>

          {sessions.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-center py-4 text-ink/40">Chưa có nhật ký buổi tập nào.</p>
                <div className="flex justify-center mt-2">
                  <Link href="/admin/my-training" className="text-sm font-semibold text-amber hover:underline">
                    Ghi nhận buổi tập đầu tiên của bạn →
                  </Link>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <Link
                  key={session.id}
                  href="/admin/my-training"
                  className="flex items-center gap-3 rounded-xl bg-white border border-ink/8 px-4 py-2.5 hover:border-ink/20 transition-all group"
                >
                  <div className="h-7 w-7 rounded-lg bg-herb/10 flex items-center justify-center shrink-0">
                    <svg className="h-3.5 w-3.5 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold font-mono text-ink">{formatDate(session.session_date)}</p>
                    <p className="text-xs text-ink/40 font-mono tabular-nums">
                      {session.status === 'in_progress' && session.sets?.[0]?.count > 0
                        ? `${session.sets[0].count} hiệp đã ghi`
                        : session.duration_minutes
                          ? `${session.duration_minutes} phút`
                          : 'Chưa ghi thời gian'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {session.status === 'in_progress' && session.sets?.[0]?.count > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-herb bg-herb/10 rounded-full px-2 py-0.5 border border-herb/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-herb" />
                        Đã lưu
                      </span>
                    )}
                    <Badge variant={session.status === 'completed' ? 'slate' : session.status === 'skipped' ? 'danger' : 'default'}>
                      {sessionStatusVi[session.status] ?? session.status}
                    </Badge>
                  </div>
                </Link>
              ))}
              <Link
                href="/progress"
                className="flex items-center justify-center gap-2 text-sm text-amber hover:underline underline-offset-2 pt-1"
              >
                Xem thống kê đầy đủ →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
