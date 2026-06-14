import { createClient } from '@/lib/supabase/server'
import { trialIsActive } from '@/lib/trial'
import type { Profile } from '@/types'

/** Returns the authenticated user's profile, or null */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return data as Profile | null
}

/** Throws if the current user is not an admin */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') {
    throw new Error('Forbidden: admin access required')
  }
  return profile
}

/**
 * Throws if the current user is not staff. "Staff" = admin, coach (HLV), or an
 * *active* trial (Trải nghiệm) account. A trial whose 5-hour window has elapsed
 * or that an admin has switched off is rejected here too.
 *
 * Trial accounts get the coach UI shell + may manage their own students and
 * assign existing blocks — but NOT author content (see requireContentAuthor).
 */
export async function requireStaff(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'coach' && profile.role !== 'trial')) {
    throw new Error('Forbidden: staff access required')
  }
  if (profile.role === 'trial' && !trialIsActive(profile)) {
    throw new Error('Forbidden: trial expired')
  }
  return profile
}

/**
 * Throws unless the caller may author shared content — i.e. create / edit
 * training blocks (Khối tập), phases (Chương trình tập) and the exercise bank.
 * Only admins and coaches qualify; trial accounts are read-only on content.
 */
export async function requireContentAuthor(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'coach')) {
    throw new Error('Forbidden: content author access required')
  }
  return profile
}

/** Throws if there is no authenticated user */
export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) {
    throw new Error('Unauthorized')
  }
  return profile
}
