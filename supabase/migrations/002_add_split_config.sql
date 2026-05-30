-- =============================================================================
-- Migration 002 — Training Split Configuration on Phases
-- Run in Supabase SQL Editor after 001_add_estimated_1rm.sql
-- =============================================================================

-- Training split type (fullbody / upper_lower / ppl)
ALTER TABLE phases
  ADD COLUMN IF NOT EXISTS split_type TEXT
    CHECK (split_type IN ('fullbody', 'upper_lower', 'ppl'));

-- Custom day-slot array: [{"id":"<uuid>","type":"push","label":"Đẩy A"}, …]
-- Default '[]' means no custom days defined yet (use split_type defaults).
ALTER TABLE phases
  ADD COLUMN IF NOT EXISTS split_days JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN phases.split_type IS
  'Training split: fullbody (2-3×/wk), upper_lower (4×/wk), ppl (5-6×/wk)';

COMMENT ON COLUMN phases.split_days IS
  'Coach-editable day-slot list: [{id, type, label}]. Empty = use split_type defaults.';
