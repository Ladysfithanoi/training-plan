// ─── Trial (Trải nghiệm) role helpers ────────────────────────────────────────
// Pure, dependency-free utilities shared by the proxy (edge), server auth, and
// client UI. Keep this module free of server-only imports so `src/proxy.ts`
// can import it.

/** How long a trial account stays usable after each activation. */
export const TRIAL_DURATION_HOURS = 5

/** Minimal shape needed to evaluate a trial account's access. */
export interface TrialFields {
  role?: string | null
  /** Admin-controlled on/off switch. */
  trial_active?: boolean | null
  /** ISO timestamp when the current 5-hour window ends. */
  trial_expires_at?: string | null
}

export type TrialState = 'pending' | 'active' | 'expired' | 'disabled'

/**
 * Resolve a trial account's current state. Returns null for non-trial roles.
 *   • 'disabled' — admin switched it off (trial_active === false)
 *   • 'pending'  — switched on but the 5-hour clock hasn't started yet. The
 *                  window only begins counting from the account's FIRST login
 *                  (set in /api/auth/login), so a created-but-never-logged-in
 *                  test account is allowed in until then.
 *   • 'expired'  — the 5-hour window has elapsed
 *   • 'active'   — switched on AND still within the window
 */
export function trialState(p: TrialFields): TrialState | null {
  if (p.role !== 'trial') return null
  if (p.trial_active === false) return 'disabled'
  if (!p.trial_expires_at) return 'pending'
  return new Date(p.trial_expires_at).getTime() > Date.now() ? 'active' : 'expired'
}

/** True when a profile may currently access the app (always true for non-trial). */
export function trialIsActive(p: TrialFields): boolean {
  const s = trialState(p)
  return s === null || s === 'active' || s === 'pending'
}

/**
 * Trial fields for a freshly created test account that hasn't logged in yet:
 * switched ON, but the 5-hour clock is NOT started. The window begins counting
 * only from the first login (see /api/auth/login), so admins can prepare a test
 * account in advance without burning the window before the tester arrives.
 */
export function pendingTrialWindow(): { trial_active: true; trial_expires_at: null } {
  return { trial_active: true, trial_expires_at: null }
}

/**
 * Build the trial fields that START the 5-hour clock now (now + 5h, switched on).
 * Used on the account's first login and by the admin "kích hoạt lại" action.
 */
export function freshTrialWindow(): { trial_active: true; trial_expires_at: string } {
  return {
    trial_active: true,
    trial_expires_at: new Date(Date.now() + TRIAL_DURATION_HOURS * 60 * 60 * 1000).toISOString(),
  }
}
