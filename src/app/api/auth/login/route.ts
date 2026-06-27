import { createClient, createAdminClient } from '@/lib/supabase/server'
import { freshTrialWindow } from '@/lib/trial'

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

  // ── Start the trial (Trải nghiệm) clock on the FIRST login ──────────────────
  // Test accounts are created "pending": trial_active = true but
  // trial_expires_at = null. The 5-hour window begins counting only from this
  // first sign-in — set it once and never reset it on later logins, so the
  // countdown keeps running continuously across sessions. Non-fatal on failure:
  // login still succeeds and the proxy gate keeps protecting access.
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role, trial_active, trial_expires_at')
      .eq('id', data.user.id)
      .single()
    if (
      profile?.role === 'trial' &&
      profile.trial_active !== false &&
      !profile.trial_expires_at
    ) {
      await admin.from('profiles').update(freshTrialWindow()).eq('id', data.user.id)
    }
  } catch {
    /* trial columns missing or update failed — ignore, login still valid */
  }

  return Response.json({ user: data.user })
}
