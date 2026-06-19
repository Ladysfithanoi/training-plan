-- =============================================================================
-- 010_add_announcements.sql
-- "Bảng tin" — admin-authored announcements shown above the user guide
-- (Hướng dẫn sử dụng) so HLV (coaches) learn about new features / programs.
--
-- Model:
--   • Each row = one announcement card: ảnh (cover), tiêu đề, nội dung, ngày.
--   • The cover image is stored inline as a compressed base64 data-URL
--     (client resizes/recompresses before upload) — no Storage bucket needed.
--   • Items are short-lived: the app deletes any row older than 48h on read,
--     and caps the table at 6 rows (admin must delete before adding more).
--     The guide board itself shows only the 3 most recent.
--
-- Writes are admin-only; every authenticated user may read.
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  -- Base64 data-URL of the cover image, or NULL when none was chosen.
  image_url   TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first listing + the 48h expiry sweep both key off created_at.
CREATE INDEX IF NOT EXISTS announcements_created_at_idx
  ON announcements (created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read the board.
DROP POLICY IF EXISTS "Authenticated can read announcements" ON announcements;
CREATE POLICY "Authenticated can read announcements"
  ON announcements FOR SELECT TO authenticated USING (true);

-- Only admins may create / edit / delete announcements.
DROP POLICY IF EXISTS "Admins manage announcements" ON announcements;
CREATE POLICY "Admins manage announcements"
  ON announcements FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
