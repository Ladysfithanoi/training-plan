import { batchAdvanceExpiredPhases } from '@/lib/transitions'

/**
 * POST /api/cron/check-transitions
 * Called daily by Vercel Cron at 02:00 UTC.
 * Advances every user whose current phase has expired.
 */
export async function POST(request: Request) {
  // Validate Vercel Cron auth header
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await batchAdvanceExpiredPhases()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('Cron transition error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Allow Vercel Cron to call this with GET too
export { POST as GET }
