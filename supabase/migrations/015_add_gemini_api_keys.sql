-- =============================================================================
-- 015_add_gemini_api_keys.sql
-- API keys for the "Tạo bằng AI" button (Cấu trúc Khối Tập Luyện).
--
-- The server rotates through the active keys: each request takes the key that
-- was used longest ago, and when a key answers "quota exceeded" it is put on a
-- cooldown and the next one is tried.
--
-- IMPORTANT — Google counts quota PER PROJECT, not per key. Five keys created
-- inside the same Google Cloud / AI Studio project share one quota, so rotating
-- them gains nothing. Create each key in its own project.
--
-- Security: RLS is enabled with NO policy, so neither the browser (anon key)
-- nor a logged-in user can read this table. Only the server, through the
-- service-role key, can.
--
-- Run this ONCE in the Supabase SQL editor, then add the keys (Table Editor →
-- gemini_api_keys → Insert row, or the INSERT at the bottom of this file).
-- =============================================================================

CREATE TABLE IF NOT EXISTS gemini_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Free-form name so you can tell the keys apart (e.g. "Project 1").
  label          TEXT,
  api_key        TEXT NOT NULL UNIQUE,
  -- Untick to take a key out of rotation without deleting it.
  is_active      BOOLEAN NOT NULL DEFAULT true,
  -- Maintained by the server ↓
  last_used_at   TIMESTAMPTZ,
  -- Set when the key hit its quota or was rejected; skipped until this time.
  cooldown_until TIMESTAMPTZ,
  -- Last error Google returned for this key (quota, invalid key, …).
  last_error     TEXT,
  use_count      INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gemini_api_keys ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose — service-role access only.)

-- Example — replace with your real keys, one row per Google project:
-- INSERT INTO gemini_api_keys (label, api_key) VALUES
--   ('Project 1', 'YOUR_GEMINI_API_KEY_1'),
--   ('Project 2', 'YOUR_GEMINI_API_KEY_2'),
--   ('Project 3', 'YOUR_GEMINI_API_KEY_3'),
--   ('Project 4', 'YOUR_GEMINI_API_KEY_4'),
--   ('Project 5', 'YOUR_GEMINI_API_KEY_5');
