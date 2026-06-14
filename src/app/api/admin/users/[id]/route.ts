import { requireStaff } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { freshTrialWindow } from '@/lib/trial'
import type { Profile } from '@/types'

/**
 * Verify the caller may manage the target user.
 * Admins may manage anyone; coaches only students they created.
 * Returns the caller + target profile, or a Response to short-circuit.
 */
async function guardTarget(id: string) {
  let caller
  try {
    caller = await requireStaff()
  } catch {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('profiles')
    .select('id, role, created_by')
    .eq('id', id)
    .maybeSingle()

  if (!target) return { error: Response.json({ error: 'Not found' }, { status: 404 }) }

  if (caller.role !== 'admin' && target.created_by !== caller.id) {
    return {
      error: Response.json(
        { error: 'Bạn chỉ có thể quản lý học viên của mình.' },
        { status: 403 },
      ),
    }
  }

  return { caller, target: target as Pick<Profile, 'id' | 'role' | 'created_by'>, admin }
}

/** DELETE /api/admin/users/[id] */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/admin/users/[id]'>,
) {
  const { id } = await ctx.params
  const guard = await guardTarget(id)
  if (guard.error) return guard.error

  const { error } = await guard.admin.auth.admin.deleteUser(id)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}

/** PATCH /api/admin/users/[id] — update name / role */
export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/admin/users/[id]'>,
) {
  const { id } = await ctx.params
  const guard = await guardTarget(id)
  if (guard.error) return guard.error

  const body = await request.json()

  const updatePayload: Record<string, unknown> = {}
  if (body.full_name !== undefined) updatePayload.full_name = body.full_name
  // Only admins may change roles; a coach's student stays a 'user'.
  if (body.role !== undefined && guard.caller.role === 'admin') {
    updatePayload.role = body.role
    // Only touch the trial_* columns when 'trial' is actually involved on one
    // side of the transition. This keeps ordinary role edits (user↔coach↔admin)
    // from referencing columns that migration 008 may not have added yet.
    if (body.role === 'trial' && guard.target.role !== 'trial') {
      // Promoting to trial → open a fresh 5-hour window.
      Object.assign(updatePayload, freshTrialWindow())
    } else if (body.role !== 'trial' && guard.target.role === 'trial') {
      // Demoting away from trial → clear the window fields.
      updatePayload.trial_active = null
      updatePayload.trial_expires_at = null
    }
  }

  // ── Trial activation control (admin only) ─────────────────────────────────
  // 'activate'   → switch on + reset the 5-hour window (now + 5h).
  // 'deactivate' → switch off immediately (account can no longer access).
  if (body.trial_action !== undefined && guard.caller.role === 'admin') {
    if (body.trial_action === 'activate') {
      Object.assign(updatePayload, freshTrialWindow())
    } else if (body.trial_action === 'deactivate') {
      updatePayload.trial_active = false
    }
  }

  const { data, error } = await guard.admin
    .from('profiles')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ profile: data })
}
