-- 003_add_magic_token.sql
-- Adds a coach-generated shareable token to athlete profiles.
-- This enables the /p/[token] guest route for program sharing without login.
-- Run in Supabase Dashboard → SQL Editor → New query.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS magic_token TEXT;

-- Fast unique lookup for token resolution in /api/p/[token] routes.
-- Partial index only indexes rows where the token is set.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_magic_token_idx
  ON public.profiles (magic_token)
  WHERE magic_token IS NOT NULL;
