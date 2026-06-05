-- =============================================================================
-- 008_add_phase_exercise_sort_order.sql
-- Adds an explicit numeric ordering for exercises within a phase / training day
-- so coaches can drag them up/down to arrange the session order, independently
-- of the STT tag (order_label, which still drives A/B/A1/A2 superset grouping).
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

ALTER TABLE phase_exercises
  ADD COLUMN IF NOT EXISTS sort_order INT;

-- Backfill: number existing rows 1..N per (phase, day) using the current display
-- order (order_label first, then insertion order). Each day gets its own sequence.
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY phase_id, COALESCE(day_id::text, '')
      ORDER BY order_label NULLS FIRST, created_at
    ) AS rn
  FROM phase_exercises
)
UPDATE phase_exercises pe
   SET sort_order = ordered.rn
  FROM ordered
 WHERE ordered.id = pe.id
   AND pe.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_phase_exercises_sort
  ON phase_exercises (phase_id, sort_order);
