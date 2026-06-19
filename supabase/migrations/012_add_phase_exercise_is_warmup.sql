-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012: Warmup flag for phase exercises
-- ─────────────────────────────────────────────────────────────────────────────
--
-- phase_exercises.is_warmup
--   BOOLEAN NOT NULL DEFAULT false
--   Marks an exercise as a warm-up ("Bài khởi động") rather than a working
--   movement. Purely a display marker: the builder table and the athlete-facing
--   views show a small "Bài khởi động" note so the user knows the set is
--   preparatory, not part of the working-volume prescription.
--   Independent of is_amrap / target_percentage_1rm — toggling it does not
--   change any other prescription field.
--
-- Run this ONCE in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.phase_exercises
  ADD COLUMN IF NOT EXISTS is_warmup BOOLEAN NOT NULL DEFAULT false;
