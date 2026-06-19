import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AthleteDetailTabs } from './_components/AthleteDetailTabs'
import { computeWeeklyVolumes } from '@/lib/volumeLoad'
import type { WeeklyVolumePoint } from '@/lib/volumeLoad'
import type { Profile, PhaseExercise, Exercise } from '@/types'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: 'Tiến độ học viên' }
}

export default async function AthleteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // ── Athlete profile ────────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!profile || profile.role !== 'user') notFound()

  // ── Active user_program with block + phase ─────────────────────────────────
  const { data: userProgram } = await supabase
    .from('user_programs')
    .select(`
      id, start_date, phase_start_date, status, notes, current_phase_id,
      block:training_blocks(id, name, description, total_mesocycles),
      current_phase:phases(
        id, name, phase_order, phase_type, duration_weeks,
        frequency_per_week, rep_ranges, target_set_reduction_factor,
        includes_deload, max_rir, max_weight_percent
      )
    `)
    .eq('user_id', id)
    .eq('status', 'active')
    .maybeSingle()

  // ── Phase exercises ────────────────────────────────────────────────────────
  let phaseExercises: PhaseExercise[] = []
  if (userProgram?.current_phase_id) {
    const { data } = await supabase
      .from('phase_exercises')
      .select('*, exercise:exercises(*)')
      .eq('phase_id', userProgram.current_phase_id)
    // Per-week (migration 011): show the BASE program here; week-specific
    // override rows are excluded from this coaching overview.
    phaseExercises = ((data ?? []) as PhaseExercise[])
      .filter(pe => (pe.week_number ?? null) === null)
  }

  // ── Recent sessions with all logged sets ──────────────────────────────────
  // Limit 40 sessions × ~25 sets = ~1 000 rows — manageable for a coaching view
  const { data: rawSessions } = await supabase
    .from('workout_sessions')
    .select(`
      id, session_date, status, overall_rir,
      next_week_suggestion, survey_performance, survey_rir_feel, survey_recovery,
      sets:workout_sets(
        id, set_number, actual_reps, weight_kg, rir, rpe, is_warmup, estimated_1rm,
        exercise:exercises(id, name, type)
      )
    `)
    .eq('user_id', id)
    .order('session_date', { ascending: false })
    .limit(40)

  const sessions = rawSessions ?? []

  // ── Weekly volume data (server-computed, passed to the Tiến độ tab) ──────────
  const weeklyVolumeData: WeeklyVolumePoint[] = computeWeeklyVolumes(
    sessions.map(s => ({
      session_date: s.session_date,
      status:       s.status,
      sets: (s.sets ?? []).map((set: {
        actual_reps: number | null
        weight_kg:   number | null
        is_warmup:   boolean
      }) => ({
        actual_reps: set.actual_reps,
        weight_kg:   set.weight_kg,
        is_warmup:   set.is_warmup,
      })),
    })),
  )

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm text-ink/40">
        <Link href="/admin/users" className="hover:text-ink transition-colors">
          Học viên
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">
          {(profile as Profile).full_name ?? (profile as Profile).email}
        </span>
      </div>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-ink/8 flex items-center justify-center text-lg font-bold text-ink shrink-0">
            {((profile as Profile).full_name ?? (profile as Profile).email)[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">
              {(profile as Profile).full_name ?? '—'}
            </h1>
            <p className="text-sm text-ink/45">{(profile as Profile).email}</p>
          </div>
        </div>
        <Link
          href="/admin/users"
          className="shrink-0 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/50 hover:text-ink hover:border-ink/30 transition-colors"
        >
          ← Quay lại
        </Link>
      </div>

      {/* ── Tabbed detail view ─────────────────────────────────────────────── */}
      <AthleteDetailTabs
        userProgram={userProgram as never}
        phaseExercises={phaseExercises}
        sessions={sessions as never}
        weeklyVolumeData={weeklyVolumeData}
      />
    </div>
  )
}
