import { createClient } from '@/lib/supabase/server'
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

/** Throws if there is no authenticated user */
export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) {
    throw new Error('Unauthorized')
  }
  return profile
}
