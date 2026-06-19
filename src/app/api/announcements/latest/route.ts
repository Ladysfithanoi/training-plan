import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { purgeExpiredAnnouncements } from '@/lib/announcements.server'

/**
 * GET /api/announcements/latest
 * Returns the newest announcement's created_at (or null) so the sidebar can show
 * a "có tin mới" dot when it's newer than what this user last viewed. Staff only.
 * Resilient: returns { latest: null } if the table doesn't exist yet.
 */
export async function GET() {
  try {
    await requireStaff()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const admin = createAdminClient()
    await purgeExpiredAnnouncements(admin)
    const { data } = await admin
      .from('announcements')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return NextResponse.json({ latest: data?.created_at ?? null })
  } catch {
    return NextResponse.json({ latest: null })
  }
}
