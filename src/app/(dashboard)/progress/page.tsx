import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import { VolumeChart } from './_components/VolumeChart'
import { ExerciseProgress } from './_components/ExerciseProgress'
import { E1rmChart } from './_components/E1rmChart'
import { ProgramAuditCard } from './_components/ProgramAuditCard'
import { classifyPhaseCategory } from '@/lib/progression'
import {
  countLoggedZones,
  countProgrammedZones,
  detectPhaseGoal,
  auditRepZones,
} from '@/lib/repZones'
import { computeMuscleVolumes } from '@/lib/volumeAdequacy'
import type { RepZoneAudit } from '@/lib/repZones'
import type { VolumeAdequacyResult, PhaseExerciseForAudit, LoggedExerciseForAudit } from '@/lib/volumeAdequacy'

export const metadata = { title: 'Tiến độ tập luyện' }
export const dynamic = 'force-dynamic'

export default async function ProgressPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // ── Shape declarations ────────────────────────────────────────────────────
  let weeklyVolumes: Array<{ label: string; volume: number; sessions: number }> = []
  let exerciseProgress: Array<{
    exercise_id: string
    exercise_name: string
    dataPoints: Array<{ date: string; weight_kg: number; actual_reps: number }>
  }> = []
  let e1rmProgress: Array<{
    exercise_id: string
    exercise_name: string
    dataPoints: Array<{ date: string; estimated_1rm: number; weight_kg: number; actual_reps: number }>
  }> = []
  let repZoneAudit: RepZoneAudit | null = null
  let volumeAdequacy: VolumeAdequacyResult | null = null
  let repZonePhaseName = ''

  try {
    // ── Calendar setup ────────────────────────────────────────────────────────
    const weeks = 8
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
    monday.setHours(0, 0, 0, 0)

    const weekBuckets: Array<{ label: string; start: string; end: string }> = []
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(monday)
      start.setDate(monday.getDate() - i * 7)
      const end = new Date(start)
      end.setDate(start.getDate() + 7)
      weekBuckets.push({
        label: start.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' }),
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      })
    }

    const thisWeek = weekBuckets[weekBuckets.length - 1]
    const rangeStart = weekBuckets[0].start

    // ── Core session + active program queries (parallel) ──────────────────────
    const [
      { data: completedSessions },
      { data: activeProgram },
    ] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id, session_date')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('session_date', rangeStart),
      supabase
        .from('user_programs')
        .select('current_phase_id, block_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const sessionIds = (completedSessions ?? []).map(s => s.id)
    const sessionDateMap: Record<string, string> = {}
    for (const s of completedSessions ?? []) sessionDateMap[s.id] = s.session_date

    // ── This-week session IDs ─────────────────────────────────────────────────
    const thisWeekSessionIds = (completedSessions ?? [])
      .filter(s => s.session_date >= thisWeek.start && s.session_date < thisWeek.end)
      .map(s => s.id)

    // ── Set queries (parallel, only when sessions exist) ──────────────────────
    let allSets: Array<{ session_id: string; actual_reps: number | null; weight_kg: number | null }> = []
    let setsWithExercise: any[] = []
    let e1rmSets: any[] = []
    let thisWeekLoggedSetsRaw: Array<{ exercise_id: string; exercise: { muscle_groups: string[] } | null }> = []

    if (sessionIds.length > 0) {
      const thisWeekQ = thisWeekSessionIds.length > 0
        ? supabase
            .from('workout_sets')
            .select('exercise_id, exercise:exercises(muscle_groups)')
            .in('session_id', thisWeekSessionIds)
            .eq('is_warmup', false)
        : Promise.resolve({ data: [] as any[], error: null })

      const [
        { data: sets },
        { data: exSets },
        { data: rawE1rmSets },
        { data: thisWeekRaw },
      ] = await Promise.all([
        supabase
          .from('workout_sets')
          .select('session_id, actual_reps, weight_kg')
          .in('session_id', sessionIds)
          .eq('is_warmup', false)
          .not('actual_reps', 'is', null)
          .not('weight_kg', 'is', null),
        supabase
          .from('workout_sets')
          .select('session_id, exercise_id, weight_kg, actual_reps, exercise:exercises(name)')
          .in('session_id', sessionIds)
          .eq('is_warmup', false)
          .not('weight_kg', 'is', null),
        supabase
          .from('workout_sets')
          .select('session_id, exercise_id, estimated_1rm, weight_kg, actual_reps, exercise:exercises(name, type)')
          .in('session_id', sessionIds)
          .eq('is_warmup', false)
          .not('estimated_1rm', 'is', null),
        thisWeekQ,
      ])

      allSets = sets ?? []
      setsWithExercise = exSets ?? []
      e1rmSets = (rawE1rmSets ?? []).filter((s: any) => s.exercise?.type === 'compound')
      thisWeekLoggedSetsRaw = thisWeekRaw ?? []
    }

    // ── Weekly volume by bucket ───────────────────────────────────────────────
    weeklyVolumes = weekBuckets.map(bucket => {
      const sessionsInWeek = (completedSessions ?? [])
        .filter(s => s.session_date >= bucket.start && s.session_date < bucket.end)
        .map(s => s.id)
      const volume = allSets
        .filter(s => sessionsInWeek.includes(s.session_id))
        .reduce((sum, s) => sum + (s.actual_reps ?? 0) * (s.weight_kg ?? 0), 0)
      return { label: bucket.label, volume: Math.round(volume), sessions: sessionsInWeek.length }
    })

    // ── Exercise weight progression ───────────────────────────────────────────
    if (setsWithExercise.length > 0) {
      const byExercise: Record<string, typeof setsWithExercise> = {}
      for (const s of setsWithExercise) {
        if (!byExercise[s.exercise_id]) byExercise[s.exercise_id] = []
        byExercise[s.exercise_id].push(s)
      }
      exerciseProgress = Object.entries(byExercise).map(([exercise_id, sets]) => {
        const sessionBest: Record<string, { weight_kg: number; actual_reps: number }> = {}
        for (const s of sets) {
          const sid = s.session_id
          if (!sessionBest[sid] || (s.weight_kg ?? 0) > sessionBest[sid].weight_kg)
            sessionBest[sid] = { weight_kg: s.weight_kg ?? 0, actual_reps: s.actual_reps ?? 0 }
        }
        const dataPoints = Object.entries(sessionBest)
          .map(([sid, best]) => ({ date: sessionDateMap[sid] ?? '', ...best }))
          .filter(d => d.date)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-10)
        return {
          exercise_id,
          exercise_name: (sets[0]?.exercise as any)?.name ?? 'Không xác định',
          dataPoints,
        }
      })
        .filter(e => e.dataPoints.length >= 2)
        .sort((a, b) => b.dataPoints.length - a.dataPoints.length)
        .slice(0, 12)
    }

    // ── e1RM time-series ──────────────────────────────────────────────────────
    if (e1rmSets.length > 0) {
      const byExercise: Record<string, typeof e1rmSets> = {}
      for (const s of e1rmSets) {
        if (!byExercise[s.exercise_id]) byExercise[s.exercise_id] = []
        byExercise[s.exercise_id].push(s)
      }
      e1rmProgress = Object.entries(byExercise).map(([exercise_id, sets]) => {
        const sessionBest: Record<string, { estimated_1rm: number; weight_kg: number; actual_reps: number }> = {}
        for (const s of sets) {
          const sid = s.session_id
          const e = s.estimated_1rm ?? 0
          if (!sessionBest[sid] || e > sessionBest[sid].estimated_1rm)
            sessionBest[sid] = { estimated_1rm: e, weight_kg: s.weight_kg ?? 0, actual_reps: s.actual_reps ?? 0 }
        }
        const dataPoints = Object.entries(sessionBest)
          .map(([sid, best]) => ({ date: sessionDateMap[sid] ?? '', ...best }))
          .filter(d => d.date && d.estimated_1rm > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-10)
        return {
          exercise_id,
          exercise_name: (sets[0]?.exercise as any)?.name ?? 'Không xác định',
          dataPoints,
        }
      })
        .filter(e => e.dataPoints.length >= 2)
        .sort((a, b) => b.dataPoints.length - a.dataPoints.length)
        .slice(0, 9)
    }

    // ── Audit data: phase plan + logged this week ─────────────────────────────
    if (activeProgram?.current_phase_id) {
      const [
        { data: phaseData },
        { data: rawPhaseExercises },
        { count: totalPhases },
      ] = await Promise.all([
        supabase
          .from('phases')
          .select('name, phase_order, block_id')
          .eq('id', activeProgram.current_phase_id)
          .maybeSingle(),
        // Include exercise muscle_groups for volume adequacy computation
        supabase
          .from('phase_exercises')
          .select('target_sets, target_rep_min, target_rep_max, exercise:exercises(muscle_groups)')
          .eq('phase_id', activeProgram.current_phase_id),
        supabase
          .from('phases')
          .select('id', { count: 'exact', head: true })
          .eq('block_id', activeProgram.block_id ?? ''),
      ])

      const phaseExercises: PhaseExerciseForAudit[] = (rawPhaseExercises ?? []).map((pe: any) => ({
        target_sets: pe.target_sets,
        target_rep_min: pe.target_rep_min,
        target_rep_max: pe.target_rep_max,
        exercise: pe.exercise as { muscle_groups: string[] } | null,
      }))

      // ── Rep zone counts ───────────────────────────────────────────────────
      const thisWeekAllSets = allSets.filter(s => thisWeekSessionIds.includes(s.session_id))
      const loggedCounts = countLoggedZones(thisWeekAllSets)
      const programmedCounts = countProgrammedZones(phaseExercises)

      let phaseCategory: 'volume' | 'load' | 'peak' | 'other' = 'other'
      if (phaseData) {
        repZonePhaseName = phaseData.name
        phaseCategory = classifyPhaseCategory(
          phaseData.phase_order,
          totalPhases ?? phaseData.phase_order,
          phaseData.name,
        )
      }

      const goal = repZonePhaseName
        ? detectPhaseGoal(repZonePhaseName, phaseCategory)
        : 'mixed'

      repZoneAudit = auditRepZones(loggedCounts, programmedCounts, goal)

      // ── Muscle volume adequacy ────────────────────────────────────────────
      // Build logged-by-exercise from this week's sets (group by exercise_id)
      const loggedByExId: Record<string, { setCount: number; muscle_groups: string[] }> = {}
      for (const s of thisWeekLoggedSetsRaw) {
        const muscles = (s.exercise as any)?.muscle_groups ?? []
        if (!loggedByExId[s.exercise_id]) {
          loggedByExId[s.exercise_id] = { setCount: 0, muscle_groups: muscles }
        }
        loggedByExId[s.exercise_id].setCount++
      }
      const loggedByExercise: LoggedExerciseForAudit[] = Object.values(loggedByExId)

      volumeAdequacy = computeMuscleVolumes(phaseExercises, loggedByExercise)
    }

  } catch (err) {
    console.error('Progress page data error:', err)
  }

  const totalVolume  = weeklyVolumes.reduce((s, w) => s + w.volume, 0)
  const totalSessions = weeklyVolumes.reduce((s, w) => s + w.sessions, 0)
  const activWeeks   = weeklyVolumes.filter(w => w.volume > 0).length

  // Only show the audit card when we have the rep zone data
  const showAudit = repZoneAudit !== null

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">Thống kê chi tiết</p>
        <h1 className="text-2xl font-bold text-ink">Tiến độ</h1>
        <p className="text-sm text-ink/50 mt-1">Theo dõi khối lượng tập luyện và sức mạnh trong 8 tuần qua.</p>
      </div>

      {/* ── Summary stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card accent="herb">
          <CardHeader><CardTitle>Khối lượng 8 tuần</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold text-ink">
              {totalVolume > 0 ? `${(totalVolume / 1000).toFixed(1)}t` : '—'}
            </p>
            <p className="text-xs text-ink/40 mt-1">Hiệp × Số lần × Mức tạ</p>
          </CardBody>
        </Card>
        <Card accent="slate">
          <CardHeader><CardTitle>Số buổi tập</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold text-ink">{totalSessions}</p>
            <p className="text-xs text-ink/40 mt-1">Buổi tập đã hoàn thành</p>
          </CardBody>
        </Card>
        <Card accent="amber">
          <CardHeader><CardTitle>Tuần hoạt động</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xl font-bold text-ink">{activWeeks} / 8</p>
            <p className="text-xs text-ink/40 mt-1">Số tuần đã ghi nhận dữ liệu</p>
          </CardBody>
        </Card>
      </div>

      {/* ── Weekly volume chart ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Khối lượng tập luyện hàng tuần</CardTitle></CardHeader>
        <CardBody>
          {weeklyVolumes.every(w => w.volume === 0) ? (
            <p className="text-sm text-center text-ink/40 py-8">
              Chưa có buổi tập nào hoàn thành. Hãy bắt đầu ghi nhật ký để xem xu hướng khối lượng tập luyện của bạn.
            </p>
          ) : (
            <VolumeChart data={weeklyVolumes} />
          )}
        </CardBody>
      </Card>

      {/* ── Combined Program Audit Card ─────────────────────────────────────── */}
      {showAudit && repZoneAudit && (
        <Card accent="herb">
          <ProgramAuditCard
            repZoneAudit={repZoneAudit}
            volumeResult={volumeAdequacy ?? { muscleVolumes: [], insufficientCount: 0, optimalCount: 0, excessiveCount: 0 }}
            phaseName={repZonePhaseName || 'Giai đoạn hiện tại'}
          />
        </Card>
      )}

      {/* ── e1RM progression ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-ink/50 uppercase tracking-wide">
            Sức mạnh tối đa ước tính — e1RM
          </h2>
          <p className="text-xs text-ink/35 mt-1">
            Công thức Brzycki: tạ / (1.0278 − 0.0278 × (reps + RIR)) — chỉ bài phức hợp có RIR.
          </p>
        </div>
        {e1rmProgress.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-center text-ink/40 py-6">
                Ghi nhận ít nhất 2 buổi tập bài phức hợp có RIR để hiển thị đồ thị e1RM.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {e1rmProgress.map(ex => (
              <E1rmChart key={ex.exercise_id} exerciseName={ex.exercise_name} dataPoints={ex.dataPoints} />
            ))}
          </div>
        )}
      </section>

      {/* ── Exercise weight progression ─────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-ink/50 uppercase tracking-wide mb-4">
          Tiến trình sức mạnh — Thành tích cao nhất
        </h2>
        {exerciseProgress.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-center text-ink/40 py-6">
                Ghi nhận ít nhất 2 buổi tập cho mỗi bài để hiển thị xu hướng phát triển sức mạnh.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {exerciseProgress.map(ex => (
              <ExerciseProgress key={ex.exercise_id} exerciseName={ex.exercise_name} dataPoints={ex.dataPoints} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
