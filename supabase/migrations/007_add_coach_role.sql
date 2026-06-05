-- =============================================================================
-- 007_add_coach_role.sql
-- Adds the "coach" (HLV) role and per-owner data isolation.
--
-- Model:
--   • admin  — super user, sees & edits everything.
--   • coach  — staff with a private roster; sees the shared exercise/program
--              bank read-only, but only edits/deletes rows they created, and
--              only sees / manages students they created.
--   • user   — student (unchanged).
--
-- Ownership columns:
--   • profiles.created_by   — which coach created this student (NULL = admin).
--   • exercises.created_by  — which staff member authored this exercise.
--   • training_blocks.created_by — already exists.
--
-- Run this ONCE in the Supabase SQL editor.
-- =============================================================================

-- ─── 1. Extend the role enum ──────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach', 'user'));

-- ─── 2. Ownership columns ─────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles (id) ON DELETE SET NULL;
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_created_by  ON profiles (created_by);
CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON exercises (created_by);

-- ─── 3. Backfill existing data → first admin ──────────────────────────────────
-- Existing exercises and programs become owned by the (oldest) admin so coaches
-- see them as read-only shared-bank content. Existing students keep created_by
-- NULL → only the admin sees them.
UPDATE exercises
   SET created_by = (SELECT id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
 WHERE created_by IS NULL;

UPDATE training_blocks
   SET created_by = (SELECT id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
 WHERE created_by IS NULL;

-- ─── 4. Helper: is the current user staff (admin or coach)? ───────────────────
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'coach')
  );
$$;

-- =============================================================================
-- 5. ROW-LEVEL SECURITY — replace admin-only write policies with owner-aware ones
-- =============================================================================

-- ── exercises ─────────────────────────────────────────────────────────────────
-- SELECT stays open to all authenticated users (shared bank).
DROP POLICY IF EXISTS "Admins manage exercises" ON exercises;

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

-- ── training_blocks (giáo án) ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage blocks" ON training_blocks;

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

-- ── phases (write follows the parent block's owner) ───────────────────────────
DROP POLICY IF EXISTS "Admins manage phases" ON phases;

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

-- ── phase_exercises (write follows the grandparent block's owner) ─────────────
DROP POLICY IF EXISTS "Admins manage phase exercises" ON phase_exercises;

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

-- ── profiles (coach can read students they created) ───────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin() OR created_by = auth.uid());
-- INSERT / UPDATE / DELETE policies are unchanged: student CRUD is performed by
-- the server-side service-role client which bypasses RLS; the API enforces
-- coach→own-student ownership explicitly.

-- ── user_programs (coach can see / assign for their students) ─────────────────
DROP POLICY IF EXISTS "Users read own programs" ON user_programs;
CREATE POLICY "Users read own programs"
  ON user_programs FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR user_id IN (SELECT id FROM profiles WHERE created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage user programs" ON user_programs;
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
-- "Users can update own program phase" stays as-is (student advances own phase).

-- ── workout_sessions & sets (coach sees their students' logs) ─────────────────
DROP POLICY IF EXISTS "Users manage own sessions" ON workout_sessions;
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

DROP POLICY IF EXISTS "Users manage own sets" ON workout_sets;
CREATE POLICY "Users manage own sets"
  ON workout_sets FOR ALL
  USING (
    session_id IN (SELECT id FROM workout_sessions WHERE user_id = auth.uid())
    OR public.is_admin()
    OR session_id IN (
      SELECT s.id FROM workout_sessions s
      JOIN profiles p ON p.id = s.user_id
      WHERE p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    session_id IN (SELECT id FROM workout_sessions WHERE user_id = auth.uid())
    OR public.is_admin()
    OR session_id IN (
      SELECT s.id FROM workout_sessions s
      JOIN profiles p ON p.id = s.user_id
      WHERE p.created_by = auth.uid()
    )
  );
