import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/** Server Supabase client — uses the anon key + user session cookies */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component — ignore; middleware handles refresh
          }
        },
      },
    },
  )
}

/**
 * Admin Supabase client — uses the service-role key, bypasses RLS.
 *
 * IMPORTANT: uses `createClient` from `@supabase/supabase-js` (NOT the SSR
 * wrapper) so that `auth.admin.*` methods (createUser, deleteUser, etc.) are
 * fully available. The `@supabase/ssr` wrapper is for cookie-based user
 * sessions; it does not reliably expose the Admin Auth API.
 *
 * Only call this from server-side code (API routes, Server Actions, cron jobs).
 * Never expose the service-role key to the browser.
 */
export function createAdminClient() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.',
    )
  }

  if (!serviceKey || serviceKey === 'your-service-role-key-here') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Copy it from Supabase Dashboard → Project Settings → API → service_role and add it to .env.local.',
    )
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      // Disable cookie/token persistence — this client is stateless and
      // authenticates every request with the service-role key directly.
      autoRefreshToken: false,
      persistSession:   false,
      detectSessionInUrl: false,
    },
  })
}
