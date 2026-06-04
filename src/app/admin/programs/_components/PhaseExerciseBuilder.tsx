'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { phaseTypeLabel, phaseTypeBadgeClass, cn } from '@/lib/utils'
import {
  recommendSplit,
  getSplitConfig,
  generateDefaultDays,
  filterPatternsByDay,
  availableDayTypes,
  SPLIT_TYPE_OPTIONS,
  DAY_TYPE_LABELS,
  PATTERN_NAMES_BY_DAY,
} from '@/lib/trainingSplit'
import type { SplitType, SplitDay, DayType } from '@/lib/trainingSplit'
import type { Phase, Exercise, MovementPattern, PhaseExercise, WeekType, PhaseType, TrainingBlock } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Kiểu xếp lịch — Loading style options used in the add-exercise form.
 *
 * Horizontal Loading (Tập đơn lẻ):
 *   Coach completes ALL sets of exercise A before moving to B, then C, etc.
 *   Order labels are auto-assigned as simple letter sequences: A → B → C …
 *
 * Vertical Loading (Tập Superset / Cặp):
 *   Sets are grouped; the coach rotates between exercises in the same group.
 *   Order labels are manually entered as composite tags: A1, A2, B1, B2 …
 *   Exercises sharing the same letter prefix belong to the same superset.
 */
