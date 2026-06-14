-- =============================================================================
-- 008_add_trial_role.sql
-- Adds the "trial" (Trải nghiệm) role — a time-boxed, coach-like preview.
--
-- Model:
--   • trial — sees the coach (HLV) UI shell and may browse the shared bank +
--             manage their own demo students + ASSIGN existing training blocks.
--             They CANNOT author content (create/edit training blocks "Khối tập",
--             phases/programs "Chương trình tập", or the exercise bank) because
--             is_staff() intentionally stays admin/coach only — so RLS denies
--             trial accounts every content write.
--
--   Access is time-limited: each account gets a 5-hour window. Outside the
--   window (or when an admin switches it off) the proxy blocks the account
--   entirely and sends it to /trial-expired.
--
-- New columns on profiles (only meaningful when role = 'trial'):
--   • trial_active      BOOLEAN      — admin on/off switch.
--   • trial_expires_at  TIMESTAMPTZ  — end of the current 5-hour window.
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

-- ─── 1. Extend the role enum to include 'trial' ──────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach', 'user', 'trial'));

-- ─── 2. Trial window columns ─────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_active     BOOLEAN,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;

-- NOTE: is_staff() is deliberately left unchanged (admin/coach only). This is
-- what keeps trial accounts read-only on all shared content via RLS. Trial
-- accounts can still manage their own students + assign existing blocks because
-- those policies key off ownership (created_by = auth.uid()), not is_staff().
