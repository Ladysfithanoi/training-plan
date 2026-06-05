-- =============================================================================
-- Training-Plan — Supabase SQL Schema
-- Paste this into the Supabase SQL editor and run it once.
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- PROFILES  (extends auth.users)
-- =============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('admin', 'coach', 'user')),
  -- Coach-generated shareable token — populated by POST /api/magic-link.
  -- Enables the /p/[token] guest route without requiring student login.
  -- migration 003_add_magic_token.sql
  magic_token TEXT,
  -- Which coach created this student (migration 007). NULL = owned by admin.
  created_by  UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique partial index for fast token lookups (only indexes non-null rows)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_magic_token_idx
  ON public.profiles (magic_token)
  WHERE magic_token IS NOT NULL;

-- Auto-create a profile row whenever a new auth.users row is inserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- MOVEMENT PATTERNS  (Core library)
-- =============================================================================
CREATE TABLE IF NOT EXISTS movement_patterns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,          -- Squat, Hinge, Push, Pull, …
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EXERCISES  (Core library)
-- =============================================================================
CREATE TABLE IF NOT EXISTS exercises (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  movement_pattern_id UUID REFERENCES movement_patterns (id),
  -- Type determines which rep zones are prescribed
  type                TEXT NOT NULL DEFAULT 'compound'
                        CHECK (type IN ('compound', 'machine', 'cable', 'bodyweight', 'dumbbell')),
  optimal_rep_min     INT  NOT NULL DEFAULT 5,
  optimal_rep_max     INT  NOT NULL DEFAULT 20,
  description         TEXT,
  muscle_groups       TEXT[] NOT NULL DEFAULT '{}',
  -- Which staff member authored this exercise (migration 007). NULL = admin.
  created_by          UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TRAINING BLOCKS  (Macro / program container)
-- =============================================================================
CREATE TABLE IF NOT EXISTS training_blocks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  total_mesocycles INT  NOT NULL DEFAULT 3,
  created_by       UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PHASES  (Mesocycles)
-- =============================================================================
CREATE TABLE IF NOT EXISTS phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id     UUID NOT NULL REFERENCES training_blocks (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phase_order  INT  NOT NULL,  -- 1, 2, 3 … within the block
  phase_type   TEXT NOT NULL
                 CHECK (phase_type IN ('training', 'maintenance', 'active_rest')),
  duration_weeks INT NOT NULL DEFAULT 4,

  -- ── Training-phase fields ───────────────────────────────────────────────
  -- Number of sessions per week per muscle group  (Meso1=2, Meso2=3, Meso3=4)
  frequency_per_week INT NOT NULL DEFAULT 2,

  -- Expanding rep zones stored as a JSONB array:
  -- [{"min":5,"max":10},{"min":10,"max":20,"exercise_type":"machine"},…]
  rep_ranges JSONB NOT NULL DEFAULT '[]',

  -- ── Maintenance-phase fields ────────────────────────────────────────────
  -- Fraction of Meso-2 weekly sets (0.333 ≈ 1/3)
  target_set_reduction_factor FLOAT NOT NULL DEFAULT 1.0,
  includes_deload BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Active-Rest-phase fields ────────────────────────────────────────────
  max_rir           INT   DEFAULT NULL,   -- Maximum RIR (10 for active rest)
  max_weight_percent FLOAT DEFAULT NULL,  -- Max fraction of working weight (0.5)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (block_id, phase_order)
);

-- =============================================================================
-- PHASE EXERCISES  (Which exercises belong to a phase and at what targets)
-- =============================================================================
CREATE TABLE IF NOT EXISTS phase_exercises (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        UUID NOT NULL REFERENCES phases (id) ON DELETE CASCADE,
  exercise_id     UUID NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  target_sets     INT  NOT NULL DEFAULT 3,
  target_rep_min  INT  NOT NULL,
  target_rep_max  INT  NOT NULL,
  rir_target      INT  NOT NULL DEFAULT 2,   -- Reps In Reserve target
  notes           TEXT,
  day_of_week     INT[],                     -- e.g. [1,3,5] = Mon/Wed/Fri
  -- Explicit drag-to-reorder position within a (phase, day) (migration 008).
  -- Independent of order_label so superset tags (A1/A2) are preserved.
  sort_order      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- USER PROGRAMS  (Assigning a block to a user)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_programs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  block_id          UUID NOT NULL REFERENCES training_blocks (id) ON DELETE CASCADE,
  current_phase_id  UUID REFERENCES phases (id) ON DELETE SET NULL,
  start_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  phase_start_date  DATE,           -- When the current phase started
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'paused')),
  assigned_by       UUID REFERENCES profiles (id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

-- =============================================================================
-- WORKOUT SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  phase_id        UUID REFERENCES phases (id) ON DELETE SET NULL,
  user_program_id UUID REFERENCES user_programs (id) ON DELETE SET NULL,
  session_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),
  duration_minutes INT,
  overall_rir     FLOAT,   -- Average RIR for the session
  notes           TEXT,
  -- Post-workout autoregulation survey — migration 004_add_session_survey.sql
  survey_performance TEXT CHECK (survey_performance IN ('exceed', 'meet', 'miss')),
  survey_rir_feel    TEXT CHECK (survey_rir_feel IN ('easier', 'on_target', 'too_hard')),
  survey_recovery    TEXT CHECK (survey_recovery IN ('great', 'normal', 'sore')),
  next_week_suggestion TEXT,   -- Eric Helms decision-tree output; shown in next session
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORKOUT SETS  (Individual logged sets)
-- =============================================================================
CREATE TABLE IF NOT EXISTS workout_sets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES workout_sessions (id) ON DELETE CASCADE,
  exercise_id  UUID NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  set_number   INT  NOT NULL,
  target_reps  INT,
  actual_reps  INT,
  weight_kg    FLOAT,
  rir          INT,      -- Reps In Reserve
  rpe          FLOAT,    -- Rate of Perceived Exertion  (auto: 10 - rir)
  -- Brzycki estimated 1-rep max: load / (1.0278 − 0.0278 × (actual_reps + rir))
  -- Populated automatically by the sets API; NULL for warmups and sets without RIR.
  estimated_1rm FLOAT,
  is_warmup    BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises         ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases            ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase_exercises   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_programs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets      ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Helper: is the current user staff (admin or coach)?  (migration 007)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'coach')
  );
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Coaches may additionally read students they created (created_by = self).
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin() OR created_by = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete profiles"
  ON profiles FOR DELETE
  USING (public.is_admin());

