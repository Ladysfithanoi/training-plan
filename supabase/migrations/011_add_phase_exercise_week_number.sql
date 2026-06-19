-- =============================================================================
-- 011_add_phase_exercise_week_number.sql
-- Per-week prescription within a Meso (phase).
--
-- Until now every phase_exercise applied to ALL weeks of a meso identically.
-- This adds an optional `week_number`:
--
--   • week_number IS NULL  → BASE row. Applies to every week that has no
--                            week-specific override. This is what every existing
--                            row becomes, so behaviour is unchanged after deploy.
--   • week_number = N (1..duration_weeks) → OVERRIDE row, applies only to week N.
--
-- Resolution (read side): for a given (day, week W) — if ANY rows exist with
-- week_number = W, that week is "customised" and uses only its week-W rows;
-- otherwise it falls back to the BASE (week_number IS NULL) rows.
--
-- The coach customises a week by cloning the base rows into week-N rows, then
-- editing freely (different exercises / sets / reps). Resetting deletes week-N
-- rows so the week falls back to base again.
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

ALTER TABLE phase_exercises
  ADD COLUMN IF NOT EXISTS week_number INT;

-- Read side filters by (phase_id, week_number) constantly — index both.
CREATE INDEX IF NOT EXISTS phase_exercises_phase_week_idx
  ON phase_exercises (phase_id, week_number);
