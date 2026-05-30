/**
 * LiveWorkoutFeed — server component
 * Renders a timeline of the 10 most recent completed/in-progress sessions
 * across all athletes. Displayed on the coach dashboard (/admin).
 */
import { createClient } from '@/lib/supabase/server'
import { formatDate, cn } from '@/lib/utils'
import Link from 'next/link'

// ── Survey label maps ─────────────────────────────────────────────────────────
const PERF_LABEL: Record<string, string> = {
  exceed: '🔥 Vượt mục tiêu',
  meet:   '✅ Đạt mục tiêu',
  miss:   '📉 Trượt',
}
const RIR_LABEL: Record<string, string> = {
  easier:    '💪 Khỏe hơn',
  on_target: '🎯 Đúng RIR',
  too_hard:  '😮‍💨 Quá nặng',
}
const RECOVERY_LABEL: Record<string, string> = {
  great:  '⚡ Khỏe mạnh',
  normal: '😐 Bình thường',
  sore:   '🤕 Đau nhức',
}

type FeedSession = {
  id: string
  session_date: string
  status: string
  next_week_suggestion: string | null
  survey_performance: string | null
  survey_rir_feel: string | null
  survey_recovery: string | null
  profile: { id: string; full_name: string | null; email: string } | null
  sets: { count: number }[]
}

export async function LiveWorkoutFeed() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('workout_sessions')
    .select(`
      id, session_date, status,
      next_week_suggestion, survey_performance, survey_rir_feel, survey_recovery,
      profile:profiles!user_id(id, full_name, email),
      sets:workout_sets(count)
    `)
    .in('status', ['in_progress', 'completed'])
    .order('session_date', { ascending: false })
    .limit(10)

  // Supabase infers the join as an array; cast through unknown to our typed shape
  const sessions = (data ?? []) as unknown as FeedSession[]

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-ink/8 bg-white px-5 py-8 text-center">
        <p className="text-sm text-ink/35">Chưa có buổi tập nào được ghi lại.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => {
        const setsCount = s.sets[0]?.count ?? 0
        const name = s.profile?.full_name ?? s.profile?.email ?? '—'
        const initial = name[0]?.toUpperCase() ?? '?'
        const isActive = s.status === 'in_progress'
        const hasSurvey = s.survey_performance && s.survey_rir_feel && s.survey_recovery

        return (
          <div
            key={s.id}
            className="rounded-xl border border-ink/8 bg-white px-4 py-3.5 flex items-start gap-3.5 hover:border-ink/15 transition-colors"
          >
            {/* Status dot */}
            <div className={cn(
              'h-2.5 w-2.5 rounded-full mt-1.5 shrink-0',
              isActive ? 'bg-amber animate-pulse' : 'bg-herb',
            )} />

            {/* Main content */}
            <div className="min-w-0 flex-1">
              {/* Row 1: name + date + status */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-sm text-ink">{name}</span>
                <span className="text-ink/25">·</span>
                <span className="text-xs text-ink/45">{formatDate(s.session_date)}</span>
                <span className={cn(
                  'ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                  isActive
                    ? 'bg-amber/10 text-amber border-amber/25'
                    : 'bg-herb/10 text-herb border-herb/20',
                )}>
                  {isActive ? 'Đang tập' : 'Hoàn thành'}
                </span>
                <span className="text-[11px] text-ink/35 ml-auto shrink-0">
                  {setsCount} hiệp
                </span>
              </div>

              {/* Row 2: survey answers */}
              {hasSurvey && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  <span className="text-[11px] text-ink/50">
                    {PERF_LABEL[s.survey_performance!]}
                  </span>
                  <span className="text-[11px] text-ink/50">
                    {RIR_LABEL[s.survey_rir_feel!]}
                  </span>
                  <span className="text-[11px] text-ink/50">
                    {RECOVERY_LABEL[s.survey_recovery!]}
                  </span>
                </div>
              )}

              {/* Row 3: next_week_suggestion snippet */}
              {s.next_week_suggestion && (
                <p className="mt-1.5 text-[11px] text-ink/55 leading-snug line-clamp-2 border-l-2 border-amber/35 pl-2 italic">
                  {s.next_week_suggestion}
                </p>
              )}
            </div>

            {/* Link to athlete detail */}
            {s.profile?.id && (
              <Link
                href={`/admin/users/${s.profile.id}`}
                className="shrink-0 self-start mt-0.5 rounded-lg border border-ink/12 px-2.5 py-1 text-[11px] font-medium text-ink/45 hover:text-ink hover:border-ink/25 transition-colors"
              >
                Chi tiết →
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
