-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: AMRAP flag, week type, and %1RM target for periodisation
-- ─────────────────────────────────────────────────────────────────────────────
--
-- phase_exercises.is_amrap
--   BOOLEAN NOT NULL DEFAULT false
--   Marks the final set of an exercise as an AMRAP (As Many Reps As Possible)
--   testing set, per Eric Helms Hypertrophy Technique: the athlete performs
--   the last set to technical failure / RPE 10 to measure true capacity.
--
-- phase_exercises.target_percentage_1rm
--   INTEGER (nullable)
--   Explicit load prescription as a percentage of the athlete's 1-Rep Max.
--   Used in strength / peaking blocks where load, not rep volume, is the
--   primary training stimulus (e.g. 85%, 90%, 95% of 1RM).
--   NULL = load prescribed by RPE/RIR (standard hypertrophy approach).
--
-- phases.week_type
--   TEXT NOT NULL DEFAULT 'standard'
--   Characterises the training stimulus type for the entire phase/mesocycle:
--     'standard' — normal progressive overload week
--     'deload'   — planned fatigue-management week (~50% volume/intensity)
--     'taper'    — pre-competition volume reduction, intensity maintained
--     'peaking'  — maximal-strength testing / near-maximal load accumulation
-- ─────────────────────────────────────────────────────────────────────────────

-- ── phase_exercises additions ──────────────────────────────────────────────────
ALTER TABLE public.phase_exercises
  ADD COLUMN IF NOT EXISTS is_amrap              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_percentage_1rm INTEGER;

-- ── phases addition ────────────────────────────────────────────────────────────
ALTER TABLE public.phases
  ADD COLUMN IF NOT EXISTS week_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (week_type IN ('standard', 'deload', 'taper', 'peaking'));

-- Index for fast filtering of AMRAP sets across a phase (e.g. dashboard queries)
CREATE INDEX IF NOT EXISTS idx_phase_exercises_is_amrap
  ON public.phase_exercises (phase_id, is_amrap)
  WHERE is_amrap = true;
