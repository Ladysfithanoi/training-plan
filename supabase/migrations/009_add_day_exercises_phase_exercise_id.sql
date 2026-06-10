-- =============================================================================
-- 009_add_day_exercises_phase_exercise_id.sql
-- Fixes "Lưu cấu hình giáo án" → error:
--   day_exercises upsert failed: Could not find the 'phase_exercise_id'
--   column of 'day_exercises' in the schema cache
--
-- The commit-days endpoint upserts one row per assigned exercise into
-- `day_exercises` with the columns + conflict target below. The table was
-- created manually in Supabase but is missing `phase_exercise_id` (and may be
-- missing the related columns / unique index). This migration makes the table
-- match what /api/phases/[id]/commit-days expects, idempotently.
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

-- Create the table if it does not exist yet (fresh installs).
CREATE TABLE IF NOT EXISTS day_exercises (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_day_id   UUID NOT NULL REFERENCES workout_days (id)   ON DELETE CASCADE,
  phase_exercise_id UUID NOT NULL REFERENCES phase_exercises (id) ON DELETE CASCADE,
  order_label      TEXT,
  loading_style    TEXT NOT NULL DEFAULT 'horizontal',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing installs: add any missing columns (no-op if already present).
ALTER TABLE day_exercises
  ADD COLUMN IF NOT EXISTS phase_exercise_id UUID;

ALTER TABLE day_exercises
  ADD COLUMN IF NOT EXISTS order_label TEXT;

ALTER TABLE day_exercises
  ADD COLUMN IF NOT EXISTS loading_style TEXT NOT NULL DEFAULT 'horizontal';

-- Ensure the FK on phase_exercise_id exists (added separately so it also covers
-- tables created before this column was tracked). Guarded so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'day_exercises_phase_exercise_id_fkey'
  ) THEN
    ALTER TABLE day_exercises
      ADD CONSTRAINT day_exercises_phase_exercise_id_fkey
      FOREIGN KEY (phase_exercise_id) REFERENCES phase_exercises (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Conflict target for the upsert: (workout_day_id, phase_exercise_id).
-- A UNIQUE constraint (not just an index) is required for ON CONFLICT to match.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'day_exercises_day_phase_exercise_key'
  ) THEN
    ALTER TABLE day_exercises
      ADD CONSTRAINT day_exercises_day_phase_exercise_key
      UNIQUE (workout_day_id, phase_exercise_id);
  END IF;
END $$;