-- ── movement_patterns & exercises  (read-only for all authenticated users) ──
CREATE POLICY "Authenticated users can read movement patterns"
  ON movement_patterns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage movement patterns"
  ON movement_patterns FOR ALL USING (public.is_admin());

-- exercises: shared read; write by admin or the row's creator (migration 007).
CREATE POLICY "Authenticated users can read exercises"
  ON exercises FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff insert exercises"
  ON exercises FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR (public.is_staff() AND created_by = auth.uid()));

CREATE POLICY "Owner or admin update exercises"
  ON exercises FOR UPDATE TO authenticated
  USING (public.is_admin() OR created_by = auth.uid())
  WITH CHECK (public.is_admin() OR created_by = auth.uid());

CREATE POLICY "Owner or admin delete exercises"
  ON exercises FOR DELETE TO authenticated
  USING (public.is_admin() OR created_by = auth.uid());

-- ── training_blocks & phases  (shared read, owner/admin write) ──────────────
CREATE POLICY "Authenticated users can read blocks"
  ON training_blocks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff insert blocks"
  ON training_blocks FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR (public.is_staff() AND created_by = auth.uid()));

CREATE POLICY "Owner or admin update blocks"
  ON training_blocks FOR UPDATE TO authenticated
  USING (public.is_admin() OR created_by = auth.uid())
  WITH CHECK (public.is_admin() OR created_by = auth.uid());

CREATE POLICY "Owner or admin delete blocks"
  ON training_blocks FOR DELETE TO authenticated
  USING (public.is_admin() OR created_by = auth.uid());

CREATE POLICY "Authenticated users can read phases"
  ON phases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff manage phases of owned blocks"
  ON phases FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR block_id IN (SELECT id FROM training_blocks WHERE created_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR block_id IN (SELECT id FROM training_blocks WHERE created_by = auth.uid())
  );

CREATE POLICY "Authenticated users can read phase exercises"
  ON phase_exercises FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff manage phase exercises of owned blocks"
  ON phase_exercises FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR phase_id IN (
      SELECT p.id FROM phases p
      JOIN training_blocks b ON b.id = p.block_id
      WHERE b.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR phase_id IN (
      SELECT p.id FROM phases p
      JOIN training_blocks b ON b.id = p.block_id
      WHERE b.created_by = auth.uid()
    )
  );

-- ── user_programs ────────────────────────────────────────────────────────────
-- Coaches may read / manage assignments for students they created (migration 007).
CREATE POLICY "Users read own programs"
  ON user_programs FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  );

CREATE POLICY "Staff manage user programs"
  ON user_programs FOR ALL
  USING (
    public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  );

-- Allow users to update their own phase progress (advance phase)
CREATE POLICY "Users can update own program phase"
  ON user_programs FOR UPDATE
  USING (user_id = auth.uid());

-- ── workout_sessions & sets  (owner, admin, or owning coach) ────────────────
CREATE POLICY "Users manage own sessions"
  ON workout_sessions FOR ALL
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  );

CREATE POLICY "Users manage own sets"
  ON workout_sets FOR ALL
  USING (
    session_id IN (
      SELECT id FROM workout_sessions WHERE user_id = auth.uid()
    )
    OR public.is_admin()
    OR session_id IN (
      SELECT s.id FROM workout_sessions s
      JOIN profiles p ON p.id = s.user_id
      WHERE p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM workout_sessions WHERE user_id = auth.uid()
    )
    OR public.is_admin()
    OR session_id IN (
      SELECT s.id FROM workout_sessions s
      JOIN profiles p ON p.id = s.user_id
      WHERE p.created_by = auth.uid()
    )
  );

-- =============================================================================
-- USEFUL INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_phases_block       ON phases (block_id, phase_order);
CREATE INDEX IF NOT EXISTS idx_user_programs_user  ON user_programs (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date  ON workout_sessions (user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sets_session        ON workout_sets (session_id, set_number);
CREATE INDEX IF NOT EXISTS idx_exercises_pattern   ON exercises (movement_pattern_id);
