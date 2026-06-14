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

export type TrialState = 'active' | 'expired' | 'disabled'

/**
 * Resolve a trial account's current state. Returns null for non-trial roles.
 *   • 'disabled' — admin switched it off (trial_active === false)
 *   • 'expired'  — the 5-hour window has elapsed (or was never set)
 *   • 'active'   — switched on AND still within the window
 */
export function trialState(p: TrialFields): TrialState | null {
  if (p.role !== 'trial') return null
  if (p.trial_active === false) return 'disabled'
  if (!p.trial_expires_at) return 'expired'
  return new Date(p.trial_expires_at).getTime() > Date.now() ? 'active' : 'expired'
}

/** True when a profile may currently access the app (always true for non-trial). */
export function trialIsActive(p: TrialFields): boolean {
  const s = trialState(p)
  return s === null || s === 'active'
}

/** Build the trial fields for a freshly (re)activated account: now + 5h, switched on. */
export function freshTrialWindow(): { trial_active: true; trial_expires_at: string } {
  return {
    trial_active: true,
    trial_expires_at: new Date(Date.now() + TRIAL_DURATION_HOURS * 60 * 60 * 1000).toISOString(),
  }
}
