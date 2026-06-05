/**
 * LiveWorkoutFeed — server component
 * Fetches completed/in-progress sessions from the last 60 days across the
 * coach's athletes, then hands them to a client list that paginates 5 per page.
 * Displayed on the coach dashboard (/admin).
 */
import { createClient } from '@/lib/supabase/server'
import { LiveWorkoutFeedList, type FeedSession } from './LiveWorkoutFeedList'

// Only surface activity from the last 60 days in the dashboard feed.
const FEED_WINDOW_DAYS = 60

export async function LiveWorkoutFeed() {
  const supabase = await createClient()

  const cutoff = new Date(Date.now() - FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const { data } = await supabase
    .from('workout_sessions')
    .select(`
      id, session_date, status,
      next_week_suggestion, survey_performance, survey_rir_feel, survey_recovery,
      profile:profiles!user_id(id, full_name, email),
      sets:workout_sets(count)
    `)
    .in('status', ['in_progress', 'completed'])
    .gte('session_date', cutoff)
    .order('session_date', { ascending: false })
    .limit(100)

  // Supabase infers the join as an array; cast through unknown to our typed shape
  const sessions = (data ?? []) as unknown as FeedSession[]

  return <LiveWorkoutFeedList sessions={sessions} />
}
