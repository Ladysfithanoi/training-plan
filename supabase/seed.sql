-- =============================================================================
-- Training-Plan — Seed Data
-- Run AFTER schema.sql
-- =============================================================================

-- ─── Movement Patterns ────────────────────────────────────────────────────────
INSERT INTO movement_patterns (name, description) VALUES
  ('Squat',      'Knee-dominant lower body pattern — quads, glutes, adductors'),
  ('Hinge',      'Hip-dominant lower body pattern — hamstrings, glutes, erectors'),
  ('Push',       'Horizontal or vertical pressing — chest, shoulders, triceps'),
  ('Pull',       'Horizontal or vertical pulling — back, biceps, rear delts'),
  ('Carry',      'Loaded locomotion — core, traps, grip'),
  ('Isolation',  'Single-joint accessory work — biceps, triceps, calves, etc.')
ON CONFLICT (name) DO NOTHING;

-- ─── Exercises ────────────────────────────────────────────────────────────────
-- Squat pattern
INSERT INTO exercises (name, movement_pattern_id, type, optimal_rep_min, optimal_rep_max, muscle_groups)
SELECT
  e.name, mp.id, e.type::text, e.rmin, e.rmax, e.muscles
FROM movement_patterns mp
CROSS JOIN (VALUES
  ('Barbell Back Squat',      'compound',   1,  10, ARRAY['quads','glutes','adductors']),
  ('Barbell Front Squat',     'compound',   1,  10, ARRAY['quads','core']),
  ('Leg Press',               'machine',    8,  30, ARRAY['quads','glutes']),
  ('Hack Squat (Machine)',    'machine',    8,  20, ARRAY['quads','glutes']),
  ('Bulgarian Split Squat',   'dumbbell',   6,  15, ARRAY['quads','glutes']),
  ('Leg Extension',           'machine',   15,  30, ARRAY['quads'])
) AS e(name, type, rmin, rmax, muscles)
WHERE mp.name = 'Squat'
ON CONFLICT DO NOTHING;

-- Hinge pattern
INSERT INTO exercises (name, movement_pattern_id, type, optimal_rep_min, optimal_rep_max, muscle_groups)
SELECT
  e.name, mp.id, e.type::text, e.rmin, e.rmax, e.muscles
FROM movement_patterns mp
CROSS JOIN (VALUES
  ('Conventional Deadlift',   'compound',   1,   6, ARRAY['hamstrings','glutes','erectors']),
  ('Romanian Deadlift',       'compound',   6,  12, ARRAY['hamstrings','glutes']),
  ('Leg Curl (Machine)',       'machine',   10,  20, ARRAY['hamstrings']),
  ('Hip Thrust (Barbell)',     'compound',   8,  20, ARRAY['glutes']),
  ('Cable Pull-Through',       'cable',     12,  20, ARRAY['glutes','hamstrings']),
  ('Good Morning',             'compound',   8,  12, ARRAY['hamstrings','erectors'])
) AS e(name, type, rmin, rmax, muscles)
WHERE mp.name = 'Hinge'
ON CONFLICT DO NOTHING;

-- Push pattern
INSERT INTO exercises (name, movement_pattern_id, type, optimal_rep_min, optimal_rep_max, muscle_groups)
SELECT
  e.name, mp.id, e.type::text, e.rmin, e.rmax, e.muscles
FROM movement_patterns mp
CROSS JOIN (VALUES
  ('Barbell Bench Press',     'compound',   4,  10, ARRAY['chest','front_delt','triceps']),
  ('Incline DB Press',        'dumbbell',   8,  15, ARRAY['chest','front_delt']),
  ('Overhead Press',          'compound',   5,  10, ARRAY['front_delt','triceps']),
  ('Cable Fly',               'cable',     12,  20, ARRAY['chest']),
  ('Pec Deck',                'machine',   12,  25, ARRAY['chest']),
  ('Lateral Raise',           'dumbbell',  12,  25, ARRAY['lateral_delt']),
  ('Cable Lateral Raise',     'cable',     15,  30, ARRAY['lateral_delt']),
  ('Triceps Pushdown',        'cable',     10,  20, ARRAY['triceps'])
) AS e(name, type, rmin, rmax, muscles)
WHERE mp.name = 'Push'
ON CONFLICT DO NOTHING;

-- Pull pattern
INSERT INTO exercises (name, movement_pattern_id, type, optimal_rep_min, optimal_rep_max, muscle_groups)
SELECT
  e.name, mp.id, e.type::text, e.rmin, e.rmax, e.muscles
FROM movement_patterns mp
CROSS JOIN (VALUES
  ('Barbell Row',             'compound',   5,  10, ARRAY['lats','mid_back','biceps']),
  ('Weighted Pull-Up',        'bodyweight', 4,  10, ARRAY['lats','biceps']),
  ('Lat Pulldown',            'machine',    8,  15, ARRAY['lats','biceps']),
  ('Seated Cable Row',        'cable',     10,  15, ARRAY['mid_back','lats']),
  ('Face Pull',               'cable',     15,  25, ARRAY['rear_delt','external_rotators']),
  ('Barbell Curl',            'compound',   6,  12, ARRAY['biceps']),
  ('Cable Curl',              'cable',     12,  20, ARRAY['biceps']),
  ('Hammer Curl',             'dumbbell',  10,  20, ARRAY['biceps','brachialis'])
) AS e(name, type, rmin, rmax, muscles)
WHERE mp.name = 'Pull'
ON CONFLICT DO NOTHING;

-- Isolation
INSERT INTO exercises (name, movement_pattern_id, type, optimal_rep_min, optimal_rep_max, muscle_groups)
SELECT
  e.name, mp.id, e.type::text, e.rmin, e.rmax, e.muscles
FROM movement_patterns mp
CROSS JOIN (VALUES
  ('Calf Raise (Machine)',    'machine',   15,  30, ARRAY['calves']),
  ('Ab Wheel Rollout',        'bodyweight', 8,  15, ARRAY['core']),
  ('Cable Crunch',            'cable',     12,  20, ARRAY['abs']),
  ('Rear Delt Fly (Pec Deck)','machine',  15,  25, ARRAY['rear_delt'])
) AS e(name, type, rmin, rmax, muscles)
WHERE mp.name = 'Isolation'
ON CONFLICT DO NOTHING;
