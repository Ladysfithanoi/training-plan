'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client — safe to use in Client Components.
 * Falls back to placeholder values during SSR/build when env vars are absent;
 * at runtime the real values are always present.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
  )
}
