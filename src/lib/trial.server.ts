// ─── Trial (Trải nghiệm) — server-side clock control ─────────────────────────
// Starting the 5-hour window is a WRITE to profiles, and profiles has no
// self-UPDATE RLS policy (see 007_add_coach_role.sql: every profile write goes
// through the service-role client). So this module owns its own admin client.
//
// It deliberately does NOT import `@/lib/supabase/server`: that module imports
// `next/headers`, which must never be pulled into `src/proxy.ts`.

import { createClient } from '@supabase/supabase-js'
import { freshTrialWindow, trialState, type TrialFields } from '@/lib/trial'

function adminClient() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/**
 * Start the 5-hour window for a trial account that is still 'pending'
 * (switched on, clock never started).
 *
 * Called from the proxy on every authenticated request, which is the ONLY place
 * that sees every way into the app. Login itself cannot be that place: the
 * login form signs in with the BROWSER Supabase client (no server round-trip),
 * so an "on first login" hook in an API route never runs and the account would
 * sit at "Chờ đăng nhập" forever.
 *
 * Returns the profile as it should now be read — with the fresh expiry patched
 * in when the clock was just started — so the caller can gate on it right away
 * instead of waiting for the next request.
 *
 * Best-effort: any failure (missing service key, migration 008 not yet run)
 * returns the profile untouched. The account stays 'pending', i.e. allowed in —
 * never locked out because a bookkeeping write failed.
 */
export async function startTrialClockIfPending<T extends TrialFields>(
  userId: string,
  profile: T,
): Promise<T> {
  if (trialState(profile) !== 'pending') return profile

  const admin = adminClient()
  if (!admin) return profile

  const window = freshTrialWindow()
  try {
    const { error } = await admin
      .from('profiles')
      .update(window)
      // Only claim the window if nobody else already did (concurrent requests
      // on first load — a page plus its prefetches all hit the proxy at once).
      .eq('id', userId)
      .is('trial_expires_at', null)
    if (error) return profile
  } catch {
    return profile
  }

  return { ...profile, ...window }
}
