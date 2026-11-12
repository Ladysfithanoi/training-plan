/**
 * POST /api/programs/ai/generate
 * ─────────────────────────────────────────────────────────────────────────────
 * "Tạo bằng AI", step 1: turn the coach's answers into a training-block plan.
 * Nothing is written to the database here — the plan is returned for preview
 * and only saved by POST /api/programs/ai/create once the coach confirms.
 *
 * Body:     { answers: AiBlockAnswers }
 * Response: { plan: AiPlan, dropped: number, equipmentRelaxed: boolean }
 */

import { requireContentAuthor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { generateGeminiJson, GeminiError } from '@/lib/gemini'
import {
  buildPrompt,
  filterLibraryByEquipment,
  sanitizeAnswers,
  sanitizePlan,
  PLAN_SCHEMA,
  MIN_LIBRARY_SIZE,
} from '@/lib/aiBlock'
import type { AiLibraryExercise } from '@/lib/aiBlock'
import type { ExerciseType } from '@/types'

// Generating a whole block can take a while; 60s is the most every Vercel plan allows.
export const maxDuration = 60

export async function POST(request: Request) {
  try { await requireContentAuthor() } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const answers = sanitizeAnswers((body as { answers?: unknown }).answers)

  // ── Exercise library (the only exercises the model may use) ────────────────
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('exercises')
    .select('id, name, type, muscle_groups, movement_pattern:movement_patterns(name)')
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const fullLibrary: AiLibraryExercise[] = (rows ?? []).map(r => {
    // The join comes back as an object or a one-element array depending on how
    // PostgREST infers the relationship.
    const mp = Array.isArray(r.movement_pattern) ? r.movement_pattern[0] : r.movement_pattern
    return {
      id:      r.id as string,
      name:    r.name as string,
      type:    r.type as ExerciseType,
      pattern: (mp as { name?: string } | null | undefined)?.name ?? null,
      muscles: Array.isArray(r.muscle_groups) ? (r.muscle_groups as string[]) : [],
    }
  })

  if (fullLibrary.length < MIN_LIBRARY_SIZE) {
    return Response.json(
      { error: `Kho bài tập mới có ${fullLibrary.length} bài — cần ít nhất ${MIN_LIBRARY_SIZE} bài để AI dựng được khối tập.` },
      { status: 400 },
    )
  }

  const { library, relaxed } = filterLibraryByEquipment(fullLibrary, answers.equipment)
  const { system, prompt, refToId } = buildPrompt(answers, library)
  const byId = new Map(library.map(e => [e.id, e]))

  // ── Ask Gemini ─────────────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await generateGeminiJson({ system, prompt, schema: PLAN_SCHEMA })
  } catch (err) {
    if (err instanceof GeminiError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('[ai/generate] unexpected error:', err)
    return Response.json({ error: 'Không tạo được khối tập bằng AI. Vui lòng thử lại.' }, { status: 500 })
  }

  // ── Validate + resolve exercise codes back to library rows ─────────────────
  const { plan, dropped } = sanitizePlan(raw, entry => {
    const id = refToId.get(String(entry.ref ?? '').trim().toUpperCase())
    const exercise = id ? byId.get(id) : undefined
    return exercise ? { id: exercise.id, name: exercise.name } : null
  })

  if (!plan) {
    return Response.json(
      { error: 'AI trả về khối tập không dùng được (không có buổi tập hợp lệ). Vui lòng thử lại.' },
      { status: 502 },
    )
  }

  if (answers.blockName) plan.name = answers.blockName

  return Response.json({ plan, dropped, equipmentRelaxed: relaxed })
}
