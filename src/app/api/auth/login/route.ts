import { createClient } from '@/lib/supabase/server'
import { startTrialClockIfPending } from '@/lib/trial.server'

/**
 * Server-side email+password sign-in.
 *
 * NOTE: the app's own login form does NOT use this route — it signs in with the
 * browser Supabase client (see (auth)/login/_components/LoginForm.tsx). This
 * route exists for non-browser callers. Because of that, the trial (Trải
 * nghiệm) 5-hour clock is NOT started here: the authoritative place is
 * `src/proxy.ts`, which runs on every authenticated request regardless of how
 * the session was obtained. The call below is only so this path behaves the
 * same as the form — it is a no-op once the proxy has already started it.
 */
export async function POST(request: Request) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return Response.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return Response.json({ error: error.message }, { status: 401 })
  }

  // Non-fatal: login still succeeds and the proxy gate keeps protecting access.
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, trial_active, trial_expires_at')
      .eq('id', data.user.id)
      .single()
    if (profile) await startTrialClockIfPending(data.user.id, profile)
  } catch {
    /* trial columns missing or update failed — ignore, login still valid */
  }

  return Response.json({ user: data.user })
}
