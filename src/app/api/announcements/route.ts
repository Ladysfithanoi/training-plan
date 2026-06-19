import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { ANNOUNCEMENT_MAX_ITEMS } from '@/lib/announcements'
import { purgeExpiredAnnouncements } from '@/lib/announcements.server'

/**
 * GET /api/announcements
 * Returns all current announcements (newest first) for the admin manager.
 * Expired rows are swept first. Admin only.
 */
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  await purgeExpiredAnnouncements(admin)

  const { data, error } = await admin
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announcements: data ?? [] })
}

/**
 * POST /api/announcements
 * Body: { title, content, image_url? }
 * Creates an announcement. The date is set automatically (created_at = now()).
 * Admin only. Rejected once the table already holds ANNOUNCEMENT_MAX_ITEMS rows.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let title: string, content: string, image_url: string | null
  try {
    const body = await request.json()
    title = (body.title ?? '').trim()
    content = (body.content ?? '').trim()
    image_url = body.image_url ?? null
  } catch {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ — body phải là JSON' }, { status: 400 })
  }

  if (!title || !content) {
    return NextResponse.json({ error: 'Tiêu đề và nội dung là bắt buộc.' }, { status: 400 })
  }

  const admin = createAdminClient()
  // Sweep expired rows first so the cap reflects only live announcements.
  await purgeExpiredAnnouncements(admin)

  const { count, error: countError } = await admin
    .from('announcements')
    .select('id', { count: 'exact', head: true })

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  if ((count ?? 0) >= ANNOUNCEMENT_MAX_ITEMS) {
    return NextResponse.json(
      { error: `Đã đạt tối đa ${ANNOUNCEMENT_MAX_ITEMS} tin. Hãy xoá bớt một tin cũ trước khi thêm mới.` },
      { status: 409 },
    )
  }

  const { data, error } = await admin
    .from('announcements')
    .insert({ title, content, image_url, created_by: caller.id })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announcement: data }, { status: 201 })
}
