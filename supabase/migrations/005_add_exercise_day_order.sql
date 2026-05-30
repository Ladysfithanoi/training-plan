-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005: Day assignment, ordering, and loading-style for phase_exercises
-- ─────────────────────────────────────────────────────────────────────────────
--
-- day_id        → TEXT (UUID) — references the coach-defined split_day slot
--                stored as JSONB inside phases.split_days[].id.
--                NULL means the exercise is not pinned to a specific day.
--
-- order_label   → TEXT — coach-assigned sequence tag, rendered in the "STT" column:
--                  Horizontal loading (standalone): A, B, C, D …
--                  Vertical loading (superset/pair): A1, A2, B1, B2, B3 …
--
-- loading_style → TEXT — how sets are executed across the weekly microcycle:
--                  'horizontal' = all sets of exercise A, then all of B, …
--                  'vertical'   = paired or grouped super-sets
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.phase_exercises
  ADD COLUMN IF NOT EXISTS day_id        TEXT,
  ADD COLUMN IF NOT EXISTS order_label   TEXT,
  ADD COLUMN IF NOT EXISTS loading_style TEXT DEFAULT 'horizontal'
    CHECK (loading_style IN ('horizontal', 'vertical'));

-- Efficient day-based filtering used by PhaseExerciseBuilder
CREATE INDEX IF NOT EXISTS idx_phase_exercises_day_id
  ON public.phase_exercises (day_id);

-- Efficient phase+day combo used when rendering the exercise table
CREATE INDEX IF NOT EXISTS idx_phase_exercises_phase_day
  ON public.phase_exercises (phase_id, day_id);
