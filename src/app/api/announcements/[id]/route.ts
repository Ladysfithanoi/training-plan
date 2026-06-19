import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * PATCH /api/announcements/[id]
 * Body: { title?, content?, image_url? }
 * Edits an existing announcement. Admin only. The post date is never changed.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params

  let body: { title?: string; content?: string; image_url?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ — body phải là JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'Tiêu đề không được để trống.' }, { status: 400 })
    update.title = title
  }
  if (body.content !== undefined) {
    const content = body.content.trim()
    if (!content) return NextResponse.json({ error: 'Nội dung không được để trống.' }, { status: 400 })
    update.content = content
  }
  if (body.image_url !== undefined) update.image_url = body.image_url

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Không có thay đổi nào để lưu.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('announcements')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Không tìm thấy tin.' }, { status: 404 })
  return NextResponse.json({ announcement: data })
}

/**
 * DELETE /api/announcements/[id]
 * Removes an announcement. Admin only.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const admin = createAdminClient()
  const { error } = await admin.from('announcements').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
