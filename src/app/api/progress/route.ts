import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/progress
 * Returns:
 *  - weeklyVolumes: last 8 weeks of total training volume
 *  - exerciseProgress: weight progression per exercise (last 10 sets per exercise)
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const weeks = Math.min(Number(searchParams.get('weeks') ?? 8), 16)

  // ── Weekly volume ──────────────────────────────────────────────────────────
  // Build Monday boundaries for the last `weeks` calendar weeks
  const weekBuckets: Array<{ label: string; start: string; end: string }> = []
  const now = new Date()
  // Find this week's Monday
  const dayOfWeek = now.getDay() // 0=Sun
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
  monday.setHours(0, 0, 0, 0)

  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(monday)
    start.setDate(monday.getDate() - i * 7)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)

    // e.g. "W19" or "May 27"
    const label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    weekBuckets.push({
      label,
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    })
  }

  // Fetch all completed sessions in range
  const rangeStart = weekBuckets[0].start
  const { data: completedSessions } = await supabase
    .from('workout_sessions')
    .select('id, session_date')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .gte('session_date', rangeStart)

  const sessionIds = (completedSessions ?? []).map(s => s.id)
  const sessionDateMap: Record<string, string> = {}
  for (const s of completedSessions ?? []) sessionDateMap[s.id] = s.session_date

  // Fetch sets for those sessions
  let allSets: Array<{ session_id: string; actual_reps: number | null; weight_kg: number | null }> = []
  if (sessionIds.length > 0) {
    const { data: sets } = await supabase
      .from('workout_sets')
      .select('session_id, actual_reps, weight_kg')
      .in('session_id', sessionIds)
      .eq('is_warmup', false)
      .not('actual_reps', 'is', null)
      .not('weight_kg', 'is', null)
    allSets = sets ?? []
  }

  // Bucket volume by week
  const weeklyVolumes = weekBuckets.map(bucket => {
    const sessionsInWeek = (completedSessions ?? [])
      .filter(s => s.session_date >= bucket.start && s.session_date < bucket.end)
      .map(s => s.id)

    const volume = allSets
      .filter(s => sessionsInWeek.includes(s.session_id))
      .reduce((sum, s) => sum + (s.actual_reps ?? 0) * (s.weight_kg ?? 0), 0)

    return { label: bucket.label, volume: Math.round(volume), sessions: sessionsInWeek.length }
  })

  // ── Exercise weight progression ────────────────────────────────────────────
  // For each exercise the user has logged, get the last 10 working sets (heaviest per session)
  let exerciseProgress: Array<{
    exercise_id: string
    exercise_name: string
    dataPoints: Array<{ date: string; weight_kg: number; actual_reps: number }>
  }> = []

  if (sessionIds.length > 0) {
    const { data: setsWithExercise } = await supabase
      .from('workout_sets')
      .select('session_id, exercise_id, weight_kg, actual_reps, exercise:exercises(name)')
      .in('session_id', sessionIds)
      .eq('is_warmup', false)
      .not('weight_kg', 'is', null)
      .order('weight_kg', { ascending: false })

    if (setsWithExercise) {
      // Group by exercise
      const byExercise: Record<string, typeof setsWithExercise> = {}
      for (const s of setsWithExercise) {
        if (!byExercise[s.exercise_id]) byExercise[s.exercise_id] = []
        byExercise[s.exercise_id].push(s)
      }

      exerciseProgress = Object.entries(byExercise).map(([exercise_id, sets]) => {
        // Get heaviest set per session, sorted by date
        const sessionBest: Record<string, { weight_kg: number; actual_reps: number }> = {}
        for (const s of sets) {
          const sid = s.session_id
          if (!sessionBest[sid] || (s.weight_kg ?? 0) > sessionBest[sid].weight_kg) {
            sessionBest[sid] = { weight_kg: s.weight_kg ?? 0, actual_reps: s.actual_reps ?? 0 }
          }
        }

        const dataPoints = Object.entries(sessionBest)
          .map(([sid, best]) => ({
            date: sessionDateMap[sid] ?? '',
            ...best,
          }))
          .filter(d => d.date)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-10)

        const exerciseName = (sets[0]?.exercise as any)?.name ?? 'Unknown'

        return {
          exercise_id,
          exercise_name: exerciseName,
          dataPoints,
        }
      }).filter(e => e.dataPoints.length >= 2) // only exercises with a progression to show
        .sort((a, b) => b.dataPoints.length - a.dataPoints.length)
        .slice(0, 10) // top 10 exercises by data richness
    }
  }

  return Response.json({ weeklyVolumes, exerciseProgress })
}
