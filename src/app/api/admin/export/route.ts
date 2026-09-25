// Route-local admin client — same reasoning as /api/admin/users: reading the
// service-role key inside the route file keeps it in the Node.js API runtime.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { todayISO } from '@/lib/date'

/**
 * GET /api/admin/export — tải toàn bộ dữ liệu của app thành một file JSON.
 *
 * Dùng để sao lưu / chuyển dữ liệu sang app mới mà không phải nhập lại từ đầu.
 * Chỉ Quản trị viên (admin) được gọi, vì file chứa dữ liệu của MỌI HLV và học viên.
 *
 * Các bảng được liệt kê theo thứ tự phụ thuộc khoá ngoại (bảng cha trước bảng
 * con), nên khi nhập vào database mới chỉ cần chèn lần lượt từ trên xuống.
 * Mật khẩu không xuất được (Supabase chỉ lưu bản băm) — tài khoản ở app mới
 * cần được tạo lại hoặc đặt lại mật khẩu.
 */

// Parent tables first, children after.
const TABLES = [
  'profiles',
  'movement_patterns',
  'exercises',
  'training_blocks',
  'phases',
  'phase_exercises',
  'workout_days',
  'day_exercises',
  'user_programs',
  'workout_sessions',
  'workout_sets',
  'announcements',
] as const

// Supabase caps a single select at 1000 rows — page through every table.
const PAGE_SIZE = 1000

function buildAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

async function fetchAllRows(supabase: SupabaseClient, table: string) {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

/** Login accounts (auth.users) — email + metadata, without password hashes. */
async function fetchAuthUsers(supabase: SupabaseClient) {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(`auth.users: ${error.message}`)
    users.push(
      ...data.users.map(u => ({
        id:                 u.id,
        email:              u.email ?? null,
        phone:              u.phone ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        created_at:         u.created_at,
        last_sign_in_at:    u.last_sign_in_at ?? null,
        user_metadata:      u.user_metadata,
        app_metadata:       u.app_metadata,
      })),
    )
    if (data.users.length < PAGE_SIZE) return users
  }
}

export async function GET() {
  let caller
  try {
    caller = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = buildAdminClient()
  if (!supabase) {
    console.error('[GET /api/admin/export] Missing SUPABASE_SERVICE_ROLE_KEY or URL')
    return NextResponse.json({ error: 'Thiếu cấu hình máy chủ' }, { status: 500 })
  }

  try {
    const [authUsers, ...tableRows] = await Promise.all([
      fetchAuthUsers(supabase),
      ...TABLES.map(t => fetchAllRows(supabase, t)),
    ])

    const tables = Object.fromEntries(TABLES.map((t, i) => [t, tableRows[i]]))
    const counts = Object.fromEntries(TABLES.map((t, i) => [t, tableRows[i].length]))

    const payload = {
      app:         'training-plan',
      format:      1,
      exported_at: new Date().toISOString(),
      exported_by: caller.email,
      table_order: TABLES,
      counts:      { auth_users: authUsers.length, ...counts },
      auth_users:  authUsers,
      tables,
    }

    const filename = `training-plan-backup-${todayISO()}.json`
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type':        'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    console.error('[GET /api/admin/export]', err)
    const message = err instanceof Error ? err.message : 'Lỗi không xác định'
    return NextResponse.json({ error: `Không xuất được dữ liệu: ${message}` }, { status: 500 })
  }
}
