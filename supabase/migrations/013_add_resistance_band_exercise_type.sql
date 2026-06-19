-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013: Allow "resistance_band" (Dây kháng lực) as an exercise type
-- ─────────────────────────────────────────────────────────────────────────────
--
-- exercises.type carries a CHECK constraint listing the allowed equipment types.
-- This widens it to include 'resistance_band' so coaches can catalogue band
-- exercises in the Kho bài tập (exercise library).
--
-- The original constraint was created inline (unnamed) in schema.sql, so Postgres
-- auto-named it `exercises_type_check`. We drop it (IF EXISTS for safety) and
-- recreate it with the extra value.
--
-- Run this ONCE in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_type_check;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_type_check
  CHECK (type IN ('compound', 'machine', 'cable', 'bodyweight', 'dumbbell', 'resistance_band'));
