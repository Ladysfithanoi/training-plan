'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ImportScheduleExcelModal } from './ImportScheduleExcelModal'
import type { ImportResult } from './ImportScheduleExcelModal'
import { ImportPlanExcelModal } from './ImportPlanExcelModal'
import type { PlanImportResult, ProgramImportResult, WeekImportResult } from './ImportPlanExcelModal'
import { AddExercisePanel } from './phase-builder/AddExercisePanel'
import { AddPhaseModal } from './phase-builder/AddPhaseModal'
import { CrossMesoCopyPanel } from './phase-builder/CrossMesoCopyPanel'
import { EditExerciseModal } from './phase-builder/EditExerciseModal'
import { ExerciseTable } from './phase-builder/ExerciseTable'
import { WeekImportBanner, ProgramImportBanner, DayImportBanner } from './phase-builder/ImportBanners'
import { OrphanPanel } from './phase-builder/OrphanPanel'
import { PhaseParamsModal } from './phase-builder/PhaseParamsModal'
import { PhaseTabs } from './phase-builder/PhaseTabs'
import { SplitConfigCard } from './phase-builder/SplitConfigCard'
import { WeeklyVolumeSummary, SessionOverloadWarning } from './phase-builder/VolumePanels'
import { WeekScopeBar } from './phase-builder/WeekScopeBar'
import { sumMuscleVolume, SESSION_SET_CAP } from './phase-builder/muscleVolume'
import { useAddExerciseForm } from './phase-builder/useAddExerciseForm'
import {
  NUMERIC_LIMITS,
  commitDaysBody,
  computeHorizontalLabel,
  parseNumericField,
  splitSig,
} from './phase-builder/shared'
import type { BlockWithPhases, NumericField, PhaseExerciseRow, SaveStatus } from './phase-builder/shared'
import { cn } from '@/lib/utils'
import {
  recommendSplit,
  getSplitConfig,
  generateDefaultDays,
  filterPatternsByDay,
  DAY_TYPE_LABELS,
  PATTERN_NAMES_BY_DAY,
} from '@/lib/trainingSplit'
import type { SplitType, SplitDay, DayType } from '@/lib/trainingSplit'
import type { Phase, Exercise, MovementPattern, WeekType } from '@/types'

