-- =============================================================================
-- Migration 001: Add estimated_1rm to workout_sets
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- =============================================================================

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS estimated_1rm FLOAT;

-- Partial index: only covers rows where e1RM is computed (compound working sets).
-- Powers the progress-page time-series query efficiently.
CREATE INDEX IF NOT EXISTS idx_sets_e1rm_exercise
  ON workout_sets (exercise_id, logged_at DESC)
  WHERE estimated_1rm IS NOT NULL;
