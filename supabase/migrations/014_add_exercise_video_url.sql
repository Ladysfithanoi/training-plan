-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014: Technique video link for exercises
-- ─────────────────────────────────────────────────────────────────────────────
--
-- exercises.video_url
--   TEXT (nullable)
--   A link (typically YouTube) demonstrating correct technique for the exercise.
--   Set in the Exercise Library ("Kho bài tập"); shown to students inside the
--   training block via a "Xem kỹ thuật" button that opens the clip in a modal.
--
--   Write access follows the existing exercises RLS (migration 007):
--     • admin   — may set the link on any exercise.
--     • coach   — may set the link only on exercises they created (created_by).
--   Read access is already open to every authenticated user, so students can
--   watch the clip from inside their workout block.
--
-- Run this ONCE in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS video_url TEXT;