// Constants, helpers, the anatomy/volume engine and the smaller pieces of this
// screen (table, panels, modals) live in ./phase-builder/*.

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /** Push phase/block mutations up to the shared state so section 1
   *  (structure / timeline / rep-matrix) updates in lock-step. */
  onBlocksChange: (updater: (prev: BlockWithPhases[]) => BlockWithPhases[]) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PhaseExerciseBuilder({ blocks, exercises: libraryProp, patterns, selectedBlockId, onBlocksChange }: Props) {

  // ── Local exercise-library mirror ────────────────────────────────────────────
  // The Excel import can create brand-new Kho bài tập entries mid-session. They
  // must appear in the pickers immediately, without a full page reload — so the
  // server prop is mirrored here and appended to on import.
  const [exercises, setExercises] = useState<Exercise[]>(libraryProp)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setExercises(libraryProp) }, [libraryProp])

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

  /**
   * Apply a block mutation to BOTH the local mirror and the shared parent state.
   * Keeping the parent in sync makes section 1 (structure / timeline / rep-matrix)
   * reflect phase-parameter edits made here immediately.
   */
  function updateBlocks(updater: (prev: BlockWithPhases[]) => BlockWithPhases[]) {
    setLocalBlocks(updater)
    onBlocksChange(updater)
  }

  // ── Phase selection ─────────────────────────────────────────────────────────
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(() => {
    // Initialise to the first phase of whichever block the workspace pre-selected.
    const seedBlock = blocks.find(b => b.id === selectedBlockId) ?? blocks[0]
    return (seedBlock?.phases ?? [])[0]?.id ?? ''
  })
  const [phaseExercises, setPhaseExercises]   = useState<PhaseExerciseRow[]>([])
  const [loading, setLoading]                 = useState(false)
  // ── Per-week scope (migration 011) ───────────────────────────────────────────
  // null = "Gốc" (base rows, apply to every week); 1..N = editing that week only.
  const [selectedWeek, setSelectedWeek]       = useState<number | null>(null)
  const [weekBusy, setWeekBusy]               = useState(false)
  const [pendingWeekReset, setPendingWeekReset] = useState<number | null>(null)
  // Monotonic token for the in-flight phase-exercise fetch. Each load bumps it;
  // a response only applies if its token is still the latest. Prevents an earlier
  // meso's slow fetch from resolving last and repainting another meso's view with
  // the wrong (previous-meso) exercises.
  const loadReqRef = useRef(0)
  // Monotonic token per phase_exercise row for inline numeric writes. Tabbing
  // quickly across Sets / Rep Min / Rep Max fires several PATCHes on the same
  // row; only the newest one is allowed to roll the table back on failure, so a
  // slow earlier response can never resurrect a superseded number.
  const numericSeqRef = useRef<Record<string, number>>({})

  // ── Split config ────────────────────────────────────────────────────────────
  const [splitType, setSplitType]     = useState<SplitType | null>(null)
  const [splitDays, setSplitDays]     = useState<SplitDay[]>([])
  const [activeDayId, setActiveDayId] = useState<string | null>(null)

  // ── Orphan recovery (selectable) ──────────────────────────────────────────────
  // Coach can tick individual orphaned exercises and route them to any chosen day,
  // instead of being forced to dump them all into the active day at once.
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(new Set())
  const [orphanTargetDayId, setOrphanTargetDayId] = useState<string | null>(null)
  const [assigningOrphans, setAssigningOrphans]   = useState(false)

  // ── Copy a whole day's exercises into the active day ───────────────────────────
  // Similar sessions (e.g. two "Push" days) can be cloned in one click.
  const [copySourceDayId, setCopySourceDayId] = useState<string | null>(null)
  const [copyingDay, setCopyingDay]           = useState(false)

  // (Copying whole sessions from another Meso lives in <CrossMesoCopyPanel>.)
  // The last-committed (DB) split config. Used to (a) restore exact saved days
  // when the coach re-selects the saved type after previewing another, and
  // (b) detect "no changes" on save. Split config is a DRAFT: it only persists
  // when the coach presses "Lưu cấu hình giáo án".
  const [savedConfig, setSavedConfig] = useState<{ type: SplitType | null; days: SplitDay[] }>({ type: null, days: [] })

  // Day CRUD
  const [renamingDayId, setRenamingDayId] = useState<string | null>(null)
  const [renameLabel, setRenameLabel]     = useState('')
  const renameRef                         = useRef<HTMLInputElement>(null)
  // Panel thêm bài tập — dùng để tự cuộn xuống khi mở
  const addPanelRef                       = useRef<HTMLDivElement>(null)
  // Bảng "Thêm ngày": coach chọn SỐ BUỔI cho từng loại rồi thêm tất cả một lượt.
  const [addingDay, setAddingDay]           = useState(false)

  // Save states
  const [saveStatus, setSaveStatus]   = useState<SaveStatus>('idle') // explicit button
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null) // server reason on failure

  // ── Excel import (whole day at once) ─────────────────────────────────────────
  const [importOpen, setImportOpen]       = useState(false)
  /** Short-lived banner summarising the last import. */
  const [importSummary, setImportSummary] = useState<ImportResult | null>(null)

  // ── Excel import (tuần × buổi — one modal for both shapes of file) ───────────
  // The file decides what it fills: several weeks → the whole meso, one week →
  // just that week. Each write has its own summary banner.
  const [planImportOpen, setPlanImportOpen]             = useState(false)
  const [programImportSummary, setProgramImportSummary] = useState<ProgramImportResult | null>(null)
  const [weekImportSummary, setWeekImportSummary]       = useState<WeekImportResult | null>(null)

  // ── Add exercise form ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]             = useState(false)
  // The field state lives in useAddExerciseForm. The values and setters are
  // pulled out here because handleAdd reads them and the block / phase / day
  // effects below reset some of them.
  const addForm = useAddExerciseForm()
  const {
    filterPattern, setFilterPattern,
    selectedExercise, setSelectedExercise,
    targetSets, setTargetSets,
    targetRepMin, setTargetRepMin,
    targetRepMax, setTargetRepMax,
    rirTarget, setRirTarget,
    loadingStyle,
    orderLabel, setOrderLabel,
    setAddError, setAdding,
    isAmrap, setIsAmrap,
    target1rmPct, setTarget1rmPct,
    isWarmup, setIsWarmup,
    exerciseNotes, setExerciseNotes,
  } = addForm

  // ── Meso (phase) CRUD ────────────────────────────────────────────────────────
  // Coaches can add blank mesos to any block, rename them, or delete them without
  // navigating away.  All mutations are reflected in localBlocks immediately.
  const [addPhaseOpen, setAddPhaseOpen]       = useState(false)

  // Phase inline rename
  const [renamingPhaseId, setRenamingPhaseId]   = useState<string | null>(null)
  const [renamePhaseValue, setRenamePhaseValue] = useState('')
  const renamingPhaseRef                        = useRef<HTMLInputElement>(null)

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
    | { kind: 'exercise';     id: string }
    | { kind: 'day';          id: string }
    | { kind: 'phase';        id: string }
    | { kind: 'dayExercises'; id: string }    // wipe every exercise in a day (day stays)
    | { kind: 'orphans'; ids: string[] }      // delete the ticked "chưa thuộc ngày nào" exercises
    | null
  >(null)

  // ── Edit exercise modal ───────────────────────────────────────────────────────
  // Full edit of an existing phase_exercise row in one place: swap the exercise
  // itself plus every prescription field (sets / reps / RIR / %1RM / AMRAP /
  // loading style / STT). Pre-filled from the row when opened.
  const [editingExercise, setEditingExercise]   = useState<PhaseExerciseRow | null>(null)

  // ── Edit phase PARAMETERS modal (duration, frequency, rep zones, type…) ──────
  // Snapshot of the phase being edited (null = closed). The form state lives in
  // <PhaseParamsModal>.
  const [paramsPhase, setParamsPhase] = useState<Phase | null>(null)

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

  // ── Per-week scope (migration 011) ───────────────────────────────────────────
  // The builder edits one "week scope" at a time: selectedWeek === null → the
  // base rows (apply to all weeks); 1..N → that week's override rows. Every
  // display/volume/orphan computation below derives from `scopedExercises`, and
  // writes are tagged with `week_number: selectedWeek`.
  const durationWeeks = selectedPhase?.duration_weeks ?? 0
  const weekNumbers   = Array.from({ length: durationWeeks }, (_, i) => i + 1)
  /** True when the phase has ≥1 override row for that week. */
  const weekIsCustomized = (w: number) => phaseExercises.some(pe => (pe.week_number ?? null) === w)
  const scopedExercises = phaseExercises.filter(pe => (pe.week_number ?? null) === selectedWeek)
  /** A week tab is selected but it still inherits the base (no overrides yet). */
  const viewingUncustomizedWeek = selectedWeek !== null && !weekIsCustomized(selectedWeek)
  /** Count of base rows — shown in the "đang dùng Gốc" hint. */
  const baseExerciseCount = phaseExercises.filter(pe => (pe.week_number ?? null) === null).length

  // Unsaved split-config changes (type or days differ from the saved baseline).
  const configDirty = splitType !== null &&
    splitSig(splitType, splitDays) !== splitSig(savedConfig.type, savedConfig.days)

  // Exercises that genuinely have no home.
  //   • day_id null                         → never assigned
  //   • day_id points at a deleted day      → real orphan, needs recovery
  // BUT: while PREVIEWING a different/unsaved split type, exercises pinned to the
  // SAVED config's days are NOT orphans — they belong to that saved layout and
  // reappear when its type is reselected. They're hidden from this preview rather
  // than dumped into the recovery panel (assignments stay pinned to their day).
  const orphanExercises: PhaseExerciseRow[] = splitType
    ? scopedExercises.filter(pe => {
        if (!pe.day_id) return true
        if (splitDays.some(d => d.id === pe.day_id)) return false
        if (savedConfig.days.some(d => d.id === pe.day_id)) return false
        return true
      })
    : []

  // Exercises pinned to the saved config but hidden because the coach is currently
  // previewing a DIFFERENT split layout. Counted only to show a reassuring hint.
  const hiddenSavedExerciseCount = (splitType && configDirty)
    ? scopedExercises.filter(pe =>
        pe.day_id != null &&
        !splitDays.some(d => d.id === pe.day_id) &&
        savedConfig.days.some(d => d.id === pe.day_id),
      ).length
    : 0

  /**
   * The exercise rows shown in the table.
   * When a split is configured, strictly filter by the active day_id so each
   * day shows ONLY its own exercises.  Without a split → show everything.
   */
  const visibleExercises: PhaseExerciseRow[] = (splitType && activeDayId)
    ? scopedExercises.filter(pe => pe.day_id === activeDayId)
    : scopedExercises

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
    ? scopedExercises.filter(pe => pe.day_id != null && splitDayIdSet.has(pe.day_id)).length
    : scopedExercises.length

  /**
   * The next auto-assigned horizontal label for the add form preview.
   * Re-uses visibleExercises.length so it stays in sync with the table.
   */
  const nextHorizontalLabel = computeHorizontalLabel(
    (splitType && activeDayId) ? visibleExercises.length : scopedExercises.length,
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
  const weeklyVolumeByMuscle = sumMuscleVolume(
    scopedExercises,
    splitType ? 1 : (selectedPhase?.frequency_per_week ?? 1),
  )

  const rawWeeklySets   = scopedExercises.reduce(
    (sum, pe) => sum + (pe.target_sets ?? 0) * (splitType ? 1 : (selectedPhase?.frequency_per_week ?? 1)),
    0,
  )
  const maxMuscleSets   = weeklyVolumeByMuscle.reduce((m, p) => Math.max(m, p.sets), 0)

  // ── Per-SESSION volume by muscle group (một buổi tập) ─────────────────────────
  /**
   * Same fractional-credit model as weeklyVolumeByMuscle, but scoped to a single
   * buổi tập rather than the whole week.
   *
   * Newest hypertrophy research converges on a per-session ceiling: more than
   * ~11 working sets for one muscle group in a single workout yields diminishing
   * (and eventually negative) returns — the extra volume becomes junk that can
   * blunt the growth stimulus. We flag any group over the cap so the coach can
   * redistribute it to another day.
   *
   * Scope:
   *   • Split configured → visibleExercises is exactly the active day's bài tập,
   *     which IS the session — sum directly (no frequency multiplier).
   *   • No split         → the phase is one repeated session; scopedExercises is
   *     that single session, also summed directly.
   */
  const sessionVolumeByMuscle = sumMuscleVolume(visibleExercises, 1)
  const overloadedMuscles = sessionVolumeByMuscle.filter(m => m.sets > SESSION_SET_CAP)

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
    setSelectedWeek(null)
    setImportOpen(false)
    setImportSummary(null)
    setPlanImportOpen(false)
    setProgramImportSummary(null)
    setWeekImportSummary(null)
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
      setIsWarmup(false)
      setExerciseNotes('')
      return
    }

    void loadPhaseExercises(selectedPhaseId)

    const phase = phases.find(p => p.id === selectedPhaseId)
    if (phase) {
      const st = (phase.split_type as SplitType) ?? null
      setSplitType(st)
      const savedDays = Array.isArray(phase.split_days) ? (phase.split_days as SplitDay[]) : []
      const days: SplitDay[] =
        savedDays.length > 0 ? savedDays : (st ? generateDefaultDays(st) : [])
      setSplitDays(days)
      setActiveDayId(days[0]?.id ?? null)
      // Snapshot exactly what's persisted in the DB (draft baseline).
      setSavedConfig({ type: st, days: savedDays })
    }

    setAddOpen(false)
    setFilterPattern('')
    setSelectedExercise('')
    setRenamingDayId(null)
    setAddingDay(false)
    setSaveStatus('idle')
    setEditingOLId(null)
    setImportOpen(false)
    setImportSummary(null)
    setPlanImportOpen(false)
    setProgramImportSummary(null)
    setWeekImportSummary(null)
    // Per-week (migration 011): start each phase on the base ("Gốc") scope.
    setSelectedWeek(null)
    // Reset orphan-recovery & copy-day selections for the new phase context.
    setSelectedOrphanIds(new Set())
    setOrphanTargetDayId(null)
    setCopySourceDayId(null)
    // Migration 006: sync week_type from newly selected phase
    const newWeekType = (phase?.week_type ?? 'standard') as WeekType
    setPhaseWeekType(newWeekType)
    // Reset the add-form migration-006 fields — use context-appropriate defaults
    const newIsStrength = newWeekType === 'peaking' || newWeekType === 'taper'
    setIsAmrap(false)
    setTarget1rmPct('')
    setIsWarmup(false)
    setExerciseNotes('')
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
    // The three setters come from useAddExerciseForm; they are plain useState
    // setters (stable), listed only because the linter can't see that.
  }, [activeDayId, setFilterPattern, setSelectedExercise, setOrderLabel])

  // ── Data loaders ─────────────────────────────────────────────────────────────
  async function loadPhaseExercises(phaseId: string) {
    const reqId = ++loadReqRef.current
    setLoading(true)
    // Clear the previous meso's rows up front. The phase-change effect updates
    // splitDays/savedConfig to the NEW meso synchronously, but this fetch is
    // async — without this reset, the old meso's exercises linger for a tick and
    // get matched against the new meso's days. Their day_id points at the old
    // meso's (now-absent) days, so every one is mis-flagged as an orphan → the
    // long "chưa thuộc ngày nào" list the coach sees on switching meso.
    setPhaseExercises([])
    const res = await fetch(`/api/phases/${phaseId}/exercises`)
    // A newer meso load started while this one was in flight — discard this
    // (now-stale) response so it can't repaint the view with another meso's rows.
    if (reqId !== loadReqRef.current) return
    if (res.ok) {
      const data = await res.json()
      if (reqId !== loadReqRef.current) return
      setPhaseExercises(data.exercises ?? [])
    }
    setLoading(false)
  }

  // ── Split config persistence ──────────────────────────────────────────────────
  // NOTE: Split config (type + days) is a DRAFT. Mutations below only update
  // local state — nothing is persisted until the coach presses
  // "Lưu cấu hình giáo án" (handleSaveConfig). This prevents the old bug where
  // merely previewing another split type silently overwrote the saved config
  // and orphaned all assigned exercises.

  // ── Week type persistence (migration 006) ────────────────────────────────────
  async function handleWeekTypeChange(val: WeekType) {
    const newIsStrength = val === 'peaking' || val === 'taper'
    setPhaseWeekType(val)
    // Keep the in-memory phase in sync so switching meso away and back doesn't
    // re-read the stale page-load week_type. Same root cause as the split-config
    // sync in handleSaveConfig.
    patchPhase(selectedPhaseId, { week_type: val })

    // AMRAP is a hypertrophy-only technique → clear it when entering strength.
    // %1RM is now an always-available optional field, so it is NOT cleared on
    // context switch (the coach may prescribe it in any phase).
    if (newIsStrength) {
      setIsAmrap(false)
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

    // Nothing changed since the last save/load → no-op (avoids a redundant commit
    // that can error on identical re-save). Show a neutral "no changes" status.
    if (splitSig(splitType, splitDays) === splitSig(savedConfig.type, savedConfig.days)) {
      setSaveStatus('nochange')
      setTimeout(() => setSaveStatus('idle'), 2500)
      return
    }

    setSaveStatus('saving')
    try {
      // Explicitly serialise each day to { id, type, label } — the exact shape
      // stored in phases.split_days JSONB. Falls back to [] when state is empty
      // so Supabase never receives null or undefined for the NOT NULL column.
      const res = await fetch(`/api/phases/${selectedPhaseId}/commit-days`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    commitDaysBody(splitType, splitDays, phaseExercises),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error((payload as { error?: string }).error ?? 'save_failed')
      }

      // Commit succeeded → this config is now the saved baseline.
      setSavedConfig({ type: splitType, days: splitDays })
      // Sync the split config back onto the phase in localBlocks/parent. Without
      // this the in-memory phase keeps its page-load split_type/split_days, so
      // switching to another meso and back re-reads the stale phase → splitType
      // resolves to null → the table dumps every exercise into one flat list.
      patchPhase(selectedPhaseId, { split_type: splitType, split_days: splitDays })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      console.error('[handleSaveConfig]', err)
      setSaveErrorMsg(err instanceof Error && err.message !== 'save_failed' ? err.message : null)
      setSaveStatus('error')
      setTimeout(() => { setSaveStatus('idle'); setSaveErrorMsg(null) }, 6000)
    }
  }

  // ── Split type selection (LOCAL PREVIEW — never auto-persists) ─────────────────
  // Exercises are PINNED to their day_id and never moved automatically. Switching
  // the split type just swaps which days are shown:
  //   • re-selecting the saved type restores its EXACT saved days, so its pinned
  //     exercises reappear on their original days;
  //   • previewing another type shows that layout's own days (empty until the
  //     coach assigns exercises there) — the saved config's exercises stay put
  //     and are simply hidden until its type is reselected.
  function handleSetSplitType(type: SplitType) {
    const targetDays =
      (type === savedConfig.type && savedConfig.days.length > 0)
        ? savedConfig.days
        : generateDefaultDays(type)

    setSplitType(type)
    setSplitDays(targetDays)
    setActiveDayId(targetDays[0]?.id ?? null)
  }

  // ── Day CRUD ──────────────────────────────────────────────────────────────────
  /**
   * Thêm toàn bộ các ngày đã chọn trong bảng "Thêm ngày" vào split một lượt.
   * Vẫn là BẢN NHÁP như trước: chỉ vào DB khi coach bấm "Lưu cấu hình giáo án".
   */
  function handleAddDays(newDays: SplitDay[]) {
    if (!splitType || newDays.length === 0) return
    setSplitDays([...splitDays, ...newDays])
    setActiveDayId(newDays[0].id)
    setAddingDay(false)
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
  }

  function handleDeleteDay(dayId: string) {
    if (splitDays.length <= 1) return
    // Open the ConfirmModal — execution happens in executePendingDelete()
    setPendingDelete({ kind: 'day', id: dayId })
  }

  async function doDeleteDay(dayId: string) {
    if (!splitType) return
    // Xoá luôn các bài tập đã gán cho ngày này. Nếu không, day_id của chúng sẽ
    // trỏ tới một ngày vừa bị xoá → biến thành "mồ côi" và hiện lại sau khi tải.
    const ids = phaseExercises.filter(pe => pe.day_id === dayId).map(pe => pe.id)
    const updated = splitDays.filter(d => d.id !== dayId)
    setSplitDays(updated)
    if (activeDayId === dayId) setActiveDayId(updated[0]?.id ?? null)
    await deletePhaseExercises(ids)
  }

  // ── Reorder training days (← / →) ────────────────────────────────────────────
  // Swaps a day with its neighbour in the split and persists the new order.
  function moveDay(dayId: string, dir: -1 | 1) {
    if (!splitType) return
    const idx     = splitDays.findIndex(d => d.id === dayId)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= splitDays.length) return

    const updated = [...splitDays]
    ;[updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]]
    setSplitDays(updated)
  }

  // ── Exercise CRUD ─────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!selectedExercise || !selectedPhaseId) return
    // Guard: a week that still inherits the base must be customised first, so we
    // never create a partial override set (which would hide the rest of the base).
    if (viewingUncustomizedWeek) {
      setAddError('Hãy bấm “Tùy chỉnh tuần này” trước khi thêm bài cho tuần.')
      return
    }
    const repMin = parseNumericField('target_rep_min', targetRepMin, 1)
    const repMax = parseNumericField('target_rep_max', targetRepMax, isStrengthContext ? 3 : 12)
    if (repMin > repMax) {
      setAddError('Rep tối thiểu không được lớn hơn Rep tối đa.')
      return
    }

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
        target_sets:   parseNumericField('target_sets', targetSets, 3),
        target_rep_min: repMin,
        target_rep_max: repMax,
        day_id:        effectiveDayId,
        order_label:   effectiveLabel,
        loading_style: loadingStyle,
        // Per-week scope (migration 011): null = base, 1..N = that week.
        week_number:   selectedWeek,

        // ── Context-aware periodisation fields (migration 006) ──────────────
        // Strength / Peaking context → prescribe by %1RM; RIR and AMRAP suppressed
        // Hypertrophy context        → prescribe by RIR; AMRAP allowed
        rir_target:            isStrengthContext
          ? null
          : (parseInt(rirTarget) || 2),
        is_amrap:              isStrengthContext ? false : isAmrap,
        // %1RM is an always-available optional field (any phase). Empty = off.
        target_percentage_1rm: target1rmPct ? (parseInt(target1rmPct) || null) : null,
        // migration 012 — independent warmup marker
        is_warmup:             isWarmup,
        // Coach note shown to the athlete (phase_exercises.notes). Empty = none.
        notes:                 exerciseNotes.trim() || null,
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
    // Migration 012 — reset warmup flag
    setIsWarmup(false)
    setExerciseNotes('')
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

  /**
   * Hard-delete a batch of phase_exercise rows from both the DB and local state.
   * Shared by the orphan cleanup, the per-day "wipe all" action and the
   * day-deletion cascade. No-op on an empty list.
   */
  async function deletePhaseExercises(ids: string[]) {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setPhaseExercises(prev => prev.filter(pe => !idSet.has(pe.id)))
    await Promise.all(ids.map(id =>
      fetch(`/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${id}`, {
        method: 'DELETE',
      }),
    ))
  }

  // ── Meso (phase) CRUD ─────────────────────────────────────────────────────────

  /** <AddPhaseModal> created a meso: add it to the block, then switch to it. */
  function handlePhaseCreated(newPhase: Phase) {
    updateBlocks(prev => prev.map(b =>
      b.id === selectedBlockId
        ? { ...b, phases: [...(b.phases ?? []), newPhase] }
        : b,
    ))
    setSelectedPhaseId(newPhase.id)
    setAddPhaseOpen(false)
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
    patchPhase(phaseId, { name: newName })

    await fetch(`/api/phases/${phaseId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: newName }),
    })
  }

  // ── Edit phase parameters ────────────────────────────────────────────────────
  /**
   * Merge `patch` into one phase of the active block, in both the local mirror
   * and the shared parent state, so the info bar + timeline (section 1) reflect
   * the change at once.
   */
  function patchPhase(phaseId: string, patch: Partial<Phase>) {
    updateBlocks(prev => prev.map(b =>
      b.id === selectedBlockId
        ? { ...b, phases: (b.phases ?? []).map(p => p.id === phaseId ? { ...p, ...patch } : p) }
        : b,
    ))
  }

  async function doDeletePhase(phaseId: string) {
    const res = await fetch(`/api/phases/${phaseId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      updateBlocks(prev => prev.map(b =>
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
      await doDeleteDay(snapshot.id)
    } else if (snapshot.kind === 'phase') {
      await doDeletePhase(snapshot.id)
    } else if (snapshot.kind === 'orphans') {
      setSelectedOrphanIds(new Set())
      await deletePhaseExercises(snapshot.ids)
    } else if (snapshot.kind === 'dayExercises') {
      // Scope the wipe to the week currently being edited (base or an override
      // week) so clearing a day on one week never touches the others.
      await deletePhaseExercises(
        scopedExercises.filter(pe => pe.day_id === snapshot.id).map(pe => pe.id),
      )
    } else {
      await doRemoveExercise(snapshot.id)
    }
  }

  /**
   * Persist one inline numeric cell. Called once per edit (on blur / Enter),
   * never per keystroke — see InlineNumberCell for why that distinction matters.
   *
   * A blank or non-numeric entry is discarded and the stored value stands; the
   * cell re-renders from state, so the coach sees exactly what the DB holds.
   */
  async function handleUpdateNumeric(
    pe: PhaseExerciseRow,
    field: NumericField,
    value: string,
  ) {
    const parsed = parseInt(value, 10)
    if (Number.isNaN(parsed)) return

    const limits = NUMERIC_LIMITS[field]
    const numVal = Math.min(limits.max, Math.max(limits.min, parsed))

    const patch: Partial<Record<NumericField, number>> = { [field]: numVal }

    // Keep the rep window the right way round: pushing the floor above the
    // ceiling (or the ceiling below the floor) drags the other bound along
    // instead of storing an impossible range like 10-1.
    if (field === 'target_rep_min' && numVal > (pe.target_rep_max ?? numVal)) {
      patch.target_rep_max = numVal
    }
    if (field === 'target_rep_max' && numVal < (pe.target_rep_min ?? numVal)) {
      patch.target_rep_min = numVal
    }

    const entries = Object.entries(patch) as [NumericField, number][]
    if (entries.every(([k, v]) => pe[k] === v)) return   // nothing actually changed

    // Snapshot the stored values so a failed write can be rolled back.
    const before = Object.fromEntries(entries.map(([k]) => [k, pe[k]]))

    setPhaseExercises(prev =>
      prev.map(row => row.id === pe.id ? { ...row, ...patch } : row),
    )

    const seq = (numericSeqRef.current[pe.id] ?? 0) + 1
    numericSeqRef.current[pe.id] = seq

    const res = await fetch(
      `/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${pe.id}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      },
    )

    // A newer edit on this row has already been sent — it owns the cell now.
    if (numericSeqRef.current[pe.id] !== seq) return

    if (!res.ok) {
      // Never leave the table showing a number the DB doesn't have.
      setPhaseExercises(prev =>
        prev.map(row => row.id === pe.id ? { ...row, ...before } : row),
      )
    }
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

  // ── Reorder exercises within the current day (up / down) ─────────────────────
  // Swaps a row with its neighbour, then renumbers the day's sort_order so the
  // new order survives a reload. The STT badges (order_label) stay POSITIONAL —
  // i.e. position 1 keeps "A1", position 2 keeps "A2" — so swapping A1·Squat and
  // A2·Row gives A1·Row + A2·Squat (the labels don't travel with the exercise).
  async function moveExercise(phaseExerciseId: string, dir: -1 | 1) {
    const visible = visibleExercises
    const idx     = visible.findIndex(v => v.id === phaseExerciseId)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= visible.length) return

    // Snapshot the labels in their current positional order — these stay fixed.
    const labels = visible.map(v => v.order_label ?? null)

    const newVisible = [...visible]
    ;[newVisible[idx], newVisible[swapIdx]] = [newVisible[swapIdx], newVisible[idx]]

    // Rebuild local state: emit the day's rows in their new order at the array
    // slots they previously occupied, assigning each its position's sort_order
    // AND positional order_label. Other days' rows are left untouched.
    const dayIds = new Set(newVisible.map(v => v.id))
    setPhaseExercises(prev => {
      let k = 0
      return prev.map(row => {
        if (dayIds.has(row.id)) {
          const next = newVisible[k]
          const result = { ...next, sort_order: k + 1, order_label: labels[k] ?? null }
          k++
          return result
        }
        return row
      })
    })

    // Persist new position + positional STT for the affected day.
    await Promise.all(newVisible.map((v, i) =>
      fetch(`/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${v.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sort_order: i + 1, order_label: labels[i] ?? null }),
      }),
    ))
  }

  // ── Orphan recovery: re-attach exercises that lost their day to a real day ─────
  async function assignOrphansToActiveDay() {
    if (!activeDayId || orphanExercises.length === 0) return
    const ids = orphanExercises.map(e => e.id)
    setPhaseExercises(prev =>
      prev.map(pe => ids.includes(pe.id) ? { ...pe, day_id: activeDayId } : pe),
    )
    await Promise.all(ids.map(id =>
      fetch(`/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ day_id: activeDayId }),
      }),
    ))
  }

  // ── Orphan recovery — selectable subset → chosen day ──────────────────────────
  function toggleOrphanSelection(id: string) {
    setSelectedOrphanIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllOrphans() {
    setSelectedOrphanIds(prev =>
      prev.size === orphanExercises.length
        ? new Set()
        : new Set(orphanExercises.map(e => e.id)),
    )
  }

  /** Move only the ticked orphans to the coach-chosen target day. */
  async function assignSelectedOrphansToDay() {
    const targetDayId = orphanTargetDayId ?? activeDayId
    const ids = orphanExercises
      .filter(e => selectedOrphanIds.has(e.id))
      .map(e => e.id)
    if (!targetDayId || ids.length === 0) return

    setAssigningOrphans(true)
    setPhaseExercises(prev =>
      prev.map(pe => ids.includes(pe.id) ? { ...pe, day_id: targetDayId } : pe),
    )
    setSelectedOrphanIds(new Set())
    await Promise.all(ids.map(id =>
      fetch(`/api/phases/${selectedPhaseId}/exercises?phase_exercise_id=${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ day_id: targetDayId }),
      }),
    ))
    setAssigningOrphans(false)
  }

  // ── Copy a set of prescription rows into the active day ────────────────────────
  // Shared by the same-meso ("copy from another day") and cross-meso ("copy from
  // another Meso in the block") flows. Each source row is re-created as a new
  // phase_exercise pinned to activeDayId, in sort_order order, with its STT label
  // (A, B … G, or A1/A2 for supersets) preserved so nothing gets relabelled.
  async function copyExercisesIntoDay(source: PhaseExerciseRow[], targetDayId: string) {
    const ordered = [...source].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    for (const pe of ordered) {
      const res = await fetch(`/api/phases/${selectedPhaseId}/exercises`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_id:           pe.exercise_id,
          target_sets:           pe.target_sets,
          target_rep_min:        pe.target_rep_min,
          target_rep_max:        pe.target_rep_max,
          rir_target:            pe.rir_target,
          day_id:                targetDayId,
          order_label:           pe.order_label,
          loading_style:         pe.loading_style ?? 'horizontal',
          is_amrap:              pe.is_amrap,
          target_percentage_1rm: pe.target_percentage_1rm,
          is_warmup:             pe.is_warmup,
          notes:                 pe.notes,
          // Land copies in the current week scope (migration 011).
          week_number:           selectedWeek,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setPhaseExercises(prev => [...prev, data.exercise])
      }
    }
  }

  // ── Copy every exercise of another day (same meso) into the active day ─────────
  // Similar sessions (e.g. two "Push" days) can be cloned in one click.
  async function copyDayExercises() {
    if (!activeDayId || !copySourceDayId || copySourceDayId === activeDayId) return
    const source = scopedExercises.filter(pe => pe.day_id === copySourceDayId)
    if (source.length === 0) return

    setCopyingDay(true)
    await copyExercisesIntoDay(source, activeDayId)
    setCopySourceDayId(null)
    setCopyingDay(false)
  }

  // ── Excel import — fill the active day from a spreadsheet in one go ───────────
  // The endpoint has already created any missing Kho bài tập entries and returned
  // the new phase_exercise rows with their exercise joined, so both the table and
  // the exercise pickers can be updated without a round-trip.
  function handleImported(result: ImportResult) {
    setPhaseExercises(prev => [...prev, ...result.phaseExercises])
    mergeLibraryFrom(result.phaseExercises)
    setImportSummary(result)
  }

  /**
   * Fold newly-created Kho bài tập entries into the local library mirror so they
   * show up in the "Thêm bài tập" / "Sửa bài tập" pickers straight away.
   */
  function mergeLibraryFrom(rows: PhaseExerciseRow[]) {
    setExercises(prev => {
      const known  = new Set(prev.map(e => e.id))
      const fresh: Exercise[] = []
      for (const pe of rows) {
        const ex = pe.exercise
        if (!ex || known.has(ex.id)) continue
        known.add(ex.id)
        fresh.push(ex)
      }
      if (fresh.length === 0) return prev
      return [...prev, ...fresh].sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  // ── Whole-program Excel import (one sheet per week) ───────────────────────────
  // The endpoint already wrote every week's rows AND the phase's split config, so
  // the builder just adopts the returned state wholesale. The relational day
  // tables still need the usual commit, which is done here rather than making the
  // coach press "Lưu cấu hình giáo án" after an import that clearly configured
  // the meso for them.
  function handleProgramImported(result: ProgramImportResult) {
    setPhaseExercises(result.exercises)
    mergeLibraryFrom(result.exercises)

    setSplitType(result.splitType)
    setSplitDays(result.splitDays)
    setSavedConfig({ type: result.splitType, days: result.splitDays })
    setActiveDayId(result.splitDays[0]?.id ?? null)
    // Land on Gốc: it now mirrors the first imported week, and every week tab
    // shows its own override.
    setSelectedWeek(null)
    setSelectedOrphanIds(new Set())
    setCopySourceDayId(null)

    // duration_weeks / frequency_per_week may have been synced to the file — push
    // the server's phase row back into the shared state so section 1 (timeline /
    // rep matrix) redraws with the new week count.
    const phase = result.phase
    if (phase) {
      patchPhase(selectedPhaseId, phase)
    }

    setProgramImportSummary(result)

    void fetch(`/api/phases/${selectedPhaseId}/commit-days`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    commitDaysBody(result.splitType, result.splitDays, result.exercises),
    })
  }

  /**
   * One Excel import, two possible writes. The modal already worked out which
   * one the file describes — the builder just routes the result to the handler
   * that knows how to adopt it, and clears the other banner.
   */
  function handlePlanImported(result: PlanImportResult) {
    if (result.kind === 'program') {
      setWeekImportSummary(null)
      handleProgramImported(result)
    } else {
      setProgramImportSummary(null)
      handleWeekImported(result)
    }
  }

  // ── One-week Excel import (every buổi tập of one week) ───────────────────────
  // Same contract as the whole-program import, except only ONE week scope was
  // rewritten server-side: the returned rows are still the meso's full state, so
  // the table adopts them wholesale while the week tab stays where it was.
  function handleWeekImported(result: WeekImportResult) {
    setPhaseExercises(result.exercises)
    mergeLibraryFrom(result.exercises)

    // The file may have introduced new buổi tập; they arrive appended to the
    // meso's existing days, so the split config just adopts the new list.
    setSplitType(result.splitType)
    setSplitDays(result.splitDays)
    setSavedConfig({ type: result.splitType, days: result.splitDays })
    // Stay on the active day when it survived, otherwise land on the first one
    // the file wrote so the coach immediately sees what landed.
    setActiveDayId(prev =>
      prev && result.splitDays.some(d => d.id === prev) ? prev : (result.splitDays[0]?.id ?? null),
    )
    setSelectedOrphanIds(new Set())
    setCopySourceDayId(null)

    const phase = result.phase
    if (phase) {
      patchPhase(selectedPhaseId, phase)
    }

    setWeekImportSummary(result)

    // New day slots must reach workout_days, and Gốc rows their day_exercises,
    // without the coach having to press "Lưu cấu hình giáo án" afterwards.
    void fetch(`/api/phases/${selectedPhaseId}/commit-days`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    commitDaysBody(result.splitType, result.splitDays, result.exercises),
    })
  }

  // ── Copy whole sessions (buổi) from another Meso into THIS meso ────────────────
  // For each selected source day we CREATE a new day in the current split (draft,
  // persisted when the coach saves the config) and clone all of that day's
  // exercises into it. Lets a coach reuse e.g. every Fullbody session from Meso 1
  // when building Meso 2 instead of rebuilding each one by hand.
  // `chosen` = the source days ticked in <CrossMesoCopyPanel> (in the source
  // meso's own order); `sourceRows` = that meso's exercises.
  async function copyCrossSessions(chosen: SplitDay[], sourceRows: PhaseExerciseRow[]) {
    if (!splitType || chosen.length === 0) return

    // Build the new days first. Keep the source meso's own session names so the
    // copy is recognisable; only disambiguate on an exact-label collision against
    // both the existing split and the days we're adding in this same batch.
    const working = [...splitDays]
    const usedLabels = new Set(working.map(d => d.label))
    const created: { newId: string; sourceDayId: string }[] = []
    for (const srcDay of chosen) {
      const newId = crypto.randomUUID()
      let label = srcDay.label
      for (let n = 2; usedLabels.has(label); n++) label = `${srcDay.label} (${n})`
      usedLabels.add(label)
      working.push({ id: newId, type: srcDay.type, label })
      created.push({ newId, sourceDayId: srcDay.id })
    }
    setSplitDays(working)

    // Clone each source day's exercises into its freshly-created day.
    for (const { newId, sourceDayId } of created) {
      // Copy the source meso's BASE rows (week_number null) for that day.
      const source = sourceRows.filter(
        pe => pe.day_id === sourceDayId && (pe.week_number ?? null) === null,
      )
      await copyExercisesIntoDay(source, newId)
    }

    // Jump to the first newly-added day so the coach sees the result.
    if (created[0]) setActiveDayId(created[0].newId)
  }

  // ── Per-week customise / reset (migration 011) ───────────────────────────────
  // Customise = clone the base rows into week-N rows (server side), then refresh.
  // Reset = delete the week-N rows so the week falls back to the base program.
  async function customizeWeek(week: number) {
    if (!selectedPhaseId) return
    setWeekBusy(true)
    try {
      const res = await fetch(`/api/phases/${selectedPhaseId}/weeks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ week }),
      })
      // Re-load through the ordered GET so the cloned rows come back in the same
      // sort_order / STT order as Gốc (the route's own select is unordered).
      if (res.ok) await loadPhaseExercises(selectedPhaseId)
    } finally {
      setWeekBusy(false)
    }
  }

  async function resetWeek(week: number) {
    if (!selectedPhaseId) return
    setWeekBusy(true)
    try {
      const res = await fetch(`/api/phases/${selectedPhaseId}/weeks?week=${week}`, { method: 'DELETE' })
      if (res.ok) await loadPhaseExercises(selectedPhaseId)
    } finally {
      setWeekBusy(false)
    }
  }

  /** Open the "Nhập từ Excel (tuần & buổi)" modal with both result banners cleared. */
  function openPlanImport() {
    setProgramImportSummary(null)
    setWeekImportSummary(null)
    setPlanImportOpen(true)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── Phase (meso) selector + inline CRUD ──────────────────────────── */}
      {/* Block selection is controlled by ProgramsWorkspace (section 1).     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <PhaseTabs
        activeBlock={activeBlock}
        phases={phases}
        selectedPhaseId={selectedPhaseId}
        setSelectedPhaseId={setSelectedPhaseId}
        renamingPhaseId={renamingPhaseId}
        setRenamingPhaseId={setRenamingPhaseId}
        renamingPhaseRef={renamingPhaseRef}
        renamePhaseValue={renamePhaseValue}
        setRenamePhaseValue={setRenamePhaseValue}
        startRenamePhase={startRenamePhase}
        commitRenamePhase={commitRenamePhase}
        setPendingDelete={setPendingDelete}
        setAddPhaseOpen={setAddPhaseOpen}
      />

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
            onClick={() => setAddPhaseOpen(true)}
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

            {/* Sửa toàn bộ thông số giai đoạn (khoảng reps, độ dài, tần suất…) */}
            <button
              type="button"
              onClick={() => setParamsPhase(selectedPhase)}
              title="Chỉnh sửa thông số giai đoạn"
              className="inline-flex items-center gap-1 rounded-md border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink/60 hover:border-amber hover:text-amber hover:bg-amber/5 transition-colors"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Sửa thông số
            </button>

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
          </div>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── WEEK SCOPE (migration 011) ─────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {durationWeeks > 0 && (
            <WeekScopeBar
              weekBusy={weekBusy}
              selectedPhaseId={selectedPhaseId}
              selectedWeek={selectedWeek}
              setSelectedWeek={setSelectedWeek}
              weekNumbers={weekNumbers}
              weekIsCustomized={weekIsCustomized}
              viewingUncustomizedWeek={viewingUncustomizedWeek}
              baseExerciseCount={baseExerciseCount}
              customizeWeek={customizeWeek}
              setPendingWeekReset={setPendingWeekReset}
              openPlanImport={openPlanImport}
            />
          )}

          {/* Result of the last one-week import — only that week changed. */}
          {weekImportSummary && (
            <WeekImportBanner
              weekImportSummary={weekImportSummary}
              onDismiss={() => setWeekImportSummary(null)}
            />
          )}

          {/* Result of the last whole-program import — the meso's weeks, days and
              exercises were all rewritten, so summarise what landed. */}
          {programImportSummary && (
            <ProgramImportBanner
              programImportSummary={programImportSummary}
              onDismiss={() => setProgramImportSummary(null)}
            />
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── SPLIT CONFIG SECTION ───────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          <SplitConfigCard
            recommended={recommended}
            splitType={splitType}
            selectedPhase={selectedPhase}
            handleSetSplitType={handleSetSplitType}
            handleSaveConfig={handleSaveConfig}
            saveStatus={saveStatus}
            configDirty={configDirty}
            saveErrorMsg={saveErrorMsg}
            splitDays={splitDays}
            activeDayId={activeDayId}
            setActiveDayId={setActiveDayId}
            activeDay={activeDay}
            renamingDayId={renamingDayId}
            setRenamingDayId={setRenamingDayId}
            renameRef={renameRef}
            renameLabel={renameLabel}
            setRenameLabel={setRenameLabel}
            startRenameDay={startRenameDay}
            commitRenameDay={commitRenameDay}
            moveDay={moveDay}
            handleDeleteDay={handleDeleteDay}
            addingDay={addingDay}
            setAddingDay={setAddingDay}
            handleAddDays={handleAddDays}
            scopedExercises={scopedExercises}
            visibleExercises={visibleExercises}
          />

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── WEEKLY VOLUME SUMMARY ──────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {weeklyVolumeByMuscle.length > 0 && !loading && (
            <WeeklyVolumeSummary
              weeklyVolumeByMuscle={weeklyVolumeByMuscle}
              selectedPhase={selectedPhase}
              splitType={splitType}
              rawWeeklySets={rawWeeklySets}
              maxMuscleSets={maxMuscleSets}
            />
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── SESSION OVERLOAD WARNING ───────────────────────────────── */}
          {/* Cảnh báo khi một nhóm cơ vượt quá 11 hiệp trong một buổi tập. */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {overloadedMuscles.length > 0 && !loading && (
            <SessionOverloadWarning
              overloadedMuscles={overloadedMuscles}
              splitType={splitType}
              activeDay={activeDay}
            />
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
                  : (scopedExercises.length > visibleExercises.length
                      ? ` / ${scopedExercises.length} tổng`
                      : '')})
              </span>
            </h3>
            <div className="flex items-center gap-2">
              {splitType && activeDay && visibleExercises.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingDelete({ kind: 'dayExercises', id: activeDayId! })}
                  className="text-xs font-semibold text-danger/70 hover:text-danger px-2.5 py-1.5 rounded-lg hover:bg-danger/8 transition-colors"
                >
                  Xoá tất cả bài tập
                </button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setImportSummary(null); setImportOpen(true) }}
                disabled={viewingUncustomizedWeek || !selectedPhaseId}
                title={viewingUncustomizedWeek
                  ? 'Hãy “Tùy chỉnh tuần này” trước'
                  : 'Nhập cả buổi tập từ file Excel'}
              >
                ⬆ Nhập Excel
              </Button>
              <Button
                size="sm"
                onClick={() => setAddOpen(v => !v)}
                disabled={viewingUncustomizedWeek}
                title={viewingUncustomizedWeek ? 'Hãy “Tùy chỉnh tuần này” trước' : undefined}
              >
                {addOpen ? '✕ Đóng' : '+ Thêm bài tập'}
              </Button>
            </div>
          </div>

          {/* Result of the last Excel import — highlights any name that was newly
              added to Kho bài tập, since those still need their details filled in. */}
          {importSummary && (
            <DayImportBanner
              importSummary={importSummary}
              activeDay={activeDay}
              onDismiss={() => setImportSummary(null)}
            />
          )}

          {/* Preview hint — assignments are pinned, so saved-config exercises are
              hidden (not lost) while another layout is being previewed. */}
          {hiddenSavedExerciseCount > 0 && (
            <div className="rounded-xl border border-ink/10 bg-ink/3 px-4 py-2.5 text-xs text-ink/60">
              👁 Đang xem thử cấu hình khác. {hiddenSavedExerciseCount} bài tập của cấu hình đã lưu
              {savedConfig.type ? ` (${getSplitConfig(savedConfig.type).label})` : ''} vẫn được giữ nguyên — chọn lại kiểu đã lưu để xem, hoặc bấm “Lưu cấu hình giáo án” để chuyển hẳn sang cấu hình này.
            </div>
          )}

          {/* Copy-from-another-day — clone a similar session's exercises into the
              active day in one click. Only days that actually have exercises are
              offered as a source. */}
          {splitType && activeDay && !viewingUncustomizedWeek && (() => {
            const sourceDays = splitDays.filter(
              d => d.id !== activeDayId &&
                   scopedExercises.some(pe => pe.day_id === d.id),
            )
            if (sourceDays.length === 0) return null
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/8 bg-ink/3 px-4 py-2.5">
                <span className="text-xs text-ink/55">
                  Sao chép bài tập từ ngày khác vào “<span className="font-semibold text-ink">{activeDay.label}</span>”:
                </span>
                <select
                  value={copySourceDayId ?? ''}
                  onChange={e => setCopySourceDayId(e.target.value || null)}
                  className="rounded-lg border border-ink/15 bg-white px-2.5 py-1 text-xs text-ink focus:outline-none focus:border-amber"
                >
                  <option value="">— Chọn ngày nguồn —</option>
                  {sourceDays.map(d => {
                    const n = scopedExercises.filter(pe => pe.day_id === d.id).length
                    return (
                      <option key={d.id} value={d.id}>
                        {d.label} ({n} bài)
                      </option>
                    )
                  })}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void copyDayExercises()}
                  disabled={!copySourceDayId || copyingDay}
                >
                  {copyingDay ? 'Đang sao chép…' : 'Sao chép'}
                </Button>
              </div>
            )
          })()}

          {/* Copy-whole-sessions-from-another-meso — replicate entire buổi tập
              (new days + their exercises) built in a different mesocycle of the
              same block. Pick a meso, tick the sessions to bring over (or all),
              then "Sao chép" creates them in THIS meso. New days are draft until
              the coach presses "Lưu cấu hình giáo án". */}
          <CrossMesoCopyPanel
            visible={!!splitType && !viewingUncustomizedWeek}
            phases={phases}
            selectedPhaseId={selectedPhaseId}
            onCopy={copyCrossSessions}
          />

          {/* Orphan-recovery banner — exercises that lost their day (e.g. from a
              previous split-type change). They still exist; re-attach them here.
              Coach ticks the ones to move, picks a target day, then confirms. */}
          {splitType && orphanExercises.length > 0 && (
            <OrphanPanel
              orphanExercises={orphanExercises}
              selectedOrphanIds={selectedOrphanIds}
              orphanTargetDayId={orphanTargetDayId}
              setOrphanTargetDayId={setOrphanTargetDayId}
              activeDayId={activeDayId}
              activeDay={activeDay}
              splitDays={splitDays}
              assigningOrphans={assigningOrphans}
              toggleSelectAllOrphans={toggleSelectAllOrphans}
              toggleOrphanSelection={toggleOrphanSelection}
              assignOrphansToActiveDay={assignOrphansToActiveDay}
              assignSelectedOrphansToDay={assignSelectedOrphansToDay}
              setPendingDelete={setPendingDelete}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
            </div>
          ) : visibleExercises.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-center text-ink/40 py-4">
                  {viewingUncustomizedWeek
                    ? `Tuần ${selectedWeek} đang dùng bộ Gốc (${baseExerciseCount} bài). Bấm “Tùy chỉnh tuần này” ở trên để chỉnh riêng cho tuần.`
                    : splitType && activeDay
                      ? `Ngày "${activeDay.label}" chưa có bài tập. Dùng "+ Thêm bài tập" để gán.`
                      : 'Giai đoạn này chưa có bài tập nào.'}
                </p>
              </CardBody>
            </Card>
          ) : (
            <ExerciseTable
              visibleExercises={visibleExercises}
              editingOLId={editingOLId}
              editingOLValue={editingOLValue}
              setEditingOLValue={setEditingOLValue}
              setEditingOLId={setEditingOLId}
              commitOrderLabel={commitOrderLabel}
              startEditOrderLabel={startEditOrderLabel}
              handleUpdateNumeric={handleUpdateNumeric}
              moveExercise={moveExercise}
              startEditExercise={setEditingExercise}
              handleRemove={handleRemove}
            />
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── ADD EXERCISE PANEL ──────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {addOpen && (
            <div ref={addPanelRef} className="scroll-mt-4">
              <AddExercisePanel
                form={addForm}
                selectedPhase={selectedPhase}
                activeDay={activeDay}
                splitType={splitType}
                patternOptions={patternOptions}
                filteredExercises={filteredExercises}
                phaseWeekType={phaseWeekType}
                isStrengthContext={isStrengthContext}
                nextHorizontalLabel={nextHorizontalLabel}
                handleAdd={handleAdd}
                onClose={() => setAddOpen(false)}
              />
            </div>
          )}
        </>
      )}

      {/* ── Add Phase (Meso) modal ───────────────────────────────────────── */}
      <AddPhaseModal
        open={addPhaseOpen}
        onClose={() => setAddPhaseOpen(false)}
        selectedBlockId={selectedBlockId}
        onCreated={handlePhaseCreated}
      />

      {/* ── Nhập bài tập của một buổi từ Excel ───────────────────────────── */}
      {selectedPhaseId && (
        <ImportScheduleExcelModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          exercises={exercises}
          phaseId={selectedPhaseId}
          dayId={splitType ? activeDayId : null}
          dayLabel={splitType ? (activeDay?.label ?? null) : null}
          weekNumber={selectedWeek}
          onImported={handleImported}
        />
      )}

      {/* ── Nhập từ Excel: nhiều buổi trong một tuần, hoặc cả chương trình ── */}
      {selectedPhaseId && (
        <ImportPlanExcelModal
          open={planImportOpen}
          onClose={() => setPlanImportOpen(false)}
          exercises={exercises}
          phaseId={selectedPhaseId}
          phaseName={selectedPhase?.name ?? 'Meso'}
          splitDays={splitDays}
          splitType={splitType}
          durationWeeks={durationWeeks}
          selectedWeek={selectedWeek}
          activeDayLabel={splitType ? (activeDay?.label ?? null) : null}
          onImported={handlePlanImported}
        />
      )}

      {/* ── Edit exercise modal ──────────────────────────────────────────── */}
      <EditExerciseModal
        editingExercise={editingExercise}
        onClose={() => setEditingExercise(null)}
        exercises={exercises}
        patterns={patterns}
        selectedPhaseId={selectedPhaseId}
        isStrengthContext={isStrengthContext}
        onSaved={(phaseExerciseId, row) => {
          setPhaseExercises(prev => prev.map(pe => pe.id === phaseExerciseId ? row : pe))
          setEditingExercise(null)
        }}
      />

      {/* ── Confirm delete modal ─────────────────────────────────────────── */}
      <ConfirmModal
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === 'phase'        ? 'Xoá giai đoạn' :
          pendingDelete?.kind === 'day'          ? 'Xoá ngày tập'  :
          pendingDelete?.kind === 'dayExercises' ? 'Xoá tất cả bài tập trong ngày' :
          pendingDelete?.kind === 'orphans'      ? 'Xoá bài tập đã chọn' :
          'Xoá bài tập'
        }
        description={(() => {
          if (pendingDelete?.kind === 'phase') {
            return 'Xoá giai đoạn này và tất cả bài tập bên trong? Hành động này không thể hoàn tác.'
          }
          if (pendingDelete?.kind === 'day') {
            const n = phaseExercises.filter(pe => pe.day_id === pendingDelete.id).length
            return n > 0
              ? `Xoá ngày này khỏi cấu hình và xoá luôn ${n} bài tập đã gán cho ngày? Hành động này không thể hoàn tác.`
              : 'Xoá slot ngày này khỏi cấu hình chia tách? Hành động này không thể hoàn tác.'
          }
          if (pendingDelete?.kind === 'dayExercises') {
            const n = scopedExercises.filter(pe => pe.day_id === pendingDelete.id).length
            return `Xoá toàn bộ ${n} bài tập trong ngày này (ngày vẫn được giữ lại)? Hành động này không thể hoàn tác.`
          }
          if (pendingDelete?.kind === 'orphans') {
            return `Xoá ${pendingDelete.ids.length} bài tập đã chọn khỏi giai đoạn? Hành động này không thể hoàn tác.`
          }
          return 'Bạn có chắc chắn muốn xoá bài tập này khỏi giai đoạn? Hành động này không thể hoàn tác.'
        })()}
        confirmLabel="Xoá"
        onConfirm={() => void executePendingDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* ── Confirm: khôi phục tuần về Gốc (migration 011) ───────────────────── */}
      <ConfirmModal
        open={pendingWeekReset !== null}
        title="Khôi phục tuần về Gốc"
        description={`Xoá bản tùy chỉnh của Tuần ${pendingWeekReset ?? ''}? Tuần này sẽ quay lại dùng bộ Gốc và các chỉnh sửa riêng cho tuần sẽ mất.`}
        confirmLabel="Khôi phục về Gốc"
        onConfirm={() => {
          const w = pendingWeekReset!
          setPendingWeekReset(null)
          void resetWeek(w)
        }}
        onCancel={() => setPendingWeekReset(null)}
      />

      {/* ── Edit phase parameters modal ──────────────────────────────────────── */}
      <PhaseParamsModal
        phase={paramsPhase}
        onClose={() => setParamsPhase(null)}
        onApply={patchPhase}
      />
    </div>
  )
}
