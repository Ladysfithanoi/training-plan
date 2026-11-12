import { useState } from 'react'

/**
 * Field state of the "Thêm bài tập" form.
 *
 * It is a hook (called by PhaseExerciseBuilder) rather than state inside
 * <AddExercisePanel> on purpose: the values must survive closing and reopening
 * the panel, and the builder's block / phase / day effects reset some of them.
 */
export function useAddExerciseForm() {
  const [filterPattern, setFilterPattern] = useState('')
  const [selectedExercise, setSelectedExercise] = useState('')
  const [targetSets, setTargetSets]       = useState('3')
  const [targetRepMin, setTargetRepMin]   = useState('8')
  const [targetRepMax, setTargetRepMax]   = useState('12')
  const [rirTarget, setRirTarget]         = useState('2')
  const [loadingStyle, setLoadingStyle]   = useState<'horizontal' | 'vertical'>('horizontal')
  const [orderLabel, setOrderLabel]       = useState('')   // only used for vertical
  const [addError, setAddError]           = useState<string | null>(null)
  const [adding, setAdding]               = useState(false)

  // ── Migration 006: AMRAP & %1RM target ──────────────────────────────────────
  /** When true the final working set is programmed as AMRAP to RPE 10. */
  const [isAmrap, setIsAmrap]                 = useState(false)
  /** Explicit load prescription as integer % of 1RM (e.g. 85). Empty = off. */
  const [target1rmPct, setTarget1rmPct]       = useState('')
  // ── Migration 012: warmup flag ──────────────────────────────────────────────
  /** When true the exercise is marked as a warm-up ("Bài khởi động"). */
  const [isWarmup, setIsWarmup]               = useState(false)
  // ── Coach note shown to the athlete ─────────────────────────────────────────
  /** Free-text prescription note (phase_exercises.notes) visible to the athlete. */
  const [exerciseNotes, setExerciseNotes]     = useState('')

  return {
    filterPattern, setFilterPattern,
    selectedExercise, setSelectedExercise,
    targetSets, setTargetSets,
    targetRepMin, setTargetRepMin,
    targetRepMax, setTargetRepMax,
    rirTarget, setRirTarget,
    loadingStyle, setLoadingStyle,
    orderLabel, setOrderLabel,
    addError, setAddError,
    adding, setAdding,
    isAmrap, setIsAmrap,
    target1rmPct, setTarget1rmPct,
    isWarmup, setIsWarmup,
    exerciseNotes, setExerciseNotes,
  }
}

export type AddExerciseForm = ReturnType<typeof useAddExerciseForm>
