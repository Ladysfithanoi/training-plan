import { createAdminClient } from '@/lib/supabase/server'
import { ANNOUNCEMENT_EXPIRY_HOURS } from '@/lib/announcements'
import type { Announcement } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Delete every announcement older than the expiry window. Best-effort. */
export async function purgeExpiredAnnouncements(admin: AdminClient): Promise<void> {
  const cutoff = new Date(Date.now() - ANNOUNCEMENT_EXPIRY_HOURS * 3_600_000).toISOString()
  await admin.from('announcements').delete().lt('created_at', cutoff)
}

/**
 * Purge expired rows, then return the most recent announcements (newest first).
 * Pass `limit` to cap the result (e.g. the 3-card guide board).
 *
 * Resilient by design: returns [] on ANY failure — missing service-role key, or
 * the table not existing yet (migration 010 is run by hand AFTER deploy). The
 * board simply stays empty until the migration lands.
 */
export async function listAnnouncements(limit?: number): Promise<Announcement[]> {
  try {
    const admin = createAdminClient()
    await purgeExpiredAnnouncements(admin)
    let query = admin
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    if (limit) query = query.limit(limit)
    const { data } = await query
    return (data ?? []) as Announcement[]
  } catch {
    return []
  }
}