const LOADING_STYLE_OPTIONS = [
  {
    value: 'horizontal' as const,
    label: 'Horizontal Loading (Tập đơn lẻ)',
    desc: 'Hoàn thành tất cả hiệp rồi mới chuyển bài. Mã STT tự động: A, B, C…',
  },
  {
    value: 'vertical' as const,
    label: 'Vertical Loading (Tập Superset / Cặp)',
    desc: 'Xoay vòng giữa các bài trong cùng nhóm. Nhập mã tùy chỉnh: A1, A2, B1, B2…',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for the STT order badge.
 * Colors are keyed by the first letter so all exercises in the same
 * superset group (A1, A2 …) share a consistent visual indicator.
 */
function orderBadgeClass(label: string): string {
  const ch = label[0]?.toUpperCase()
  if (ch === 'A') return 'bg-amber/15 text-amber border-amber/40'
  if (ch === 'B') return 'bg-herb/15 text-herb border-herb/35'
  if (ch === 'C') return 'bg-sky-500/10 text-sky-600 border-sky-400/30'
  if (ch === 'D') return 'bg-violet-500/10 text-violet-600 border-violet-400/30'
  return 'bg-ink/8 text-ink/55 border-ink/20'
}

/**
 * Compute the next horizontal order label for a day given how many exercises
 * are already assigned to it (0 → 'A', 1 → 'B', … 25 → 'Z', 26 → 'A2', …).
 */
function computeHorizontalLabel(existingCount: number): string {
  const idx   = existingCount % 26
  const cycle = Math.floor(existingCount / 26)
  return cycle > 0
    ? `${String.fromCharCode(65 + idx)}${cycle + 1}`
    : String.fromCharCode(65 + idx)
}

/**
 * Maps a weekly set count to bar/text Tailwind classes and a range label.
 *
 * Thresholds follow Eric Helms / Renaissance Periodization volume landmarks:
 *   < 6   → Sub-MEV  (below Minimum Effective Volume — grey)
 *   6–11  → MEV zone (effective minimum — herb green)
 *  12–19  → MAV zone (Maximum Adaptive Volume — amber)
 *  ≥ 20   → At/above MRV (Maximum Recoverable Volume — danger red)
 */
function getVolumeColor(sets: number): {
  barClass:   string
  textClass:  string
  rangeLabel: string
} {
  if (sets >= 20) return { barClass: 'bg-danger/65', textClass: 'text-danger',  rangeLabel: '≥ MRV ↑' }
  if (sets >= 12) return { barClass: 'bg-amber',     textClass: 'text-amber',   rangeLabel: 'MAV ✓'   }
  if (sets >= 6)  return { barClass: 'bg-herb',      textClass: 'text-herb',    rangeLabel: 'MEV ✓'   }
  return               { barClass: 'bg-ink/25',    textClass: 'text-ink/40',  rangeLabel: '< MEV'   }
}

/**
 * Formats a fractional set count for display.
 * Whole numbers → plain integer string.  Halves → one decimal (e.g. "4.5").
 */
function formatSets(sets: number): string {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1)
}

// ── Anatomy mapping engine ────────────────────────────────────────────────────
//
// Maps a (movement-pattern name, exercise name) pair to the anatomical muscle
// groups it recruits, weighted by their role as primary (1.0) or secondary
// driver (0.5) per Eric Helms / RP synergist literature.
//
// PRIMARY driver  (1.0) — muscle is the main target of the movement.
// SECONDARY driver (0.5) — muscle is significantly recruited but not the
//   primary target; coaches should count these at half-credit when evaluating
//   weekly volume against MEV/MAV/MRV thresholds.
//
// The "Push" pattern requires sub-classification because a bench press and an
// overhead press share the same pattern label but recruit completely different
// primary movers.  Exercise-name keywords are used as a heuristic.

const VERTICAL_PUSH_KEYWORDS = [
  'overhead', 'ohp', 'shoulder press', 'military press',
  'arnold', 'push press', 'z press', 'landmine press',
  'pike push', 'standing press', 'seated press',
]

function isPushVertical(exerciseName: string): boolean {
  const lower = exerciseName.toLowerCase()
  return VERTICAL_PUSH_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Returns a Record<muscleName, fraction> for a given exercise.
 * fraction: 1.0 = primary, 0.5 = secondary.
 */
function getMuscleContributions(
  patternName: string,
  exerciseName: string,
): Record<string, number> {
  const p = patternName.toLowerCase()

  // ── Push ──────────────────────────────────────────────────────────────────
  if (
    p.includes('push') ||
    p.includes('press') ||
    p.includes('bench') ||
    p.includes('chest') ||
    p.includes('fly')
  ) {
    if (
      p.includes('shoulder') ||
      p.includes('overhead') ||
      p.includes('ohp') ||
      isPushVertical(exerciseName)
    ) {
      // Vertical push — OHP / shoulder-press focus
      return {
        'Vai (Delts)':        1.0,
        'Tay sau (Triceps)':  0.5,
      }
    }
    // Horizontal push — bench / chest focus
    return {
      'Ngực (Chest)':           1.0,
      'Vai trước (Ant. Delt)':  0.5,
      'Tay sau (Triceps)':      0.5,
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────────
  if (
    p.includes('pull') ||
    p.includes('row')  ||
    p.includes('chin') ||
    p.includes('lat')  ||
    p.includes('back')
  ) {
    return {
      'Lưng (Back)':           1.0,
      'Tay trước (Biceps)':    0.5,
      'Vai sau (Rear Delt)':   0.5,
    }
  }

  // ── Squat ─────────────────────────────────────────────────────────────────
  if (
    p.includes('squat') ||
    p.includes('leg press') ||
    p.includes('lunge') ||
    p.includes('split squat') ||
    p.includes('bulgarian')
  ) {
    return {
      'Đùi trước (Quads)': 1.0,
      'Mông (Glutes)':      0.5,
    }
  }

  // ── Hinge ─────────────────────────────────────────────────────────────────
  if (
    p.includes('hinge') ||
    p.includes('deadlift') ||
    p.includes('rdl') ||
    p.includes('good morning') ||
    p.includes('hip thrust') ||
    p.includes('glute bridge')
  ) {
    return {
      'Đùi sau / Mông (Ham/Glutes)': 1.0,
      'Lưng dưới (Lower Back)':       1.0,
    }
  }

  // ── Arm isolations (sometimes given their own pattern) ────────────────────
  if (p.includes('bicep') || p.includes('curl')) {
    return { 'Tay trước (Biceps)': 1.0 }
  }
  if (p.includes('tricep') || p.includes('extension') || p.includes('dip')) {
    return { 'Tay sau (Triceps)': 1.0 }
  }

  // ── Shoulder isolation ────────────────────────────────────────────────────
  if (p.includes('shoulder') || p.includes('lateral') || p.includes('delt')) {
    return { 'Vai (Delts)': 1.0 }
  }

  // ── Unrecognised — keep raw pattern name so no volume silently disappears ─
  return { [patternName.length > 0 ? patternName : 'Chưa phân loại']: 1.0 }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A training block with its phases pre-joined (mirrors the Supabase query shape). */
type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface Props {
  /** All blocks belonging to this coach, each carrying their phases[].
   *  Cross-block contamination is impossible because phases are strictly derived
   *  from `selectedBlockId` (controlled by the parent ProgramsWorkspace). */
  blocks: BlockWithPhases[]
  exercises: Exercise[]
  patterns: MovementPattern[]
  /** Controlled: the block currently active in section 1.  This component is
   *  read-only with respect to block selection — ProgramsWorkspace owns it. */
  selectedBlockId: string
}

interface PhaseExerciseRow extends PhaseExercise {
  exercise: Exercise
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ─── Component ────────────────────────────────────────────────────────────────

export function PhaseExerciseBuilder({ blocks, exercises, patterns, selectedBlockId }: Props) {

  // ── Local block mirror ───────────────────────────────────────────────────────
  // Keeps a mutable copy so phase CRUD (add / rename / delete meso) is reflected
  // instantly without a full page refresh.  Synced from the `blocks` prop whenever
  // the server re-fetches (router.refresh after a new block is created).
  const [localBlocks, setLocalBlocks] = useState<BlockWithPhases[]>(blocks)

  // Sync when server re-fetches: blocks prop changes only on router.refresh()
  // which happens after ProgramBuilder creates a new block.  Phase mutations
  // update localBlocks directly and do NOT call router.refresh(), so this effect
  // never clobbers optimistic phase mutations mid-session.
  useEffect(() => {
    setLocalBlocks(blocks)
  }, [blocks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase selection ─────────────────────────────────────────────────────────
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(() => {
    // Initialise to the first phase of whichever block the workspace pre-selected.
    const seedBlock = blocks.find(b => b.id === selectedBlockId) ?? blocks[0]
    return (seedBlock?.phases ?? [])[0]?.id ?? ''
  })
  const [phaseExercises, setPhaseExercises]   = useState<PhaseExerciseRow[]>([])
  const [loading, setLoading]                 = useState(false)

  // ── Split config ────────────────────────────────────────────────────────────
  const [splitType, setSplitType]     = useState<SplitType | null>(null)
  const [splitDays, setSplitDays]     = useState<SplitDay[]>([])
  const [activeDayId, setActiveDayId] = useState<string | null>(null)

  // Day CRUD
  const [renamingDayId, setRenamingDayId] = useState<string | null>(null)
  const [renameLabel, setRenameLabel]     = useState('')
  const renameRef                         = useRef<HTMLInputElement>(null)
  // Panel thêm bài tập — dùng để tự cuộn xuống khi mở
  const addPanelRef                       = useRef<HTMLDivElement>(null)
  const [addingDay, setAddingDay]         = useState(false)
  const [newDayType, setNewDayType]       = useState<DayType>('push')
  // Custom session name — only used when newDayType === 'other' (buổi "Khác")
  const [newDayLabel, setNewDayLabel]     = useState('')

  // Save states
  const [splitSaving, setSplitSaving] = useState(false)  // silent bg save
  const [saveStatus, setSaveStatus]   = useState<SaveStatus>('idle') // explicit button

  // ── Add exercise form ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]             = useState(false)
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

  // ── Meso (phase) CRUD ────────────────────────────────────────────────────────
  // Coaches can add blank mesos to any block, rename them, or delete them without
  // navigating away.  All mutations are reflected in localBlocks immediately.
  const [addPhaseOpen, setAddPhaseOpen]       = useState(false)
  const [newPhaseName, setNewPhaseName]       = useState('')
  const [newPhaseType, setNewPhaseType]       = useState<PhaseType>('training')
  const [newPhaseDuration, setNewPhaseDuration] = useState('4')
  const [newPhaseFreq, setNewPhaseFreq]       = useState('3')
  const [addingPhase, setAddingPhase]         = useState(false)
  const [addPhaseError, setAddPhaseError]     = useState<string | null>(null)

  // Phase inline rename
  const [renamingPhaseId, setRenamingPhaseId]   = useState<string | null>(null)
  const [renamePhaseValue, setRenamePhaseValue] = useState('')
  const renamingPhaseRef                        = useRef<HTMLInputElement>(null)

  // ── Migration 006: AMRAP & %1RM target ──────────────────────────────────────
  /** When true the final working set is programmed as AMRAP to RPE 10. */
  const [isAmrap, setIsAmrap]                 = useState(false)
  /** Explicit load prescription as integer % of 1RM (e.g. 85). Empty = off. */
  const [target1rmPct, setTarget1rmPct]       = useState('')

  // ── Phase week-type (migration 006) ──────────────────────────────────────────
  /** Training stimulus character for the currently selected phase. */
  const [phaseWeekType, setPhaseWeekType]     = useState<WeekType>('standard')
  const [weekTypeSaving, setWeekTypeSaving]   = useState(false)

  // ── Inline order-label (STT) editing ────────────────────────────────────────
  const [editingOLId, setEditingOLId]       = useState<string | null>(null)
  const [editingOLValue, setEditingOLValue] = useState('')

  // ── Pending delete confirmation ──────────────────────────────────────────────
  // Tracks which item is awaiting user confirmation before being deleted.
  // Replaces window.confirm() with the brand-consistent <ConfirmModal>.
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'exercise'; id: string }
    | { kind: 'day';      id: string }
    | { kind: 'phase';    id: string }
    | null
  >(null)

  // ── Edit exercise modal ───────────────────────────────────────────────────────
  // Full edit of an existing phase_exercise row in one place: swap the exercise
  // itself plus every prescription field (sets / reps / RIR / %1RM / AMRAP /
  // loading style / STT). Pre-filled from the row when opened.
  const [editingExercise, setEditingExercise]   = useState<PhaseExerciseRow | null>(null)
  const [editFilterPattern, setEditFilterPattern] = useState('')
  const [editExerciseId, setEditExerciseId]     = useState('')
  const [editSets, setEditSets]                 = useState('3')
  const [editRepMin, setEditRepMin]             = useState('8')
  const [editRepMax, setEditRepMax]             = useState('12')
  const [editRir, setEditRir]                   = useState('2')
  const [editLoadingStyle, setEditLoadingStyle] = useState<'horizontal' | 'vertical'>('horizontal')
  const [editOrderLabel, setEditOrderLabel]     = useState('')
  const [editIsAmrap, setEditIsAmrap]           = useState(false)
  const [editTarget1rmPct, setEditTarget1rmPct] = useState('')
  const [editSaving, setEditSaving]             = useState(false)
  const [editError, setEditError]               = useState<string | null>(null)

  // ── Derived values ───────────────────────────────────────────────────────────
  /**
   * The block the coach is currently configuring.
   * Derived from localBlocks so meso CRUD mutations are reflected immediately.
   */
  const activeBlock   = localBlocks.find(b => b.id === selectedBlockId) ?? null

  /**
   * Phases belonging STRICTLY to the active block.
   * This replaces the old `phases` prop — zero cross-block contamination.
   */
  const phases        = activeBlock?.phases ?? []

  const selectedPhase = phases.find(p => p.id === selectedPhaseId)
  const activeDay     = splitDays.find(d => d.id === activeDayId) ?? null
  const recommended   = selectedPhase ? recommendSplit(selectedPhase.frequency_per_week) : null

  /**
   * The exercise rows shown in the table.
   * When a split is configured, strictly filter by the active day_id so each
   * day shows ONLY its own exercises.  Without a split → show everything.
   */
  const visibleExercises: PhaseExerciseRow[] = (splitType && activeDayId)
    ? phaseExercises.filter(pe => pe.day_id === activeDayId)
    : phaseExercises

  /**
   * Set of day UUIDs that currently exist in the split configuration.
   * Used to distinguish "assigned to an active day" from "unassigned / orphaned".
   */
  const splitDayIdSet = new Set(splitDays.map(d => d.id))

  /**
   * Total exercises in this phase that are assigned to a day that still exists
   * in the split.  Excludes:
   *   • exercises with day_id = null  (unassigned / added before migration 005)
   *   • exercises whose day_id points to a day that has since been deleted
   *
   * This is the correct "Y" value for the counter so the coach sees
   * "(2 / 5 tổng)" only when other active days genuinely contain exercises,
   * not because of phantom unassigned rows inflating the total.
   */
  const assignedPhaseCount = splitType
    ? phaseExercises.filter(pe => pe.day_id != null && splitDayIdSet.has(pe.day_id)).length
    : phaseExercises.length

  /**
   * The next auto-assigned horizontal label for the add form preview.
   * Re-uses visibleExercises.length so it stays in sync with the table.
   */
  const nextHorizontalLabel = computeHorizontalLabel(
    (splitType && activeDayId) ? visibleExercises.length : phaseExercises.length,
  )

  // ── Weekly volume by anatomical muscle group ─────────────────────────────────
  /**
   * Aggregates fractional set credit across ALL exercises in the selected phase,
   * broken down by anatomical muscle group rather than raw movement-pattern name.
   *
   * Credit model (Eric Helms / RP):
   *   primary driver  (1.0×) — the muscle the movement is primarily designed for.
   *   secondary driver (0.5×) — recruited significantly but not the primary target.
   *
   * Multiplier logic (same as before):
   *   • Split configured → each phase_exercise lives in exactly one day-slot,
   *     so sets sum directly.
   *   • No split → multiply by frequency_per_week to reach weekly totals.
   *
   * rawWeeklySets   — simple sum of target_sets × freqMul, used in the header
   *                   so the coach sees the actual programmed set count.
   * totalMuscleSets — sum of fractional credits (will exceed rawWeeklySets when
   *                   exercises recruit multiple muscle groups).
   * maxMuscleSets   — largest single-muscle total; drives the % width of bars.
   */
  const weeklyVolumeByMuscle = (() => {
    const freqMul = splitType ? 1 : (selectedPhase?.frequency_per_week ?? 1)
    const map = new Map<string, number>()
    for (const pe of phaseExercises) {
      const patternName  = pe.exercise.movement_pattern?.name ?? ''
      const exerciseName = pe.exercise.name ?? ''
      const sessionSets  = (pe.target_sets ?? 0) * freqMul
      const contributions = getMuscleContributions(patternName, exerciseName)
      for (const [muscle, fraction] of Object.entries(contributions)) {
        map.set(muscle, (map.get(muscle) ?? 0) + sessionSets * fraction)
      }
    }
    return Array.from(map.entries())
      .map(([name, sets]) => ({ name, sets: Math.round(sets * 10) / 10 }))
      .sort((a, b) => b.sets - a.sets)
  })()

  const rawWeeklySets   = phaseExercises.reduce(
    (sum, pe) => sum + (pe.target_sets ?? 0) * (splitType ? 1 : (selectedPhase?.frequency_per_week ?? 1)),
    0,
  )
  const maxMuscleSets   = weeklyVolumeByMuscle.reduce((m, p) => Math.max(m, p.sets), 0)

  /**
   * True when the selected phase is configured for Strength / Peaking / Taper work.
   *
   * Eric Helms periodisation rules applied:
   *   Strength context  → prescribe by %1RM, suppress RIR + AMRAP, enforce rep max ≤ 5
   *   Hypertrophy context → prescribe by RIR, allow AMRAP, suppress %1RM entirely
   */
  const isStrengthContext = phaseWeekType === 'peaking' || phaseWeekType === 'taper'

  // Pattern options filtered by active day type
  const dayFilteredPatterns = activeDay
    ? filterPatternsByDay(patterns, activeDay.type as DayType)
    : patterns

  const patternOptions = [
    {
      value: '',
      label: activeDay
        ? `Tất cả (${DAY_TYPE_LABELS[activeDay.type as DayType] ?? activeDay.type})`
        : 'Tất cả Chuỗi Chuyển Động',
    },
    ...dayFilteredPatterns.map(p => ({ value: p.id, label: p.name })),
  ]

  // Exercise options: first filtered by active-day movement patterns,
  // then further narrowed by the pattern the coach explicitly selected.
  const filteredExercises = filterPattern
    ? exercises.filter(e => e.movement_pattern_id === filterPattern)
    : (activeDay
        ? (() => {
            const dayPatternNames = PATTERN_NAMES_BY_DAY[activeDay.type as DayType]
            if (!dayPatternNames || dayPatternNames.length === 0) return exercises
            const allowed = dayPatternNames.map(n => n.toLowerCase())
            const dayPatternIds = patterns
              .filter(p => allowed.includes(p.name.toLowerCase()))
              .map(p => p.id)
            return exercises.filter(
              e => !e.movement_pattern_id || dayPatternIds.includes(e.movement_pattern_id),
            )
          })()
        : exercises)

  // ── Block change — reset phase selection to first phase of newly active block ─
  useEffect(() => {
    const firstPhaseId = (activeBlock?.phases ?? [])[0]?.id ?? ''
    setSelectedPhaseId(firstPhaseId)
    // Clear per-day and add-form state so the previous block never bleeds through
    setAddOpen(false)
    setAddPhaseOpen(false)
    setFilterPattern('')
    setSelectedExercise('')
    setRenamingDayId(null)
    setRenamingPhaseId(null)
    setAddingDay(false)
    setSaveStatus('idle')
    setEditingOLId(null)
  }, [selectedBlockId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase change ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // No phase selected (block has 0 phases) — clear all exercise / split state
    if (!selectedPhaseId) {
      setPhaseExercises([])
      setSplitType(null)
      setSplitDays([])
      setActiveDayId(null)
      setPhaseWeekType('standard')
      setAddOpen(false)
      setSaveStatus('idle')
      setEditingOLId(null)
      setIsAmrap(false)
      setTarget1rmPct('')
      return
    }

    void loadPhaseExercises(selectedPhaseId)

    const phase = phases.find(p => p.id === selectedPhaseId)
    if (phase) {
      const st = (phase.split_type as SplitType) ?? null
      setSplitType(st)
      const days: SplitDay[] =
        Array.isArray(phase.split_days) && phase.split_days.length > 0
          ? (phase.split_days as SplitDay[])
          : (st ? generateDefaultDays(st) : [])
      setSplitDays(days)
      setActiveDayId(days[0]?.id ?? null)
    }

    setAddOpen(false)
    setFilterPattern('')
    setSelectedExercise('')
    setRenamingDayId(null)
    setAddingDay(false)
    setSaveStatus('idle')
    setEditingOLId(null)
    // Migration 006: sync week_type from newly selected phase
    const newWeekType = (phase?.week_type ?? 'standard') as WeekType
    setPhaseWeekType(newWeekType)
    // Reset the add-form migration-006 fields — use context-appropriate defaults
    const newIsStrength = newWeekType === 'peaking' || newWeekType === 'taper'
    setIsAmrap(false)
    setTarget1rmPct('')
    setTargetRepMin('1')
    setTargetRepMax(newIsStrength ? '3' : '12')
    setRirTarget(newIsStrength ? '0' : '2')
  }, [selectedPhaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the rename inputs when they appear
  useEffect(() => {
    if (renamingDayId && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [renamingDayId])

  useEffect(() => {
    if (renamingPhaseId && renamingPhaseRef.current) {
      renamingPhaseRef.current.focus()
      renamingPhaseRef.current.select()
    }
  }, [renamingPhaseId])

  // Khi mở panel "Thêm bài tập" → cuộn mượt xuống đúng khu vực điền thông tin.
  // requestAnimationFrame đảm bảo panel đã mount xong trước khi cuộn.
  useEffect(() => {
    if (!addOpen) return
    const raf = requestAnimationFrame(() => {
      addPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [addOpen])

  // Reset exercise-picker filters & vertical label when active day changes
  useEffect(() => {
    setFilterPattern('')
    setSelectedExercise('')
    setOrderLabel('')
    setEditingOLId(null)
  }, [activeDayId])

  // ── Data loaders ─────────────────────────────────────────────────────────────
  async function loadPhaseExercises(phaseId: string) {
    setLoading(true)
    const res = await fetch(`/api/phases/${phaseId}/exercises`)
    if (res.ok) {
      const data = await res.json()
      setPhaseExercises(data.exercises ?? [])
    }
    setLoading(false)
  }

  // ── Split config persistence ──────────────────────────────────────────────────
  // Silent background save triggered by every day mutation (add / rename / delete).
  // Normalises the days array before serialising so JSON.stringify never silently
  // drops keys (undefined values are omitted by the JSON spec).
  async function persistSplitConfig(type: SplitType, days: SplitDay[]) {
    setSplitSaving(true)
    try {
      // Explicitly pick only the three fields Supabase expects in the JSONB column.
      // Guards against extra prototype keys and ensures a plain [] is sent when
      // the array is empty rather than null / undefined.
      const safeDays = Array.isArray(days)
        ? days.map(d => ({ id: d.id, type: d.type, label: d.label }))
        : []

      await fetch(`/api/phases/${selectedPhaseId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ split_type: type, split_days: safeDays }),
      })
    } finally {
      setSplitSaving(false)
    }
  }

  // ── Week type persistence (migration 006) ────────────────────────────────────
  async function handleWeekTypeChange(val: WeekType) {
    const newIsStrength = val === 'peaking' || val === 'taper'
    setPhaseWeekType(val)

    // Reset fields that belong exclusively to the OTHER training context so that
    // stale values from the hidden panel never sneak into handleAdd().
    if (newIsStrength) {
      setIsAmrap(false)     // AMRAP is a hypertrophy-only technique
    } else {
      setTarget1rmPct('')   // %1RM prescription belongs to strength/peaking only
    }

    setWeekTypeSaving(true)
    try {
      await fetch(`/api/phases/${selectedPhaseId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ week_type: val }),
      })
    } finally {
      setWeekTypeSaving(false)
    }
  }

  /**
   * Explicit "Lưu cấu hình giáo án" button handler.
   *
   * Calls POST /api/phases/[id]/commit-days which does a full batch commit:
   *   1. Updates phases.split_type + phases.split_days (JSONB stays in sync)
   *   2. Upserts workout_days  — one row per split day, program_id resolved
   *      from phases.block_id → training_blocks.id
   *   3. Upserts day_exercises — one row per assigned phase_exercise
   *   4. Prunes orphaned workout_days whose day_key was removed from the split
   *
   * All array values are normalised to plain objects before serialisation to
   * prevent undefined / prototype-chain pollution from reaching the JSONB column.
   */
  async function handleSaveConfig() {
    if (!splitType) return
    setSaveStatus('saving')
    try {
      // Explicitly serialise each day to { id, type, label } — the exact shape
      // stored in phases.split_days JSONB. Falls back to [] when state is empty
      // so Supabase never receives null or undefined for the NOT NULL column.
      const splitDaysPayload = Array.isArray(splitDays)
        ? splitDays.map(d => ({ id: d.id, type: d.type, label: d.label }))
        : []

      const res = await fetch(`/api/phases/${selectedPhaseId}/commit-days`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          split_type: splitType,
          split_days: splitDaysPayload,
          // Send only the fields the endpoint needs — avoids shipping large
          // exercise / movement-pattern join objects over the wire.
          phase_exercises: phaseExercises.map(pe => ({
            id:            pe.id,
            day_id:        pe.day_id        ?? null,
            order_label:   pe.order_label   ?? null,
            loading_style: pe.loading_style ?? 'horizontal',
          })),
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error((payload as { error?: string }).error ?? 'save_failed')
      }

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      console.error('[handleSaveConfig]', err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3500)
    }
  }

  // ── Split type selection ──────────────────────────────────────────────────────
  function handleSetSplitType(type: SplitType) {
    const days = generateDefaultDays(type)
    setSplitType(type)
    setSplitDays(days)
    setActiveDayId(days[0]?.id ?? null)
    void persistSplitConfig(type, days)
  }

  // ── Day CRUD ──────────────────────────────────────────────────────────────────
  function handleAddDay() {
    if (!splitType) return
    // Buổi "Khác": dùng tên tự do coach nhập (fallback "Khác N" nếu để trống).
    // Các loại buổi khác: nhãn tự sinh theo thứ tự (vd "Đẩy 2").
    const label =
      newDayType === 'other'
        ? (newDayLabel.trim() ||
            `${DAY_TYPE_LABELS.other} ${splitDays.filter(d => d.type === 'other').length + 1}`)
        : `${DAY_TYPE_LABELS[newDayType]} ${
            splitDays.filter(d => d.type === newDayType).length + 1
          }`
    const newDay: SplitDay = {
      id:    crypto.randomUUID(),
      type:  newDayType,
      label,
    }
    const updated = [...splitDays, newDay]
    setSplitDays(updated)
    setActiveDayId(newDay.id)
    setAddingDay(false)
    setNewDayLabel('')
    void persistSplitConfig(splitType, updated)
  }

  function startRenameDay(day: SplitDay) {
    setRenamingDayId(day.id)
    setRenameLabel(day.label)
  }

  function commitRenameDay() {
    if (!splitType || !renamingDayId || !renameLabel.trim()) {
      setRenamingDayId(null)
      return
    }
    const updated = splitDays.map(d =>
      d.id === renamingDayId ? { ...d, label: renameLabel.trim() } : d,
    )
    setSplitDays(updated)
    setRenamingDayId(null)
    void persistSplitConfig(splitType, updated)
  }

  function handleDeleteDay(dayId: string) {
    if (splitDays.length <= 1) return
    // Open the ConfirmModal — execution happens in executePendingDelete()
    setPendingDelete({ kind: 'day', id: dayId })
  }

  function doDeleteDay(dayId: string) {
    if (!splitType) return
    const updated = splitDays.filter(d => d.id !== dayId)
    setSplitDays(updated)
    if (activeDayId === dayId) setActiveDayId(updated[0]?.id ?? null)
    void persistSplitConfig(splitType, updated)
  }

  // ── Exercise CRUD ─────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!selectedExercise || !selectedPhaseId) return
    setAdding(true)
    setAddError(null)

    const effectiveDayId = (splitType && activeDayId) ? activeDayId : null
    const effectiveLabel =
      loadingStyle === 'horizontal'
        ? nextHorizontalLabel
        : (orderLabel.trim().toUpperCase() || null)

    const res = await fetch(`/api/phases/${selectedPhaseId}/exercises`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exercise_id:   selectedExercise,
        target_sets:   parseInt(targetSets)   || 3,
        target_rep_min: parseInt(targetRepMin) || 1,
        target_rep_max: parseInt(targetRepMax) || (isStrengthContext ? 3 : 12),
        day_id:        effectiveDayId,
        order_label:   effectiveLabel,
        loading_style: loadingStyle,

        // ── Context-aware periodisation fields (migration 006) ──────────────
        // Strength / Peaking context → prescribe by %1RM; RIR and AMRAP suppressed
        // Hypertrophy context        → prescribe by RIR; %1RM suppressed
        rir_target:            isStrengthContext
          ? null
          : (parseInt(rirTarget) || 2),
        is_amrap:              isStrengthContext ? false : isAmrap,
        target_percentage_1rm: isStrengthContext && target1rmPct
          ? (parseInt(target1rmPct) || null)
          : null,
      }),
    })

    const data = await res.json()
    setAdding(false)

    if (!res.ok) {
      setAddError(data.error ?? 'Không thể thêm bài tập')
      return
    }

    setPhaseExercises(prev => [...prev, data.exercise])
    setAddOpen(false)
    setSelectedExercise('')
    setFilterPattern('')
    setOrderLabel('')
    setTargetSets('3')
    setTargetRepMin('8')
    setTargetRepMax('12')
    setRirTarget('2')
    // Migration 006 — reset advanced periodisation fields
    setIsAmrap(false)
    setTarget1rmPct('')
  }

  function handleRemove(phaseExerciseId: string) {
    // Open the ConfirmModal — execution happens in executePendingDelete()
    setPendingDelete({ kind: 'exercise', id: phaseExerciseId })
  }

  async function doRemoveExercise(phaseExerciseId: string) {
    const res = await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${phaseExerciseId}`,
      { method: 'DELETE' },
    )
    if (res.ok) {
      setPhaseExercises(prev => prev.filter(pe => pe.id !== phaseExerciseId))
    }
  }

  // ── Edit exercise ──────────────────────────────────────────────────────────────
  /** Open the edit modal pre-filled with the row's current values. */
  function startEditExercise(pe: PhaseExerciseRow) {
    setEditingExercise(pe)
    setEditExerciseId(pe.exercise_id)
    setEditFilterPattern(pe.exercise?.movement_pattern_id ?? '')
    setEditSets(String(pe.target_sets ?? 3))
    setEditRepMin(String(pe.target_rep_min ?? 8))
    setEditRepMax(String(pe.target_rep_max ?? 12))
    setEditRir(String(pe.rir_target ?? 2))
    setEditLoadingStyle(pe.loading_style === 'vertical' ? 'vertical' : 'horizontal')
    setEditOrderLabel(pe.order_label ?? '')
    setEditIsAmrap(pe.is_amrap ?? false)
    setEditTarget1rmPct(pe.target_percentage_1rm != null ? String(pe.target_percentage_1rm) : '')
    setEditError(null)
  }

  /** Persist all edited fields in a single PATCH; replace the row from the join. */
  async function handleSaveEdit() {
    if (!editingExercise || !editExerciseId) return
    setEditSaving(true)
    setEditError(null)

    const res = await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${editingExercise.id}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_id:    editExerciseId,
          target_sets:    parseInt(editSets)   || 3,
          target_rep_min: parseInt(editRepMin) || 1,
          target_rep_max: parseInt(editRepMax) || (isStrengthContext ? 3 : 12),
          order_label:    editOrderLabel.trim().toUpperCase() || null,
          loading_style:  editLoadingStyle,

          // Context-aware periodisation fields (mirror handleAdd):
          //   Strength/Peaking → prescribe by %1RM, RIR & AMRAP suppressed
          //   Hypertrophy      → prescribe by RIR, %1RM suppressed
          rir_target:            isStrengthContext ? null : (parseInt(editRir) || 2),
          is_amrap:              isStrengthContext ? false : editIsAmrap,
          target_percentage_1rm: isStrengthContext && editTarget1rmPct
            ? (parseInt(editTarget1rmPct) || null)
            : null,
        }),
      },
    )

    const data = await res.json()
    setEditSaving(false)

    if (!res.ok) {
      setEditError(data.error ?? 'Không thể cập nhật bài tập')
      return
    }

    setPhaseExercises(prev =>
      prev.map(pe => pe.id === editingExercise.id ? data.exercise : pe),
    )
    setEditingExercise(null)
  }

  // ── Meso (phase) CRUD ─────────────────────────────────────────────────────────

  async function handleAddPhase() {
    if (!newPhaseName.trim() || !selectedBlockId) return
    setAddingPhase(true)
    setAddPhaseError(null)

    const res = await fetch('/api/phases', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        block_id:           selectedBlockId,
        name:               newPhaseName.trim(),
        phase_type:         newPhaseType,
        duration_weeks:     parseInt(newPhaseDuration) || 4,
        frequency_per_week: parseInt(newPhaseFreq)     || 3,
      }),
    })

    const data = await res.json()
    setAddingPhase(false)

    if (!res.ok) {
      setAddPhaseError(data.error ?? 'Không thể tạo giai đoạn')
      return
    }

    const newPhase = data.phase as Phase
    // Optimistic: add the new phase to localBlocks, then switch to it
    setLocalBlocks(prev => prev.map(b =>
      b.id === selectedBlockId
        ? { ...b, phases: [...(b.phases ?? []), newPhase] }
        : b,
    ))
    setSelectedPhaseId(newPhase.id)
    // Reset modal
    setAddPhaseOpen(false)
    setNewPhaseName('')
    setNewPhaseType('training')
    setNewPhaseDuration('4')
    setNewPhaseFreq('3')
  }

  function startRenamePhase(phase: Phase) {
    setRenamingPhaseId(phase.id)
    setRenamePhaseValue(phase.name)
  }

  async function commitRenamePhase() {
    if (!renamingPhaseId || !renamePhaseValue.trim()) {
      setRenamingPhaseId(null)
      return
    }
    const phaseId = renamingPhaseId
    const newName = renamePhaseValue.trim()
    setRenamingPhaseId(null)

    // Optimistic update
    setLocalBlocks(prev => prev.map(b =>
      b.id === selectedBlockId
        ? { ...b, phases: (b.phases ?? []).map(p => p.id === phaseId ? { ...p, name: newName } : p) }
        : b,
    ))

    await fetch(`/api/phases/${phaseId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: newName }),
    })
  }

  async function doDeletePhase(phaseId: string) {
    const res = await fetch(`/api/phases/${phaseId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setLocalBlocks(prev => prev.map(b =>
        b.id === selectedBlockId
          ? { ...b, phases: (b.phases ?? []).filter(p => p.id !== phaseId) }
          : b,
      ))
      // If the deleted phase was the active one, switch to the next available
      if (selectedPhaseId === phaseId) {
        const remaining = (localBlocks.find(b => b.id === selectedBlockId)?.phases ?? [])
          .filter(p => p.id !== phaseId)
        setSelectedPhaseId(remaining[0]?.id ?? '')
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  async function executePendingDelete() {
    if (!pendingDelete) return
    const snapshot = pendingDelete       // capture before clearing
    setPendingDelete(null)               // close modal immediately
    if (snapshot.kind === 'day') {
      doDeleteDay(snapshot.id)
    } else if (snapshot.kind === 'phase') {
      await doDeletePhase(snapshot.id)
    } else {
      await doRemoveExercise(snapshot.id)
    }
  }

  async function handleUpdateNumeric(
    phaseExerciseId: string,
    field: 'target_sets' | 'target_rep_min' | 'target_rep_max' | 'rir_target',
    value: string,
  ) {
    const numVal = parseInt(value)
    if (isNaN(numVal)) return

    setPhaseExercises(prev =>
      prev.map(pe => pe.id === phaseExerciseId ? { ...pe, [field]: numVal } : pe),
    )

    await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${phaseExerciseId}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [field]: numVal }),
      },
    )
  }

  // ── Inline STT (order_label) editing ─────────────────────────────────────────
  function startEditOrderLabel(pe: PhaseExerciseRow) {
    setEditingOLId(pe.id)
    setEditingOLValue(pe.order_label ?? '')
  }

  async function commitOrderLabel(phaseExerciseId: string) {
    const value = editingOLValue.trim().toUpperCase() || null
    setEditingOLId(null)

    setPhaseExercises(prev =>
      prev.map(pe => pe.id === phaseExerciseId ? { ...pe, order_label: value } : pe),
    )

    await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${phaseExerciseId}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order_label: value }),
      },
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── Phase (meso) selector + inline CRUD ──────────────────────────── */}
      {/* Block selection is controlled by ProgramsWorkspace (section 1).     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Giai đoạn — {activeBlock?.name ?? ''}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phases.sort((a, b) => a.phase_order - b.phase_order).map(phase => (
            <div key={phase.id} className="flex items-center gap-0.5 group">

              {renamingPhaseId === phase.id ? (
                /* ── Inline rename ── */
                <div className="flex items-center gap-1">
                  <input
                    ref={renamingPhaseRef}
                    type="text"
                    value={renamePhaseValue}
                    onChange={e => setRenamePhaseValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  void commitRenamePhase()
                      if (e.key === 'Escape') setRenamingPhaseId(null)
                    }}
                    className="rounded border border-amber px-2 py-1 text-sm font-medium text-ink focus:outline-none w-44"
                  />
                  <button
                    type="button"
                    onClick={() => void commitRenamePhase()}
                    className="text-xs text-herb font-semibold px-1.5 py-1 rounded hover:bg-herb/10"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingPhaseId(null)}
                    className="text-xs text-ink/40 font-semibold px-1.5 py-1 rounded hover:bg-ink/5"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                /* ── Phase tab button ── */
                <button
                  type="button"
                  onClick={() => setSelectedPhaseId(phase.id)}
                  className={cn(
                    'rounded-lg border px-3.5 py-2 text-sm font-medium transition-all flex items-center gap-1.5',
                    selectedPhaseId === phase.id
                      ? 'border-amber bg-amber/10 text-amber'
                      : 'border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink',
                  )}
                >
                  {phase.name}
                  <span className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5',
                    phaseTypeBadgeClass(phase.phase_type),
                  )}>
                    {phaseTypeLabel(phase.phase_type)}
                  </span>
                </button>
              )}

              {/* Edit / Delete controls — visible on hover */}
              {renamingPhaseId !== phase.id && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
                  {/* Rename */}
                  <button
                    type="button"
                    onClick={() => startRenamePhase(phase)}
                    title="Đổi tên giai đoạn"
                    className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 transition-colors"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  {/* Delete (only if >1 phase remains) */}
                  {phases.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: 'phase', id: phase.id })}
                      title="Xoá giai đoạn"
                      className="h-6 w-6 rounded flex items-center justify-center text-danger/40 hover:text-danger hover:bg-danger/8 transition-colors"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* "+ Thêm Meso" button */}
          <button
            type="button"
            onClick={() => { setNewPhaseName(''); setAddPhaseError(null); setAddPhaseOpen(true) }}
            className="rounded-lg border border-dashed border-amber/40 px-3.5 py-2 text-xs font-semibold text-amber/60 hover:border-amber hover:text-amber hover:bg-amber/4 transition-all flex items-center gap-1"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Thêm Meso
          </button>
        </div>
      </div>

      {/* ── Empty state: block has no phases yet ─────────────────────────── */}
      {phases.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-6 py-14 text-center space-y-4">
          <span className="text-5xl opacity-20" role="img" aria-label="Chưa có giai đoạn">📋</span>
          <div>
            <p className="text-sm font-semibold text-ink">
              Khối &quot;{activeBlock?.name}&quot; chưa có giai đoạn nào
            </p>
            <p className="text-xs text-ink/45 mt-1">
              Thêm giai đoạn (meso) để bắt đầu xây dựng lịch tập cho khối này.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setNewPhaseName(''); setAddPhaseError(null); setAddPhaseOpen(true) }}
            className="rounded-xl bg-amber text-paper font-semibold px-6 py-2.5 text-sm hover:bg-amber/90 active:scale-[0.98] transition-all"
          >
            + Thêm giai đoạn đầu tiên
          </button>
        </div>
      )}

      {selectedPhase && (
        <>
          {/* Phase info bar */}
          <div className="rounded-lg bg-ink/3 border border-ink/8 px-4 py-3 flex flex-wrap items-center gap-4 text-xs text-ink/60">
            <span className="font-mono"><strong className="text-ink">{selectedPhase.duration_weeks}</strong> tuần</span>
            <span className="font-mono"><strong className="text-ink">{selectedPhase.frequency_per_week}×</strong>/tuần</span>
            {selectedPhase.rep_ranges.map((rr, i) => (
              <span key={i} className="font-mono">
                <strong className="text-ink">{rr.min}–{rr.max}</strong> reps
                {rr.exercise_type ? ` (${rr.exercise_type})` : ''}
              </span>
            ))}

            {/* ── Tính chất Tuần tập (migration 006) ───────────────────────── */}
            <div className="flex items-center gap-1.5 ml-auto">
              {weekTypeSaving && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
              )}
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink/40 shrink-0">
                Tính chất tuần
              </label>
              <select
                value={phaseWeekType}
                onChange={e => void handleWeekTypeChange(e.target.value as WeekType)}
                disabled={weekTypeSaving}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-semibold focus:border-amber focus:ring-1 focus:ring-amber outline-none transition-colors',
                  phaseWeekType === 'standard'
                    ? 'border-ink/15 bg-white text-ink'
                    : phaseWeekType === 'deload'
                      ? 'border-herb/30 bg-herb/8 text-herb'
                      : phaseWeekType === 'taper'
                        ? 'border-amber/30 bg-amber/8 text-amber'
                        : /* peaking */ 'border-danger/30 bg-danger/8 text-danger',
                )}
              >
                <option value="standard">📋 Standard</option>
                <option value="deload">🌿 Deload</option>
                <option value="taper">⬇️ Taper</option>
                <option value="peaking">🎯 Peaking</option>
              </select>
            </div>

            {splitSaving && (
              <span className="text-amber animate-pulse">Đang lưu…</span>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── SPLIT CONFIG SECTION ───────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">

            {/* Header row */}
            <div className="px-5 py-4 border-b border-ink/8 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">
                  Kiểu Chương Trình Tập
                </p>
                {recommended && !splitType && (
                  <p className="text-xs text-ink/50 mt-0.5">
                    Gợi ý cho{' '}
                    <strong className="text-ink">{selectedPhase.frequency_per_week} buổi/tuần</strong>:{' '}
                    <button
                      onClick={() => handleSetSplitType(recommended)}
                      className="text-amber font-semibold underline underline-offset-2 hover:text-amber/70"
                    >
                      {getSplitConfig(recommended).label}
                    </button>
                  </p>
                )}
                {splitType && (
                  <p className="text-sm font-medium text-ink mt-0.5">
                    {getSplitConfig(splitType).label}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* ── Lưu cấu hình giáo án — explicit save button ── */}
                {splitType && (
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={saveStatus === 'saving'}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all',
                      saveStatus === 'saved'
                        ? 'border-herb/40 bg-herb/8 text-herb'
                        : saveStatus === 'error'
                          ? 'border-danger/40 bg-danger/8 text-danger'
                          : saveStatus === 'saving'
                            ? 'border-amber/30 bg-amber/8 text-amber cursor-wait'
                            : 'border-ink/20 bg-white text-ink hover:border-amber/50 hover:bg-amber/5 hover:text-amber',
                    )}
                  >
                    {saveStatus === 'saving' && (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    )}
                    {saveStatus === 'saved'  && <span>✓</span>}
                    {saveStatus === 'error'  && <span>✕</span>}
                    {saveStatus === 'saving' ? 'Đang lưu…'
                     : saveStatus === 'saved'  ? 'Đã lưu cấu hình'
                     : saveStatus === 'error'  ? 'Lưu thất bại — thử lại'
                     : 'Lưu cấu hình giáo án'}
                  </button>
                )}

                {/* Split type dropdown */}
                <select
                  value={splitType ?? ''}
                  onChange={e => {
                    const val = e.target.value as SplitType
                    if (val) handleSetSplitType(val)
                  }}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                >
                  <option value="">— Chọn kiểu split —</option>
                  {SPLIT_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Split description + day tabs */}
            {splitType && (
              <div className="px-5 py-4 space-y-4">
                <p className="text-xs text-ink/50 leading-relaxed">
                  {getSplitConfig(splitType).description}
                </p>

                {/* Day tab strip */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-ink/40 uppercase tracking-wide shrink-0">
                      Các ngày:
                    </span>

                    {splitDays.map(day => (
                      <div key={day.id} className="flex items-center gap-0.5 group">
                        {renamingDayId === day.id ? (
                          /* ── Inline rename ── */
                          <div className="flex items-center gap-1">
                            <input
                              ref={renameRef}
                              type="text"
                              value={renameLabel}
                              onChange={e => setRenameLabel(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  commitRenameDay()
                                if (e.key === 'Escape') setRenamingDayId(null)
                              }}
                              className="rounded border border-amber px-2 py-1 text-sm font-medium text-ink focus:outline-none w-32"
                            />
                            <button onClick={commitRenameDay}
                              className="text-xs text-herb font-semibold px-1.5 py-1 rounded hover:bg-herb/10">
                              ✓
                            </button>
                            <button onClick={() => setRenamingDayId(null)}
                              className="text-xs text-ink/40 font-semibold px-1.5 py-1 rounded hover:bg-ink/5">
                              ✕
                            </button>
                          </div>
                        ) : (
                          /* ── Day tab button ── */
                          <button
                            onClick={() => setActiveDayId(day.id)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5',
                              activeDayId === day.id
                                ? 'border-amber bg-amber/10 text-amber'
                                : 'border-ink/12 text-ink/55 hover:border-ink/25 hover:text-ink',
                            )}
                          >
                            {day.label}
                            {/* Pill showing how many exercises are assigned */}
                            {(() => {
                              const n = phaseExercises.filter(pe => pe.day_id === day.id).length
                              return n > 0 ? (
                                <span className={cn(
                                  'rounded-full text-[9px] font-bold px-1.5 py-0.5 leading-none',
                                  activeDayId === day.id
                                    ? 'bg-amber/25 text-amber'
                                    : 'bg-ink/10 text-ink/50',
                                )}>
                                  {n}
                                </span>
                              ) : null
                            })()}
                          </button>
                        )}

                        {/* Per-tab actions — visible on hover */}
                        {renamingDayId !== day.id && (
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startRenameDay(day)}
                              title="Đổi tên ngày"
                              className="h-6 w-6 rounded flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/8 transition-colors"
                            >
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            {splitDays.length > 1 && (
                              <button
                                onClick={() => handleDeleteDay(day.id)}
                                title="Xoá ngày"
                                className="h-6 w-6 rounded flex items-center justify-center text-danger/40 hover:text-danger hover:bg-danger/8 transition-colors"
                              >
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add day button */}
                    {!addingDay ? (
                      <button
                        onClick={() => {
                          const types = availableDayTypes(splitType)
                          setNewDayType(types[0])
                          setNewDayLabel('')
                          setAddingDay(true)
                        }}
                        className="rounded-lg border border-dashed border-ink/20 px-3 py-1.5 text-xs text-ink/40 hover:border-ink/35 hover:text-ink/60 transition-colors font-medium"
                      >
                        + Thêm ngày
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={newDayType}
                          onChange={e => {
                            setNewDayType(e.target.value as DayType)
                            setNewDayLabel('')
                          }}
                          className="rounded border border-ink/20 bg-white px-2 py-1 text-xs text-ink focus:border-amber outline-none"
                        >
                          {availableDayTypes(splitType).map(t => (
                            <option key={t} value={t}>{DAY_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                        {/* Buổi "Khác" → cho phép coach nhập tên buổi tự do */}
                        {newDayType === 'other' && (
                          <input
                            type="text"
                            value={newDayLabel}
                            onChange={e => setNewDayLabel(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  handleAddDay()
                              if (e.key === 'Escape') { setAddingDay(false); setNewDayLabel('') }
                            }}
                            placeholder="Tên buổi tập…"
                            autoFocus
                            className="rounded border border-amber px-2 py-1 text-xs text-ink focus:outline-none w-36"
                          />
                        )}
                        <button onClick={handleAddDay}
                          className="text-xs text-herb font-semibold px-2 py-1 rounded hover:bg-herb/10">
                          Thêm
                        </button>
                        <button onClick={() => { setAddingDay(false); setNewDayLabel('') }}
                          className="text-xs text-ink/40 px-1.5 py-1 rounded hover:bg-ink/5">
                          Huỷ
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Active day description */}
                  {activeDay && splitType && (
                    <div className="mt-3 rounded-lg bg-amber/5 border border-amber/15 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber shrink-0" />
                        <p className="text-xs font-semibold text-amber">
                          Đang cấu hình: {activeDay.label}
                        </p>
                        <span className="ml-auto text-[10px] text-ink/35">
                          {visibleExercises.length} bài tập
                        </span>
                      </div>
                      {PATTERN_NAMES_BY_DAY[activeDay.type as DayType]?.length > 0 && (
                        <p className="text-[11px] text-ink/45 mt-1 pl-3.5">
                          Chuỗi chuyển động phù hợp:{' '}
                          <span className="text-ink/65 font-medium">
                            {PATTERN_NAMES_BY_DAY[activeDay.type as DayType].join(' · ')}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── WEEKLY VOLUME SUMMARY ──────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {weeklyVolumeByMuscle.length > 0 && !loading && (
            <div className="rounded-xl border border-ink/8 bg-white overflow-hidden">

              {/* ── Header ── */}
              <div className="px-5 py-3.5 border-b border-ink/6 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-ink/35">
                    Volume tuần / nhóm cơ — {selectedPhase.name}
                  </p>
                  {!splitType && selectedPhase.frequency_per_week > 1 && (
                    <p className="text-[10px] text-amber/70 mt-0.5">
                      Nhân ×{selectedPhase.frequency_per_week}/tuần (chưa chia lịch)
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-xl font-bold text-ink leading-none tabular-nums">
                    {rawWeeklySets}
                  </span>
                  <span className="text-xs text-ink/40 ml-1.5">hiệp/tuần</span>
                </div>
              </div>

              {/* ── Muscle group rows ── */}
              <div className="px-5 py-4 space-y-3">
                {weeklyVolumeByMuscle.map(({ name, sets }) => {
                  const barPct = maxMuscleSets > 0
                    ? Math.round((sets / maxMuscleSets) * 100)
                    : 0
                  const { barClass, textClass, rangeLabel } = getVolumeColor(sets)
                  return (
                    <div key={name} className="flex items-center gap-3">
                      {/* Muscle group name */}
                      <p className="w-44 shrink-0 text-xs font-medium text-ink/65 truncate">
                        {name}
                      </p>

                      {/* Progress bar */}
                      <div className="flex-1 h-1.5 rounded-full bg-ink/6 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>

                      {/* Set count + range label */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono text-xs font-semibold tabular-nums w-8 text-right ${textClass}`}
                        >
                          {formatSets(sets)}
                        </span>
                        <span className="text-[10px] text-ink/30 w-[52px] leading-tight">
                          {rangeLabel}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── Legend ── */}
              <div className="px-5 py-2.5 border-t border-ink/6 flex items-center gap-x-5 gap-y-1.5 flex-wrap">
                <span className="text-[9px] uppercase tracking-widest text-ink/20 font-semibold">
                  Helms / RP
                </span>
                {([
                  { cls: 'bg-ink/25',    label: '< 6 — Sub-MEV' },
                  { cls: 'bg-herb',      label: '6–11 — MEV'    },
                  { cls: 'bg-amber',     label: '12–19 — MAV'   },
                  { cls: 'bg-danger/65', label: '≥ 20 — MRV ↑'  },
                ] as const).map(({ cls, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className={`h-1.5 w-5 rounded-full ${cls}`} />
                    <span className="text-[9px] text-ink/30">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── EXERCISE TABLE ─────────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              Bài tập
              {splitType && activeDay
                ? (
                  <span className="ml-1.5 text-amber">
                    — {activeDay.label}
                  </span>
                )
                : null}
              <span className="ml-2 text-xs font-normal text-ink/40">
                ({visibleExercises.length}
                {/* Only show the phase-wide total when NO split is active.
                    When a split IS configured each day is an independent
                    partition — exercises on other days are not "hidden"; they
                    belong to different days.  Showing "/ N tổng" in that
                    context is misleading because N includes those other-day
                    exercises, making the counter read "2 / 6 tổng" even when
                    every exercise is correctly assigned to exactly one day. */}
                {splitType
                  ? (assignedPhaseCount > visibleExercises.length
                      ? ` / ${assignedPhaseCount} tổng`
                      : '')
                  : (phaseExercises.length > visibleExercises.length
                      ? ` / ${phaseExercises.length} tổng`
                      : '')})
              </span>
            </h3>
            <Button size="sm" onClick={() => setAddOpen(v => !v)}>
              {addOpen ? '✕ Đóng' : '+ Thêm bài tập'}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
            </div>
          ) : visibleExercises.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-center text-ink/40 py-4">
                  {splitType && activeDay
                    ? `Ngày "${activeDay.label}" chưa có bài tập. Dùng "+ Thêm bài tập" để gán.`
                    : 'Giai đoạn này chưa có bài tập nào.'}
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="w-full overflow-x-auto rounded-xl border border-ink/8 bg-white">
              {/*
               * min-w ensures the STT + all columns render without wrapping.
               * table-fixed + explicit col widths keeps layout stable on resize.
               */}
              <table className="w-full text-sm min-w-[680px]">
                <thead className="border-b border-ink/8">
                  <tr className="text-xs text-ink/40 uppercase tracking-wide">
                    {/* STT — leftmost, shows order_label badge */}
                    <th className="text-center px-3 py-3 w-[52px]">
                      STT
                      <span
                        title="Nhấp vào ô STT để chỉnh sửa mã xếp lịch"
                        className="ml-1 cursor-help text-ink/25">
                        ✎
                      </span>
                    </th>
                    <th className="text-left px-5 py-3">Bài tập</th>
                    <th className="text-left px-5 py-3">Chuỗi CĐ</th>
                    <th className="text-center px-4 py-3">Hiệp</th>
                    <th className="text-center px-4 py-3">Rep Min</th>
                    <th className="text-center px-4 py-3">Rep Max</th>
                    <th className="text-center px-4 py-3">RIR</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {visibleExercises.map(pe => (
                    <tr key={pe.id} className="group hover:bg-ink/2">

                      {/* ── STT column ── */}
                      <td className="px-3 py-2.5 text-center">
                        {editingOLId === pe.id ? (
                          <input
                            type="text"
                            value={editingOLValue}
                            onChange={e => setEditingOLValue(e.target.value.toUpperCase())}
                            onBlur={() => void commitOrderLabel(pe.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  void commitOrderLabel(pe.id)
                              if (e.key === 'Escape') setEditingOLId(null)
                            }}
                            autoFocus
                            maxLength={4}
                            placeholder="A1"
                            className="w-12 text-center rounded-md border border-amber px-1 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber/50"
                          />
                        ) : (
                          <button
                            type="button"
                            title="Nhấp để chỉnh sửa mã STT"
                            onClick={() => startEditOrderLabel(pe)}
                            className={cn(
                              'inline-flex items-center justify-center rounded-md border font-bold text-xs px-2 py-0.5 min-w-[32px] transition-all',
                              pe.order_label
                                ? orderBadgeClass(pe.order_label)
                                : 'border-dashed border-ink/20 text-ink/25 hover:border-ink/40 hover:text-ink/45',
                            )}
                          >
                            {pe.order_label ?? '—'}
                          </button>
                        )}
                      </td>

                      {/* ── Exercise name + type ── */}
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-ink">{pe.exercise?.name ?? '—'}</p>
                          {pe.is_amrap && (
                            <span className="inline-flex items-center rounded-full bg-amber/15 border border-amber/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber leading-none">
                              🔥 AMRAP
                            </span>
                          )}
                          {pe.target_percentage_1rm != null && (
                            <span className="inline-flex items-center rounded-full bg-danger/10 border border-danger/25 px-1.5 py-0.5 text-[9px] font-bold font-mono text-danger leading-none">
                              {pe.target_percentage_1rm}% 1RM
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink/40">{pe.exercise?.type}</p>
                      </td>

                      {/* ── Movement pattern ── */}
                      <td className="px-5 py-2.5 text-ink/50 text-xs">
                        {(pe.exercise?.movement_pattern as any)?.name ?? '—'}
                      </td>

                      {/* ── Inline numeric fields ── */}
                      <td className="px-4 py-2.5 text-center">
                        <input
                          type="number" value={pe.target_sets} min={1} max={10}
                          onChange={e => void handleUpdateNumeric(pe.id, 'target_sets', e.target.value)}
                          className="w-12 text-center bg-transparent border border-transparent focus:border-amber/50 rounded focus:outline-none text-sm font-medium font-mono tabular-nums text-ink"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input
                          type="number" value={pe.target_rep_min} min={1}
                          onChange={e => void handleUpdateNumeric(pe.id, 'target_rep_min', e.target.value)}
                          className="w-12 text-center bg-transparent border border-transparent focus:border-amber/50 rounded focus:outline-none text-sm font-mono tabular-nums text-ink"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input
                          type="number" value={pe.target_rep_max} min={1}
                          onChange={e => void handleUpdateNumeric(pe.id, 'target_rep_max', e.target.value)}
                          className="w-12 text-center bg-transparent border border-transparent focus:border-amber/50 rounded focus:outline-none text-sm font-mono tabular-nums text-ink"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input
                          type="number" value={pe.rir_target} min={0} max={10}
                          onChange={e => void handleUpdateNumeric(pe.id, 'rir_target', e.target.value)}
                          className="w-12 text-center bg-transparent border border-transparent focus:border-amber/50 rounded focus:outline-none text-sm font-mono tabular-nums text-ink"
                        />
                      </td>

                      {/* ── Edit / Delete actions ── */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Sửa — bút chì */}
                          <button
                            type="button"
                            onClick={() => startEditExercise(pe)}
                            title="Sửa bài tập"
                            className="h-7 w-7 rounded flex items-center justify-center text-ink/40 hover:text-amber hover:bg-amber/8 transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          {/* Xoá — thùng rác */}
                          <button
                            type="button"
                            onClick={() => handleRemove(pe.id)}
                            title="Xoá bài tập"
                            className="h-7 w-7 rounded flex items-center justify-center text-danger/50 hover:text-danger hover:bg-danger/8 transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── ADD EXERCISE PANEL ──────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {addOpen && (
            <div ref={addPanelRef} className="scroll-mt-4">
            <Card accent="amber">
              <CardBody>
                <div className="space-y-5">

                  {/* Panel title */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      Thêm bài tập vào{' '}
                      <span className="text-amber">{selectedPhase.name}</span>
                      {activeDay && (
                        <span className="text-ink/45"> · {activeDay.label}</span>
                      )}
                    </p>
                    {splitType && activeDay && (
                      <span className="shrink-0 text-[10px] rounded-full bg-amber/10 border border-amber/20 text-amber px-2.5 py-0.5 font-semibold uppercase tracking-wide">
                        Lọc theo {activeDay.label}
                      </span>
                    )}
                  </div>

                  {/* ── Kiểu xếp lịch (Loading Style) ── */}
                  <div className="rounded-lg border border-ink/10 bg-ink/2 p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink/55">
                      Kiểu xếp lịch
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {LOADING_STYLE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setLoadingStyle(opt.value)
                            setOrderLabel('')
                          }}
                          className={cn(
                            'flex flex-col items-start rounded-lg border px-3.5 py-3 text-left transition-all',
                            loadingStyle === opt.value
                              ? 'border-amber bg-amber/8 shadow-sm'
                              : 'border-ink/12 bg-white hover:border-ink/25',
                          )}
                        >
                          <span className={cn(
                            'text-xs font-bold',
                            loadingStyle === opt.value ? 'text-amber' : 'text-ink',
                          )}>
                            {opt.label}
                          </span>
                          <span className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Exercise picker ── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Pattern filter */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Chuỗi Chuyển Động
                        {activeDay && PATTERN_NAMES_BY_DAY[activeDay.type as DayType]?.length > 0 && (
                          <span className="ml-1.5 text-[10px] font-normal text-amber normal-case">
                            (lọc theo {activeDay.label})
                          </span>
                        )}
                      </label>
                      <select
                        value={filterPattern}
                        onChange={e => { setFilterPattern(e.target.value); setSelectedExercise('') }}
                        className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                      >
                        {patternOptions.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    <Select
                      label="Bài tập"
                      value={selectedExercise}
                      onChange={e => setSelectedExercise(e.target.value)}
                      options={filteredExercises.map(e => ({ value: e.id, label: e.name }))}
                      placeholder="Chọn bài tập..."
                    />
                  </div>

                  {/* ── Training context badge ─────────────────────────────────────── */}
                  {/* Shown only when a non-standard week type is active so the coach
                      sees at-a-glance which field set is currently in use. */}
                  {phaseWeekType !== 'standard' && (
                    <div className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2',
                      isStrengthContext
                        ? 'border-danger/25 bg-danger/4'
                        : 'border-herb/25 bg-herb/4',
                    )}>
                      <span className="text-sm shrink-0">
                        {phaseWeekType === 'peaking' ? '🎯' : phaseWeekType === 'taper' ? '⬇️' : '🌿'}
                      </span>
                      <p className={cn(
                        'text-[11px] font-semibold',
                        isStrengthContext ? 'text-danger/80' : 'text-herb/80',
                      )}>
                        {phaseWeekType === 'peaking' && 'Peaking — kê đơn bằng % 1RM + reps thấp (1–5)'}
                        {phaseWeekType === 'taper'   && 'Taper — giảm thể tích, giữ cường độ cao, kê đơn bằng % 1RM'}
                        {phaseWeekType === 'deload'  && 'Deload — giảm tải, dùng RIR cao hơn thường lệ (3–4)'}
                      </p>
                    </div>
                  )}

                  {/* ── Target prescription grid (always 4 columns) ─────────────────── */}
                  {/*
                   * Column 4 is CONTEXT-AWARE:
                   *   Hypertrophy / Standard / Deload → RIR mục tiêu
                   *   Strength / Peaking / Taper      → % 1RM mục tiêu
                   *
                   * This keeps the grid height constant — no layout jumps when
                   * the coach switches between week types via the selector above.
                   */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

                    {/* Col 1 — Số hiệp (always) */}
                    <Input
                      label="Số hiệp"
                      type="number"
                      value={targetSets}
                      onChange={e => setTargetSets(e.target.value)}
                    />

                    {/* Col 2 — Rep Min (always) */}
                    <Input
                      label="Rep Tối thiểu"
                      type="number"
                      value={targetRepMin}
                      onChange={e => setTargetRepMin(e.target.value)}
                    />

                    {/* Col 3 — Rep Max (clamped ≤ 5 in strength context when %1RM set) */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold font-sans uppercase tracking-wide text-ink/60">
                        Rep Tối đa
                        {isStrengthContext && target1rmPct && (
                          <span className="ml-1.5 font-mono text-[10px] font-bold text-danger normal-case">
                            ≤ 5
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={isStrengthContext && target1rmPct ? 5 : 30}
                        value={targetRepMax}
                        onChange={e => {
                          const raw = e.target.value
                          const n = parseInt(raw)
                          // Enforce upper bound when %1RM is prescribed in strength context
                          if (isStrengthContext && target1rmPct && !isNaN(n) && n > 5) {
                            setTargetRepMax('5')
                          } else {
                            setTargetRepMax(raw)
                          }
                        }}
                        className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3 font-mono text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                      />
                    </div>

                    {/* Col 4 — RIR (hypertrophy) ↔ % 1RM (strength) */}
                    {isStrengthContext ? (

                      /* ── Strength / Peaking: prescribe by %1RM ── */
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold font-sans uppercase tracking-wide text-danger/80">
                          % 1RM mục tiêu
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="50"
                            max="100"
                            step="5"
                            value={target1rmPct}
                            onChange={e => {
                              setTarget1rmPct(e.target.value)
                              // When %1RM is first entered, enforce rep max ≤ 5
                              if (e.target.value && parseInt(targetRepMax) > 5) {
                                setTargetRepMax('5')
                              }
                            }}
                            placeholder="85"
                            className="h-10 w-full rounded-lg border border-danger/30 bg-danger/3 px-3 pr-9 font-mono text-sm text-ink focus:border-danger focus:ring-1 focus:ring-danger/30 outline-none placeholder:font-mono placeholder:text-ink/30"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-danger/50 pointer-events-none">
                            %
                          </span>
                        </div>
                        {/* Live badge preview */}
                        {target1rmPct && (
                          <span className="self-start inline-flex items-center rounded-full bg-danger/10 border border-danger/25 px-2 py-0.5 font-mono text-[10px] font-bold text-danger">
                            {target1rmPct}% 1RM
                          </span>
                        )}
                      </div>

                    ) : (

                      /* ── Hypertrophy / Standard / Deload: prescribe by RIR ── */
                      <Input
                        label="RIR mục tiêu"
                        type="number"
                        value={rirTarget}
                        onChange={e => setRirTarget(e.target.value)}
                      />

                    )}
                  </div>

                  {/* ── Context-specific advanced options ──────────────────────────── */}
                  {isStrengthContext ? (

                    /* ── Strength context: explain field logic, no AMRAP ── */
                    <div className="rounded-xl border border-danger/20 bg-danger/3 px-4 py-3.5 flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5">📐</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold font-sans text-danger/90 uppercase tracking-wide">
                          Kê đơn theo cường độ tuyệt đối
                        </p>
                        <p className="text-[11px] font-sans text-ink/55 leading-snug mt-1">
                          AMRAP không áp dụng trong giai đoạn này — mục tiêu là kỹ thuật và
                          cường độ tối đa, không phải volume. Điền <strong>% 1RM</strong> ở cột bên trái và
                          giữ <strong>Rep Tối đa{' '}</strong>
                          <span className="font-mono">≤ 5</span> để đảm bảo đặc tính Strength/Peaking.
                        </p>
                      </div>
                    </div>

                  ) : (

                    /* ── Hypertrophy context: AMRAP toggle, %1RM completely hidden ── */
                    <label className={cn(
                      'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all select-none',
                      isAmrap
                        ? 'border-amber/40 bg-amber/6'
                        : 'border-ink/10 bg-ink/2 hover:border-ink/20',
                    )}>
                      <input
                        type="checkbox"
                        checked={isAmrap}
                        onChange={e => setIsAmrap(e.target.checked)}
                        className="h-4 w-4 mt-0.5 shrink-0 rounded border-ink/20 accent-amber"
                      />
                      <div className="min-w-0">
                        <p className={cn(
                          'text-xs font-bold font-sans',
                          isAmrap ? 'text-amber' : 'text-ink',
                        )}>
                          🔥 Thiết lập hiệp cuối AMRAP
                          <span className="ml-1.5 font-normal text-ink/40">
                            (Eric Helms Hypertrophy Tech)
                          </span>
                        </p>
                        <p className="text-[11px] font-sans text-ink/45 mt-0.5 leading-snug">
                          Hiệp cuối cùng thực hiện tối đa số lần có thể cho tới khi RPE 10 — đo lường
                          sức chịu đựng thực tế trong mesocycle.
                        </p>
                      </div>
                    </label>

                  )}

                  {/* ── STT / Order label ── */}
                  <div className="flex items-start gap-3">
                    {loadingStyle === 'horizontal' ? (
                      /* Auto-assigned preview badge */
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                          Mã STT (tự động)
                        </span>
                        <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-ink/3 px-3 py-2">
                          <span className={cn(
                            'rounded-md border font-bold text-sm px-2.5 py-0.5',
                            orderBadgeClass(nextHorizontalLabel),
                          )}>
                            {nextHorizontalLabel}
                          </span>
                          <span className="text-xs text-ink/40">Tự động gán theo thứ tự</span>
                        </div>
                      </div>
                    ) : (
                      /* Manual input for vertical/superset */
                      <div className="flex flex-col gap-1.5 flex-1 max-w-[200px]">
                        <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                          Mã STT (tùy chỉnh)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={orderLabel}
                            onChange={e => setOrderLabel(e.target.value.toUpperCase())}
                            placeholder="A1, B2…"
                            maxLength={4}
                            className="w-24 rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold text-ink uppercase focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                          />
                          {orderLabel && (
                            <span className={cn(
                              'rounded-md border font-bold text-sm px-2.5 py-0.5',
                              orderBadgeClass(orderLabel),
                            )}>
                              {orderLabel.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-ink/40 leading-snug">
                          Cùng chữ cái = cùng nhóm superset (A1, A2 tập chung; B1, B2 tập chung…)
                        </p>
                      </div>
                    )}
                  </div>

                  {addError && <p className="text-sm text-danger">{addError}</p>}

                  <div className="flex gap-2">
                    <Button
                      variant="primary" size="sm"
                      loading={adding}
                      onClick={() => void handleAdd()}
                      disabled={!selectedExercise}
                    >
                      Thêm vào {activeDay ? activeDay.label : 'giai đoạn'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setAddOpen(false)}>
                      Huỷ
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
            </div>
          )}
        </>
      )}

      {/* ── Add Phase (Meso) modal ───────────────────────────────────────── */}
      <Modal
        open={addPhaseOpen}
        onClose={() => { setAddPhaseOpen(false); setAddPhaseError(null) }}
        title="Thêm Giai Đoạn Mới"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Tên giai đoạn"
            value={newPhaseName}
            onChange={e => setNewPhaseName(e.target.value)}
            placeholder="VD: Meso 1 — Nền tảng"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold font-sans uppercase tracking-wide text-ink/60">
              Loại giai đoạn
            </label>
            <select
              value={newPhaseType}
              onChange={e => setNewPhaseType(e.target.value as PhaseType)}
              className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
            >
              <option value="training">🏋️ Tập luyện (Training)</option>
              <option value="maintenance">🔄 Duy trì (Maintenance)</option>
              <option value="active_rest">🧘 Nghỉ tích cực (Active Rest)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Thời lượng (tuần)"
              type="number"
              min="1"
              max="24"
              value={newPhaseDuration}
              onChange={e => setNewPhaseDuration(e.target.value)}
            />
            <Input
              label="Tần suất (/tuần)"
              type="number"
              min="1"
              max="7"
              value={newPhaseFreq}
              onChange={e => setNewPhaseFreq(e.target.value)}
            />
          </div>

          <div className="rounded-lg border border-ink/8 bg-ink/2 px-3 py-2.5">
            <p className="text-[11px] text-ink/45 leading-snug">
              Vùng reps, RIR, split type và các thông số chi tiết khác có thể
              được cấu hình sau khi tạo giai đoạn.
            </p>
          </div>

          {addPhaseError && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
              {addPhaseError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              loading={addingPhase}
              onClick={() => void handleAddPhase()}
              disabled={!newPhaseName.trim() || addingPhase}
              className="flex-1"
            >
              Tạo giai đoạn
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setAddPhaseOpen(false); setAddPhaseError(null) }}
              disabled={addingPhase}
            >
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Edit exercise modal ──────────────────────────────────────────── */}
      <Modal
        open={editingExercise !== null}
        onClose={() => setEditingExercise(null)}
        title="Sửa bài tập"
        size="lg"
      >
        {editingExercise && (
          <div className="space-y-5">

            {/* ── Exercise picker ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Chuỗi Chuyển Động
                </label>
                <select
                  value={editFilterPattern}
                  onChange={e => {
                    setEditFilterPattern(e.target.value)
                    // Nếu bài tập đang chọn không thuộc chuỗi mới → bỏ chọn
                    if (e.target.value) {
                      const stillValid = exercises.some(
                        ex => ex.id === editExerciseId && ex.movement_pattern_id === e.target.value,
                      )
                      if (!stillValid) setEditExerciseId('')
                    }
                  }}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                >
                  <option value="">Tất cả Chuỗi Chuyển Động</option>
                  {patterns.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <Select
                label="Bài tập"
                value={editExerciseId}
                onChange={e => setEditExerciseId(e.target.value)}
                options={(editFilterPattern
                  ? exercises.filter(ex => ex.movement_pattern_id === editFilterPattern)
                  : exercises
                ).map(ex => ({ value: ex.id, label: ex.name }))}
                placeholder="Chọn bài tập..."
              />
            </div>

            {/* ── Kiểu xếp lịch (Loading Style) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LOADING_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEditLoadingStyle(opt.value)}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-3.5 py-3 text-left transition-all',
                    editLoadingStyle === opt.value
                      ? 'border-amber bg-amber/8 shadow-sm'
                      : 'border-ink/12 bg-white hover:border-ink/25',
                  )}
                >
                  <span className={cn(
                    'text-xs font-bold',
                    editLoadingStyle === opt.value ? 'text-amber' : 'text-ink',
                  )}>
                    {opt.label}
                  </span>
                  <span className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>

            {/* ── Prescription grid (context-aware col 4, mirrors add panel) ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input
                label="Số hiệp" type="number"
                value={editSets} onChange={e => setEditSets(e.target.value)}
              />
              <Input
                label="Rep Tối thiểu" type="number"
                value={editRepMin} onChange={e => setEditRepMin(e.target.value)}
              />
              <Input
                label="Rep Tối đa" type="number"
                value={editRepMax} onChange={e => setEditRepMax(e.target.value)}
              />
              {isStrengthContext ? (
                <Input
                  label="% 1RM mục tiêu" type="number"
                  value={editTarget1rmPct} onChange={e => setEditTarget1rmPct(e.target.value)}
                />
              ) : (
                <Input
                  label="RIR mục tiêu" type="number"
                  value={editRir} onChange={e => setEditRir(e.target.value)}
                />
              )}
            </div>

            {/* ── AMRAP toggle (hypertrophy context only) ── */}
            {!isStrengthContext && (
              <label className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all select-none',
                editIsAmrap ? 'border-amber/40 bg-amber/6' : 'border-ink/10 bg-ink/2 hover:border-ink/20',
              )}>
                <input
                  type="checkbox"
                  checked={editIsAmrap}
                  onChange={e => setEditIsAmrap(e.target.checked)}
                  className="h-4 w-4 mt-0.5 shrink-0 rounded border-ink/20 accent-amber"
                />
                <div className="min-w-0">
                  <p className={cn('text-xs font-bold', editIsAmrap ? 'text-amber' : 'text-ink')}>
                    🔥 Thiết lập hiệp cuối AMRAP
                  </p>
                  <p className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                    Hiệp cuối thực hiện tối đa số lần tới khi RPE 10.
                  </p>
                </div>
              </label>
            )}

            {/* ── STT / Order label ── */}
            <div className="flex flex-col gap-1.5 max-w-[220px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                Mã STT
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editOrderLabel}
                  onChange={e => setEditOrderLabel(e.target.value.toUpperCase())}
                  placeholder="A, B1…"
                  maxLength={4}
                  className="w-24 rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold text-ink uppercase focus:border-amber focus:ring-1 focus:ring-amber outline-none"
                />
                {editOrderLabel && (
                  <span className={cn(
                    'rounded-md border font-bold text-sm px-2.5 py-0.5',
                    orderBadgeClass(editOrderLabel),
                  )}>
                    {editOrderLabel.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {editError && (
              <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
                {editError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="primary"
                loading={editSaving}
                onClick={() => void handleSaveEdit()}
                disabled={!editExerciseId || editSaving}
                className="flex-1"
              >
                Lưu thay đổi
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingExercise(null)}
                disabled={editSaving}
              >
                Huỷ
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirm delete modal ─────────────────────────────────────────── */}
      <ConfirmModal
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === 'phase'    ? 'Xoá giai đoạn' :
          pendingDelete?.kind === 'day'      ? 'Xoá ngày tập'  : 'Xoá bài tập'
        }
        description={
          pendingDelete?.kind === 'phase'
            ? 'Xoá giai đoạn này và tất cả bài tập bên trong? Hành động này không thể hoàn tác.'
            : pendingDelete?.kind === 'day'
              ? 'Xoá slot ngày này khỏi cấu hình chia tách? Bài tập đã gán cho ngày này sẽ không bị xoá khỏi giai đoạn.'
              : 'Bạn có chắc chắn muốn xoá bài tập này khỏi giai đoạn? Hành động này không thể hoàn tác.'
        }
        confirmLabel="Xoá"
        onConfirm={() => void executePendingDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
