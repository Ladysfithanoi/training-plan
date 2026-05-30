import { createAdminClient } from '@/lib/supabase/server'

/**
 * Resolves a magic token to the owning user's ID.
 * Returns null if the token is invalid, expired, or the column doesn't exist yet.
 * Uses the admin client (bypasses RLS) for a fast, indexed lookup.
 */
export async function resolveGuestToken(token: string): Promise<string | null> {
  if (!token || token.length < 8) return null
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('magic_token', token)
      .maybeSingle()
    return data?.id ?? null
  } catch {
    // Service role key not configured, or column doesn't exist yet
    return null
  }
}

/**
 * Generates a URL-safe slug token from an athlete's name + random suffix.
 * e.g. "Nguyễn Thị Hoa" → "nguyen-thi-hoa-program-a7k2m9p4"
 *
 * Handles Vietnamese diacritics via NFD normalisation + combining-mark strip.
 * Special-cases đ/Đ which NFD cannot decompose.
 */
export function generateMagicToken(fullName: string | null): string {
  // Strip Vietnamese / other accented characters safely
  const slug = (fullName ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd') // đ (U+0111) — not decomposable by NFD
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // drop combining diacritical marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 25)

  const base = slug || 'hoc-vien'
  const hash = Math.random().toString(36).slice(2, 10)
  return `${base}-program-${hash}`
}
