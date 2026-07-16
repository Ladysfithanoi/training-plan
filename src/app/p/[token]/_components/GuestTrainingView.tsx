'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, cn } from '@/lib/utils'
import type {
  PhaseExercise, UserProgram, WeekType, WorkoutSession,
  SessionSurvey, SurveyPerformance, SurveyRirFeel, SurveyRecovery, WorkoutSet,
} from '@/types'
import { buildGuestSuggestion, buildProgressionCue } from '@/lib/autoregulation'
import type { ProgressionCue } from '@/lib/autoregulation'
import { resolveWeekExercises } from '@/lib/phaseWeeks'
import { computeSessionVolume, computeSessionWorkingSets } from '@/lib/volumeLoad'
import { extractSuggestionFromNotes, extractSurveyFromNotes } from '@/lib/sessionNotes'
import { ExerciseMatrix } from '@/components/training/ExerciseMatrix'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 3

// ─── Types ────────────────────────────────────────────────────────────────────

interface SplitDay { id: string; type: string; label: string }

type ProgramWithJoins = UserProgram & {
  block: { name: string } | null
  current_phase: {
    name: string; duration_weeks: number; frequency_per_week: number
    week_type: WeekType | null; split_type: string | null
    split_days: SplitDay[]
  } | null
}

type SessionRow = Omit<WorkoutSession, 'sets'> & { sets: { count: number }[] }
type WeekSessionRow = WorkoutSession & { week: number; sets: WorkoutSet[] }

interface GridCell { setId: string | null; kg: string; reps: string; rir: string }
type GridState = Record<string, GridCell>

interface ActiveSet {
  id: string; exercise_id: string; set_number: number
  weight_kg: number | null; actual_reps: number | null; rir: number | null
}
type SaveStatus = 'idle' | 'saving' | 'error'

interface GuestTrainingViewProps {
  token:                 string
  athleteName:           string
  userProgram:           ProgramWithJoins | null
  phaseExercises:        PhaseExercise[]
  phaseSplitDays:        SplitDay[]
  weekInPhase:           number
  recentSessions:        SessionRow[]
  /** All completed sessions of the current phase, each tagged with its week. */
  weekSessions:          WeekSessionRow[]
  prevSuggestion:        string | null
  phaseWeekType:         WeekType
  todayCompletedSession: (WorkoutSession & { sets: WorkoutSet[] }) | null
  /** True when the last meso just expired and the whole program is now completed. */
  programCompleted?:     boolean
}

// ─── Survey options ───────────────────────────────────────────────────────────

const PERF_OPTIONS: { value: SurveyPerformance; label: string; letter: string }[] = [
  { value: 'exceed', label: 'Vượt mục tiêu',    letter: 'A' },
  { value: 'meet',   label: 'Đạt vừa đủ',       letter: 'B' },
  { value: 'miss',   label: 'Hụt / Trượt Reps', letter: 'C' },
]
const RIR_OPTIONS: { value: SurveyRirFeel; label: string; letter: string }[] = [
  { value: 'easier',    label: 'Khỏe hơn dự tính', letter: 'A' },
  { value: 'on_target', label: 'Đúng mục tiêu',    letter: 'B' },
  { value: 'too_hard',  label: 'Quá nặng',          letter: 'C' },
]
const RECOVERY_OPTIONS: { value: SurveyRecovery; label: string; letter: string }[] = [
  { value: 'great',  label: 'Sung mãn',    letter: 'A' },
  { value: 'normal', label: 'Bình thường', letter: 'B' },
  { value: 'sore',   label: 'Đau mỏi',     letter: 'C' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortByOrderLabel(arr: PhaseExercise[]): PhaseExercise[] {
  return [...arr].sort((a, b) =>
    (a.order_label ?? 'ZZZ').localeCompare(b.order_label ?? 'ZZZ', undefined, { numeric: true }),
  )
}

function buildInitialGrid(sets: WorkoutSet[]): GridState {
  const g: GridState = {}
  for (const s of sets) {
    g[`${s.exercise_id}:${s.set_number}`] = {
      setId: s.id,
      kg:   s.weight_kg   != null ? String(s.weight_kg)   : '',
      reps: s.actual_reps != null ? String(s.actual_reps) : '',
      rir:  s.rir         != null ? String(s.rir)         : '',
    }
  }
  return g
}

function computeOverloadSuggestions(currentGrid: GridState, survey: SessionSurvey): Record<string, string> {
  const hasC = survey.performance === 'miss' || survey.rir_feel === 'too_hard' || survey.recovery === 'sore'
  const hasA = survey.performance === 'exceed' || survey.rir_feel === 'easier' || survey.recovery === 'great'
  const multiplier = hasC ? 0.95 : hasA ? 1.025 : 1.0
  const suggestions: Record<string, string> = {}
  for (const [key, cell] of Object.entries(currentGrid)) {
    if (cell.kg) {
      const newKg = Math.round(parseFloat(cell.kg) * multiplier * 4) / 4
      suggestions[key] = String(newKg)
    }
  }
  return suggestions
}

type SessionLike = Partial<Pick<WorkoutSession,
  'survey_performance' | 'survey_rir_feel' | 'survey_recovery' | 'next_week_suggestion' | 'notes'
>>

function readSessionSurvey(s: SessionLike | null | undefined): SessionSurvey | null {
  if (s?.survey_performance && s?.survey_rir_feel && s?.survey_recovery) {
    return { performance: s.survey_performance, rir_feel: s.survey_rir_feel, recovery: s.survey_recovery }
  }
  return extractSurveyFromNotes(s?.notes)
}

function readSessionSuggestion(s: SessionLike | null | undefined): string {
  return s?.next_week_suggestion ?? extractSuggestionFromNotes(s?.notes)
}

interface ExAverage { avgKg: number | null; avgReps: number; avgRir: number | null; count: number }

/** Average working-set weight & reps for one exercise across a given week. */
function averageForWeekExercise(
  weekSessions: WeekSessionRow[],
  week: number,
  exerciseId: string,
): ExAverage | null {
  const sets = weekSessions
    .filter(s => s.week === week)
    .flatMap(s => (s.sets ?? []) as WorkoutSet[])
    .filter(s => s.exercise_id === exerciseId && !s.is_warmup && s.actual_reps != null)
  if (sets.length === 0) return null
  const kgSets = sets.filter(s => s.weight_kg != null)
  const avgKg = kgSets.length
    ? Math.round((kgSets.reduce((a, s) => a + (s.weight_kg ?? 0), 0) / kgSets.length) * 4) / 4
    : null
  const avgReps = Math.round(sets.reduce((a, s) => a + (s.actual_reps ?? 0), 0) / sets.length)
  const rirSets = sets.filter(s => s.rir != null)
  const avgRir = rirSets.length
    ? Math.round(rirSets.reduce((a, s) => a + (s.rir ?? 0), 0) / rirSets.length)
    : null
  return { avgKg, avgReps, avgRir, count: sets.length }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GuestTrainingView({
  token,
  athleteName,
  userProgram,
  phaseExercises,
  phaseSplitDays,
  weekInPhase,
  recentSessions,
  weekSessions,
  prevSuggestion,
  phaseWeekType,
  todayCompletedSession,
  programCompleted = false,
}: GuestTrainingViewProps) {
  const router = useRouter()

  // ── Week selector ──────────────────────────────────────────────────────────
  const durationWeeks = userProgram?.current_phase?.duration_weeks ?? 0
  const weekNumbers: number[] = Array.from({ length: durationWeeks }, (_, i) => i + 1)

  function isDeloadWeek(w: number): boolean {
    return w === durationWeeks && (phaseWeekType === 'deload' || phaseWeekType === 'taper')
  }

  const [activeWeek, setActiveWeek] = useState<number>(
    Math.min(Math.max(weekInPhase, 1), Math.max(durationWeeks, 1)),
  )

  // ── Day tab selector ───────────────────────────────────────────────────────
  const hasSplit = phaseSplitDays.length > 0
  const [activeDayId, setActiveDayId] = useState<string | null>(phaseSplitDays[0]?.id ?? null)

  function handleWeekSelect(w: number) {
    setActiveWeek(w)
    setActiveDayId(phaseSplitDays[0]?.id ?? null)
  }

  // ── Day-scope helpers (lock isolation) ─────────────────────────────────────
  // Resolve the CURRENT week's prescription (migration 011) for initial hydration —
  // today's logged session belongs to weekInPhase, so scope to that week's rows.
  const _currentWeekRows = resolveWeekExercises(phaseExercises, weekInPhase)
  const _defaultDayId    = phaseSplitDays[0]?.id ?? null
  const _defaultDayExIds = new Set(
    (phaseSplitDays.length > 0 && _defaultDayId
      ? _currentWeekRows.filter(pe => pe.day_id === _defaultDayId)
      : _currentWeekRows
    ).map(pe => pe.exercise_id),
  )
  const _todayHasSetsForInitialDay =
    !!todayCompletedSession &&
    (todayCompletedSession.sets ?? []).some(s => _defaultDayExIds.has(s.exercise_id))

  // ── Session ──────────────────────────────────────────────────────────────────
  const [activeSession,    setActiveSession]    = useState<WorkoutSession | null>(() => todayCompletedSession ?? null)
  const activeSessionRef = useRef<WorkoutSession | null>(todayCompletedSession ?? null)
  const mountedRef       = useRef(false)
  const [sessionCreating,  setSessionCreating]  = useState(false)
  const [sessionCompleted, setSessionCompleted] = useState<boolean>(() => _todayHasSetsForInitialDay)

  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])

  // Restore in-progress session on mount
  useEffect(() => {
    if (todayCompletedSession) return
    const todayStr = new Date().toISOString().split('T')[0]
    const inProgress = recentSessions.find(s => s?.status === 'in_progress' && s?.session_date === todayStr)
    if (!inProgress) return
    fetch(`/api/p/${token}/sessions/${inProgress.id}`)
      .then(r => r.json())
      .then((body: { session?: WorkoutSession | null }) => {
        const session = body?.session
        if (!session) return
        const sets = (session.sets ?? []) as WorkoutSet[]
        setGrid(() => buildInitialGrid(sets))
        setActiveSets(sets.map(s => ({
          id: s.id, exercise_id: s.exercise_id, set_number: s.set_number,
          weight_kg: s.weight_kg ?? null, actual_reps: s.actual_reps ?? null, rir: s.rir ?? null,
        })))
        setActiveSession(session)
      })
      .catch(() => {/* silent */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Grid — initialised from server-fetched sets, scoped to initial day ───────
  const _initGrid = (): GridState => {
    if (!_todayHasSetsForInitialDay || !todayCompletedSession?.sets?.length) return {}
    return buildInitialGrid(todayCompletedSession.sets.filter(s => _defaultDayExIds.has(s.exercise_id)))
  }

  const [grid, _setGrid] = useState<GridState>(_initGrid)
  const gridRef = useRef<GridState>(_initGrid())
  function setGrid(fn: (prev: GridState) => GridState) {
    _setGrid(prev => { const next = fn(prev); gridRef.current = next; return next })
  }

  const [activeSets, setActiveSets] = useState<ActiveSet[]>(() => {
    if (!_todayHasSetsForInitialDay || !todayCompletedSession?.sets?.length) return []
    return todayCompletedSession.sets
      .filter(s => _defaultDayExIds.has(s.exercise_id))
      .map(s => ({
        id: s.id, exercise_id: s.exercise_id, set_number: s.set_number,
        weight_kg: s.weight_kg ?? null, actual_reps: s.actual_reps ?? null, rir: s.rir ?? null,
      }))
  })
  const [cellSave,      setCellSave]      = useState<Record<string, SaveStatus>>({})
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({})
  const debounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const savingMap   = useRef<Set<string>>(new Set())
  const pendingMap  = useRef<Set<string>>(new Set())

  // ── Evaluation modal ───────────────────────────────────────────────────────
  const [showEvalModal,  setShowEvalModal]  = useState(false)
  const [survey,         setSurvey]         = useState<Partial<SessionSurvey>>({})
  const [submittingEval, setSubmittingEval] = useState(false)
  const [modalNote,      setModalNote]      = useState('')

  // ── Post-session summary — scoped to the initial day tab ──────────────────
  const [showSummary, setShowSummary] = useState<boolean>(() => _todayHasSetsForInitialDay)

  const [summaryVolumeKg, setSummaryVolumeKg] = useState<number>(() => {
    if (!_todayHasSetsForInitialDay || !todayCompletedSession?.sets?.length) return 0
    const daySets = todayCompletedSession.sets.filter(s => _defaultDayExIds.has(s.exercise_id))
    return Math.round(computeSessionVolume(
      daySets.map(s => ({ actual_reps: s.actual_reps ?? null, weight_kg: s.weight_kg ?? null, is_warmup: false })),
    ))
  })

  const [summaryWorkingSets, setSummaryWorkingSets] = useState<number>(() => {
    if (!_todayHasSetsForInitialDay || !todayCompletedSession?.sets?.length) return 0
    const daySets = todayCompletedSession.sets.filter(s => _defaultDayExIds.has(s.exercise_id))
    return computeSessionWorkingSets(
      daySets.map(s => ({ actual_reps: s.actual_reps ?? null, weight_kg: s.weight_kg ?? null, is_warmup: false })),
    )
  })

  const [summaryText, setSummaryText] = useState<string>(
    () => _todayHasSetsForInitialDay ? readSessionSuggestion(todayCompletedSession) : '',
  )

  const [overloadSuggestions, setOverloadSuggestions] = useState<Record<string, string>>(() => {
    if (!_todayHasSetsForInitialDay || !todayCompletedSession?.sets?.length) return {}
    const daySets    = todayCompletedSession.sets.filter(s => _defaultDayExIds.has(s.exercise_id))
    const savedSurvey = readSessionSurvey(todayCompletedSession)
    if (!savedSurvey) return {}
    return computeOverloadSuggestions(buildInitialGrid(daySets), savedSurvey)
  })

  const [overloadTargetWeek, setOverloadTargetWeek] = useState<number | null>(() => {
    if (!_todayHasSetsForInitialDay) return null
    return readSessionSurvey(todayCompletedSession) ? weekInPhase + 1 : null
  })

  // ── History ────────────────────────────────────────────────────────────────
  const [historyPage, setHistoryPage] = useState(1)

  // ── Save toast ─────────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showSaveToast() {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500)
  }

  const [localSessions, setLocalSessions] = useState<SessionRow[]>(recentSessions)
  // Re-sync from the server prop after router.refresh(). Deliberate prop→state sync.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLocalSessions(recentSessions) }, [recentSessions])

  // ── Per-tab hydration ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }

    setSessionCompleted(false)
    setShowSummary(false)
    setSummaryText('')
    setSummaryVolumeKg(0)
    setSummaryWorkingSets(0)
    setOverloadSuggestions({})
    setOverloadTargetWeek(null)
    setGrid(() => ({}))
    setActiveSets([])

    // ── Past / future weeks: hydrate a READ-ONLY grid from stored sessions ─────
    // Sessions carry no week column — they're bucketed by session_date relative
    // to phase_start_date (server-side). Gathering every set logged in `week`
    // and filtering to the active day's exercises re-materialises that week's
    // logged data even for split programs where each day was a separate session.
    function hydrateHistoricWeek(week: number) {
      const weekRows = resolveWeekExercises(phaseExercises, week)
      const dayExIds = new Set(
        (hasSplit && activeDayId ? weekRows.filter(pe => pe.day_id === activeDayId) : weekRows)
          .map(pe => pe.exercise_id),
      )
      const daySets = weekSessions
        .filter(s => s.week === week)
        .flatMap(s => (s.sets ?? []) as WorkoutSet[])
        .filter(s => dayExIds.has(s.exercise_id))
      if (daySets.length === 0) return  // nothing logged that week/day → leave empty

      setGrid(() => buildInitialGrid(daySets))
      setActiveSets(daySets.map(s => ({
        id: s.id, exercise_id: s.exercise_id, set_number: s.set_number,
        weight_kg: s.weight_kg ?? null, actual_reps: s.actual_reps ?? null, rir: s.rir ?? null,
      })))
      setSessionCompleted(true)

      const setsForVol = daySets.map(s => ({
        actual_reps: s.actual_reps ?? null, weight_kg: s.weight_kg ?? null, is_warmup: s.is_warmup ?? false,
      }))
      setSummaryVolumeKg(Math.round(computeSessionVolume(setsForVol)))
      setSummaryWorkingSets(computeSessionWorkingSets(setsForVol))
      const sessWithSuggestion = weekSessions.find(s => s.week === week && readSessionSuggestion(s))
      if (sessWithSuggestion) setSummaryText(readSessionSuggestion(sessWithSuggestion))
      setShowSummary(true)
    }

    async function recheckSession() {
      if (activeWeek !== weekInPhase) { hydrateHistoricWeek(activeWeek); return }
      const todayStr = new Date().toISOString().split('T')[0]
      try {
        const r = await fetch(`/api/p/${token}/sessions`)
        if (!r.ok) return
        const payload  = await r.json() as { sessions?: SessionRow[] | null }
        const sessions = Array.isArray(payload.sessions) ? payload.sessions : []
        const completed = sessions.find(s => s?.status === 'completed' && s?.session_date === todayStr)
        if (!completed) return

        const r2 = await fetch(`/api/p/${token}/sessions/${completed.id}`)
        if (!r2.ok) return
        const payload2 = await r2.json() as { session?: WorkoutSession | null }
        const session  = payload2.session
        if (!session) return

        const allSets = (session.sets ?? []) as WorkoutSet[]
        const weekRows = resolveWeekExercises(phaseExercises, activeWeek)
        const activeDayExIds = new Set(
          (hasSplit && activeDayId
            ? weekRows.filter(pe => pe.day_id === activeDayId)
            : weekRows
          ).map(pe => pe.exercise_id),
        )
        const daySets = allSets.filter(s => activeDayExIds.has(s.exercise_id))
        if (daySets.length === 0) return

        const initialGrid = buildInitialGrid(daySets)
        setGrid(() => initialGrid)
        setActiveSets(daySets.map(s => ({
          id: s.id, exercise_id: s.exercise_id, set_number: s.set_number,
          weight_kg: s.weight_kg ?? null, actual_reps: s.actual_reps ?? null, rir: s.rir ?? null,
        })))
        setActiveSession(session)
        setSessionCompleted(true)

        const setsForVol = daySets.map(s => ({
          actual_reps: s.actual_reps ?? null, weight_kg: s.weight_kg ?? null, is_warmup: false,
        }))
        setSummaryVolumeKg(Math.round(computeSessionVolume(setsForVol)))
        setSummaryWorkingSets(computeSessionWorkingSets(setsForVol))
        setSummaryText(readSessionSuggestion(session))
        setShowSummary(true)

        const savedSurvey = readSessionSurvey(session)
        if (savedSurvey) {
          setOverloadSuggestions(computeOverloadSuggestions(initialGrid, savedSurvey))
          setOverloadTargetWeek(weekInPhase + 1)
        }
      } catch {/* silent */}
    }

    void recheckSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWeek, activeDayId])

  // ── Guard: no program assigned ─────────────────────────────────────────────
  if (!userProgram?.current_phase) {
    return (
      <div className="space-y-8">
        <div className="text-center py-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-2">Chương trình Tập luyện Cá nhân</p>
          <h1 className="text-3xl font-bold text-ink">{athleteName}</h1>
        </div>
        {programCompleted ? (
          <div className="rounded-2xl border border-herb/30 bg-herb/8 p-5 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-herb mb-1">Hoàn thành chương trình</p>
            <p className="text-sm text-ink/70">Chúc mừng — bạn đã hoàn thành tất cả các giai đoạn (Meso) của khối tập luyện này.</p>
            <p className="text-xs text-ink/40 mt-1">Vui lòng liên hệ huấn luyện viên để nhận giáo án tiếp theo.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-ink/8 bg-white p-5 text-center">
            <p className="text-sm text-ink/40">Chưa có chương trình tập luyện được giao.</p>
            <p className="text-xs text-ink/30 mt-1">Vui lòng liên hệ huấn luyện viên.</p>
          </div>
        )}
        <Footer />
      </div>
    )
  }

  // ── Lazy session creation ──────────────────────────────────────────────────
  async function ensureSessionBase(): Promise<string | null> {
    if (activeSessionRef.current) return `/api/p/${token}/sessions/${activeSessionRef.current.id}`
    setSessionCreating(true)
    try {
      const res = await fetch(`/api/p/${token}/sessions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase_id:        userProgram!.current_phase_id ?? null,
          user_program_id: userProgram!.id               ?? null,
        }),
      })
      if (!res.ok) return null
      const { session } = await res.json() as { session: WorkoutSession }
      setActiveSession(session)
      activeSessionRef.current = session
      setLocalSessions(prev => [{ ...session, sets: [] } as unknown as SessionRow, ...prev])
      return `/api/p/${token}/sessions/${session.id}`
    } catch { return null }
    finally { setSessionCreating(false) }
  }

  // ── Auto-save cell — concurrency-safe, 3-attempt retry ────────────────────
  async function autoSaveCell(exerciseId: string, setNum: number, attempt = 1): Promise<void> {
    const key = `${exerciseId}:${setNum}`
    if (attempt === 1) {
      if (savingMap.current.has(key)) { pendingMap.current.add(key); return }
      savingMap.current.add(key)
      pendingMap.current.delete(key)
    }

    const cell = gridRef.current[key]
    if (!cell || (!cell.kg && !cell.reps)) { savingMap.current.delete(key); return }
    if (!cell.setId && !cell.reps)         { savingMap.current.delete(key); return }

    setCellSave(prev => ({ ...prev, [key]: 'saving' }))

    const apiBase = await ensureSessionBase()
    if (!apiBase) {
      savingMap.current.delete(key)
      setCellSave(prev => ({ ...prev, [key]: 'error' }))
      return
    }

    let saved = false
    try {
      const weightKg   = cell.kg   ? parseFloat(cell.kg)    : null
      const actualReps = cell.reps ? parseInt(cell.reps, 10) : null
      const rir        = cell.rir  ? parseInt(cell.rir, 10)  : null

      if (cell.setId) {
        const r = await fetch(`${apiBase}/sets?set_id=${cell.setId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weight_kg: weightKg, actual_reps: actualReps, rir }),
        })
        if (!r.ok) throw new Error('patch_failed')
        const patchedId = cell.setId
        setActiveSets(prev => prev.map(s =>
          s.id === patchedId ? { ...s, weight_kg: weightKg, actual_reps: actualReps, rir } : s,
        ))
      } else {
        const r = await fetch(`${apiBase}/sets`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exercise_id: exerciseId, set_number: setNum,
            actual_reps: actualReps ?? 0, weight_kg: weightKg, rir, is_warmup: false,
          }),
        })
        if (!r.ok) throw new Error('post_failed')
        const payload = await r.json() as { set?: { id: string } }
        if (payload.set?.id) {
          setGrid(prev => ({ ...prev, [key]: { ...prev[key], setId: payload.set!.id } }))
          setActiveSets(prev => [...prev, {
            id: payload.set!.id, exercise_id: exerciseId, set_number: setNum,
            weight_kg: weightKg, actual_reps: actualReps, rir,
          }])
        }
      }
      saved = true
    } catch {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 300))
        return autoSaveCell(exerciseId, setNum, attempt + 1)
      }
    }

    savingMap.current.delete(key)
    if (saved) { setCellSave(prev => ({ ...prev, [key]: 'idle' })); showSaveToast() }
    else        { setCellSave(prev => ({ ...prev, [key]: 'error' })) }

    if (pendingMap.current.has(key)) {
      pendingMap.current.delete(key)
      void autoSaveCell(exerciseId, setNum)
    }
  }

  function updateCell(exerciseId: string, setNum: number, field: 'kg' | 'reps' | 'rir', value: string) {
    const key = `${exerciseId}:${setNum}`
    setGrid(prev => ({ ...prev, [key]: { ...(prev[key] ?? { setId: null, kg: '', reps: '', rir: '' }), [field]: value } }))
    setCellSave(prev => ({ ...prev, [key]: 'idle' }))
    const t = debounceMap.current.get(key)
    if (t) clearTimeout(t)
    debounceMap.current.set(key, setTimeout(() => void autoSaveCell(exerciseId, setNum), 500))
  }

  function flushCell(exerciseId: string, setNum: number) {
    const key = `${exerciseId}:${setNum}`
    const t = debounceMap.current.get(key)
    if (t) { clearTimeout(t); debounceMap.current.delete(key); void autoSaveCell(exerciseId, setNum) }
  }

  // ── Open evaluation modal ──────────────────────────────────────────────────
  function handleSaveSession() {
    setSurvey({})
    setModalNote('')
    setShowEvalModal(true)
  }

  // ── Confirm evaluation ──────────────────────────────────────────────────────
  async function handleEvalConfirm() {
    if (!activeSession) return
    setSubmittingEval(true)

    const setsForVol = Object.values(gridRef.current).map(c => ({
      actual_reps: c.reps ? parseInt(c.reps, 10) : null,
      weight_kg:   c.kg   ? parseFloat(c.kg)     : null,
      is_warmup:   false,
    }))
    const volKg    = Math.round(computeSessionVolume(setsForVol))
    const workSets = computeSessionWorkingSets(setsForVol)

    let nextSuggestion: string | null = null
    if (survey.performance && survey.rir_feel && survey.recovery) {
      nextSuggestion = buildGuestSuggestion(survey as SessionSurvey)
    }

    const noteLines = [
      ...(modalNote.trim() ? [modalNote.trim()] : []),
      ...Object.entries(exerciseNotes)
        .filter(([, n]) => n.trim())
        .map(([exId, n]) => `${phaseExercises.find(p => p.exercise_id === exId)?.exercise?.name ?? exId}: ${n.trim()}`),
    ]

    try {
      await fetch(`/api/p/${token}/sessions/${activeSession.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:               'completed',
          notes:                noteLines.length ? noteLines.join('\n') : null,
          survey_performance:   survey.performance   ?? null,
          survey_rir_feel:      survey.rir_feel       ?? null,
          survey_recovery:      survey.recovery       ?? null,
          next_week_suggestion: nextSuggestion,
        }),
      })
    } catch {/* non-fatal — summary still renders */}

    if (survey.performance && survey.rir_feel && survey.recovery) {
      setOverloadSuggestions(computeOverloadSuggestions(gridRef.current, survey as SessionSurvey))
      setOverloadTargetWeek(activeWeek + 1)
    }

    setLocalSessions(prev => prev.map(s =>
      s.id === activeSession.id ? { ...s, status: 'completed' as const } : s,
    ))

    setSummaryVolumeKg(volKg)
    setSummaryWorkingSets(workSets)
    setSummaryText(nextSuggestion ?? '')
    setSubmittingEval(false)
    setShowEvalModal(false)
    setShowSummary(true)
    setSessionCompleted(true)
    router.refresh()
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isPeaking           = phaseWeekType === 'peaking' || phaseWeekType === 'taper'
  const currentWeekIsDeload = isDeloadWeek(activeWeek)

  // Any week other than the athlete's current one is a read-only history view —
  // its grid is hydrated from stored sessions and must not accept new edits
  // (which would otherwise create a session dated today, in the wrong week).
  const isViewingPastWeek = activeWeek !== weekInPhase

  // Per-week resolution (migration 011): the active week's effective prescription,
  // falling back to the base program when that week isn't customised.
  const weekExercises = resolveWeekExercises(phaseExercises, activeWeek)
  const dayExercises = hasSplit && activeDayId
    ? weekExercises.filter(pe => pe.day_id === activeDayId)
    : weekExercises
  const sortedRows = sortByOrderLabel(dayExercises)

  // Previous-week reference (mức tạ & reps trung bình) per exercise — shown
  // INLINE on each exercise so, in e.g. week 3, you instantly see what you did
  // for that same lift in week 2 without digging back through the week tabs.
  const prevWeek = activeWeek - 1
  const prevWeekRef = prevWeek >= 1
    ? (() => {
        const labels: Record<string, string> = {}
        const cues: Record<string, ProgressionCue> = {}
        for (const pe of sortedRows) {
          const avg = averageForWeekExercise(weekSessions, prevWeek, pe.exercise_id)
          if (avg) {
            labels[pe.exercise_id] =
              `${avg.avgKg != null ? `${avg.avgKg}kg` : '—'} × ${avg.avgReps} reps`
            // This week's keep/increase/decrease cue — rep-range logic doesn't
            // apply to AMRAP or peaking/%1RM weeks, so skip those.
            if (!pe.is_amrap && !isPeaking) {
              cues[pe.exercise_id] = buildProgressionCue({
                avgKg:     avg.avgKg,
                avgReps:   avg.avgReps,
                avgRir:    avg.avgRir,
                repMin:    pe.target_rep_min,
                repMax:    pe.target_rep_max,
                rirTarget: pe.rir_target,
              })
            }
          }
        }
        return Object.keys(labels).length > 0 ? { week: prevWeek, labels, cues } : undefined
      })()
    : undefined

  const hasAnyData = Object.values(grid).some(c => c.kg || c.reps) || activeSets.length > 0
  const anySaving  = Object.values(cellSave).some(s => s === 'saving')
  const anyError   = Object.values(cellSave).some(s => s === 'error')

  const allSorted        = [...localSessions].sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime())
  const completedSessions = allSorted.filter(s => s?.status === 'completed')
  const historyTotalPages = Math.max(1, Math.ceil(completedSessions.length / ITEMS_PER_PAGE))
  const pagedHistory      = completedSessions.slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE)

  const isOverloadWeek = activeWeek === overloadTargetWeek && Object.keys(overloadSuggestions).length > 0

  const _volSets = Object.values(grid).map(c => ({
    actual_reps: c.reps ? parseInt(c.reps, 10) : null,
    weight_kg:   c.kg   ? parseFloat(c.kg)     : null,
    is_warmup:   false,
  }))
  const liveVolumeKg    = Math.round(computeSessionVolume(_volSets)) || summaryVolumeKg
  const liveWorkingSets = computeSessionWorkingSets(_volSets) || summaryWorkingSets

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Auto-save toast ──────────────────────────────────────────────── */}
      {toastVisible && (
        <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-xl bg-herb px-4 py-2.5 text-paper shadow-lg" role="status" aria-live="polite">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-sans text-sm font-semibold">Đã lưu thông tin buổi tập</span>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          EVALUATION MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {showEvalModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between px-6 pt-6 pb-4 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-ink leading-tight">Đánh giá buổi tập</h2>
                <p className="text-xs text-ink/40 mt-1">Autoregulation · Eric Helms</p>
              </div>
              <button type="button" onClick={() => setShowEvalModal(false)}
                className="mt-0.5 h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-ink/40 hover:text-ink hover:bg-slate-200 transition-colors shrink-0">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 pb-4 space-y-6 overflow-y-auto">
              <SurveyQuestion label="1 · Hiệu suất thực hiện" options={PERF_OPTIONS}
                selected={survey.performance ?? null}
                onSelect={v => setSurvey(s => ({ ...s, performance: v as SurveyPerformance }))} />
              <SurveyQuestion label="2 · Cảm giác nỗ lực (RPE)" options={RIR_OPTIONS}
                selected={survey.rir_feel ?? null}
                onSelect={v => setSurvey(s => ({ ...s, rir_feel: v as SurveyRirFeel }))} />
              <SurveyQuestion label="3 · Tình trạng cơ thể" options={RECOVERY_OPTIONS}
                selected={survey.recovery ?? null}
                onSelect={v => setSurvey(s => ({ ...s, recovery: v as SurveyRecovery }))} />

              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-2.5">Ghi chú buổi tập</p>
                <textarea rows={3} placeholder="Cảm nhận, điểm cần cải thiện, chấn thương…"
                  value={modalNote} onChange={e => setModalNote(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink resize-none outline-none focus:border-ink/30 focus:bg-white transition-colors placeholder:text-ink/25" />
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-2.5">Mục tiêu tuần sau</p>
                {survey.performance && survey.rir_feel && survey.recovery ? (
                  <div className={cn(
                    'rounded-xl border px-4 py-3.5 flex items-start gap-3',
                    survey.performance === 'miss' || survey.rir_feel === 'too_hard' || survey.recovery === 'sore'
                      ? 'border-danger/20 bg-danger/4'
                      : survey.performance === 'exceed' || survey.rir_feel === 'easier'
                        ? 'border-herb/25 bg-herb/5' : 'border-slate-200 bg-slate-50',
                  )}>
                    <span className="text-lg shrink-0 mt-0.5">📋</span>
                    <p className="text-sm text-ink/75 leading-relaxed">{buildGuestSuggestion(survey as SessionSurvey)}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-center">
                    <p className="text-xs text-ink/30">Trả lời đủ 3 câu để xem gợi ý điều chỉnh tải</p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 pt-3 pb-6 shrink-0 space-y-2.5 border-t border-slate-100">
              <button type="button" onClick={handleEvalConfirm} disabled={submittingEval}
                className="w-full rounded-xl bg-ink text-paper font-bold py-3.5 text-sm hover:bg-ink/85 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm">
                {submittingEval
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
                  : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>}
                Xác nhận hoàn thành
              </button>
              <button type="button" onClick={() => setShowEvalModal(false)}
                className="w-full rounded-xl border border-slate-200 py-3 text-sm font-medium text-ink/45 hover:text-ink hover:border-slate-300 transition-colors">
                Bỏ qua đánh giá
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">

        {/* ── Athlete header ───────────────────────────────────────────────── */}
        <div className="text-center py-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1.5">Chương trình Tập luyện Cá nhân</p>
          <h1 className="text-2xl font-bold text-ink">{athleteName}</h1>
          {userProgram.block?.name && <p className="text-sm text-ink/50 mt-0.5">{userProgram.block.name}</p>}
        </div>

        {/* ── Phase context ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-herb/25 bg-herb/5 px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-herb/70">Giai đoạn hiện tại</p>
          <h2 className="text-lg font-bold text-ink">{userProgram.current_phase.name}</h2>
          <p className="text-sm text-ink/60 mt-0.5">
            <span className="font-mono text-xs text-ink/45">Tuần {weekInPhase}/{userProgram.current_phase.duration_weeks}</span>
            {' · '}{userProgram.current_phase.frequency_per_week}× / tuần
          </p>
        </div>

        {/* ── TIER 1 — Week selector ───────────────────────────────────────── */}
        {weekNumbers.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mb-2 px-0.5">Thanh chọn Tuần</p>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scroll-smooth">
              {weekNumbers.map(w => {
                const isActive    = w === activeWeek
                const isCurrent   = w === weekInPhase
                const isDeload    = isDeloadWeek(w)
                const hasOverload = w === overloadTargetWeek && Object.keys(overloadSuggestions).length > 0
                return (
                  <button key={w} type="button" onClick={() => handleWeekSelect(w)}
                    className={cn(
                      'shrink-0 flex flex-col items-center rounded-xl border px-3.5 py-2.5 transition-all min-w-[64px]',
                      isActive && isCurrent  ? 'border-herb bg-herb/10 shadow-sm ring-1 ring-herb/30'
                        : isActive          ? 'border-ink/35 bg-ink/5 shadow-sm'
                        : isCurrent         ? 'border-herb/40 bg-herb/5'
                        : hasOverload       ? 'border-amber/40 bg-amber/6'
                        : 'border-ink/12 bg-paper hover:border-ink/25 hover:bg-ink/3',
                    )}>
                    <span className={cn(
                      'font-mono text-[11px] font-bold tabular-nums leading-none',
                      isActive && isCurrent ? 'text-herb'
                        : isActive          ? 'text-ink/75'
                        : isCurrent         ? 'text-herb/70'
                        : hasOverload       ? 'text-amber'
                        : 'text-ink/45',
                    )}>Tuần {w}</span>
                    {isCurrent   && <span className={cn('mt-1 text-[8px] font-bold uppercase leading-none', isActive ? 'text-herb' : 'text-herb/60')}>Hiện tại</span>}
                    {isDeload    && <span className="mt-1 text-[8px] font-bold uppercase text-amber leading-none">Deload</span>}
                    {hasOverload && !isCurrent && !isDeload && <span className="mt-1 text-[8px] font-bold uppercase text-amber leading-none">📈 Gợi ý</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Week banner ──────────────────────────────────────────────────── */}
        {durationWeeks > 0 && (
          <div className={cn(
            'rounded-xl border px-4 py-2.5 flex items-center justify-between gap-3',
            activeWeek === weekInPhase ? 'border-herb/25 bg-herb/5' : 'border-ink/10 bg-white',
          )}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35">{userProgram.current_phase.name}</p>
              <p className="text-sm font-semibold text-ink">
                Tuần {activeWeek} / {durationWeeks}
                {currentWeekIsDeload && <span className="ml-2 text-[9px] font-bold uppercase text-amber bg-amber/10 rounded-full px-2 py-0.5 border border-amber/20">Deload</span>}
                {phaseWeekType === 'peaking' && <span className="ml-2 text-[9px] font-bold uppercase text-danger/70 bg-danger/8 rounded-full px-2 py-0.5 border border-danger/15">⚡ Peaking</span>}
                {isOverloadWeek && <span className="ml-2 text-[9px] font-bold uppercase text-amber bg-amber/10 rounded-full px-2 py-0.5 border border-amber/20">📈 Gợi ý tăng tải</span>}
              </p>
            </div>
            {activeWeek === weekInPhase && <span className="h-2 w-2 rounded-full bg-herb animate-pulse shrink-0" />}
          </div>
        )}

        {/* ── TIER 2 — Day tabs ────────────────────────────────────────────── */}
        {hasSplit && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mb-2 px-0.5">Thanh chọn Buổi</p>
            <div className="flex flex-wrap gap-2">
              {phaseSplitDays.map(day => {
                const count    = weekExercises.filter(pe => pe.day_id === day.id).length
                const isActive = activeDayId === day.id
                return (
                  <button key={day.id} type="button" onClick={() => setActiveDayId(day.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all',
                      isActive ? 'border-ink bg-ink text-paper shadow-sm' : 'border-ink/12 text-ink/55 bg-paper hover:border-ink/30 hover:text-ink',
                    )}>
                    {day.label}
                    <span className={cn('font-mono text-[10px] tabular-nums rounded-full px-1.5 py-0.5 font-bold', isActive ? 'bg-white/15 text-paper/75' : 'bg-ink/8 text-ink/40')}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Previous suggestion banner ───────────────────────────────────── */}
        {prevSuggestion && (
          <div className="rounded-xl border-2 border-amber/30 bg-amber/6 px-4 py-3.5 flex items-start gap-3">
            <span className="text-lg shrink-0 mt-0.5">💡</span>
            <div>
              <p className="text-[10px] font-bold text-amber uppercase tracking-widest mb-1">Gợi ý từ buổi tập trước</p>
              <p className="text-sm text-ink/80 leading-relaxed">{prevSuggestion}</p>
            </div>
          </div>
        )}

        {isPeaking && <p className="text-xs text-danger/70 font-semibold">⚡ Peak — tạ nặng · reps thấp · kỹ thuật tuyệt đối</p>}

        {/* ── Read-only history banner ─────────────────────────────────────── */}
        {isViewingPastWeek && (
          <div className="rounded-xl border border-slate-300 bg-slate-100/70 px-4 py-2.5 flex items-center gap-2.5">
            <span className="text-base shrink-0">🔒</span>
            <p className="text-xs text-ink/60 leading-snug">
              Đang xem lại <span className="font-bold text-ink/80">Tuần {activeWeek}</span> — chế độ chỉ xem.
              {' '}Thông số đã ghi được giữ nguyên; chuyển về{' '}
              <button type="button" onClick={() => handleWeekSelect(weekInPhase)}
                className="font-bold text-herb underline underline-offset-2 hover:text-herb/80 transition-colors">
                Tuần {weekInPhase}
              </button>{' '}để nhập buổi tập mới.
            </p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            EXERCISE MATRIX — editable for the current week, read-only for others
        ══════════════════════════════════════════════════════════════════════ */}
        <ExerciseMatrix
          rows={sortedRows}
          grid={grid}
          activeSets={activeSets}
          cellSave={cellSave}
          exerciseNotes={exerciseNotes}
          onNoteChange={(exId, v) => setExerciseNotes(prev => ({ ...prev, [exId]: v }))}
          onCellChange={(exId, setNum, field, v) => updateCell(exId, setNum, field, v)}
          onCellBlur={(exId, setNum) => flushCell(exId, setNum)}
          overloadSuggestions={overloadSuggestions}
          isOverloadWeek={isOverloadWeek}
          isPeaking={isPeaking}
          scopeKey={`${activeWeek}:${activeDayId ?? 'all'}`}
          legendLabel={`${sortedRows.length} bài tập${hasSplit && activeDayId ? ` · ${phaseSplitDays.find(d => d.id === activeDayId)?.label ?? ''}` : ''}`}
          sessionCompleted={sessionCompleted}
          sessionCreating={sessionCreating}
          anySaving={anySaving}
          anyError={anyError}
          onSaveSession={handleSaveSession}
          saveDisabled={!hasAnyData || !activeSession}
          readOnly={isViewingPastWeek}
          prevWeekRef={prevWeekRef}
        />

        {/* ── Post-session summary ─────────────────────────────────────────── */}
        {showSummary && (
          <div className="rounded-2xl border-2 border-herb/25 bg-herb/4 px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-herb shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-[10px] font-bold uppercase tracking-widest text-herb">Buổi tập đã hoàn thành</p>
            </div>
            {liveVolumeKg > 0 && (
              <div className="flex items-baseline gap-2.5">
                <p className="text-3xl font-black font-mono text-amber tabular-nums">
                  {liveVolumeKg >= 1000 ? `${(liveVolumeKg / 1000).toFixed(1)}k` : liveVolumeKg.toLocaleString('vi-VN')}
                  <span className="text-lg font-bold ml-1">kg</span>
                </p>
                <p className="text-sm text-ink/55">· {liveWorkingSets} hiệp làm việc 💪</p>
              </div>
            )}
            {summaryText && (
              <div className="rounded-xl border border-ink/12 bg-white px-4 py-3 flex items-start gap-2.5">
                <span className="text-base shrink-0">📋</span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Kế hoạch tuần sau</p>
                  <p className="text-xs text-ink/70 leading-relaxed">{summaryText}</p>
                </div>
              </div>
            )}
            {overloadTargetWeek && Object.keys(overloadSuggestions).length > 0 && (
              <p className="text-[11px] text-ink/40">
                📈 Gợi ý tăng tải đã cập nhật vào{' '}
                <button type="button" onClick={() => handleWeekSelect(overloadTargetWeek)}
                  className="font-bold text-amber underline underline-offset-2 hover:text-amber/80 transition-colors">
                  Tuần {overloadTargetWeek}
                </button>
              </p>
            )}
          </div>
        )}

        {/* ── Action bar — desktop only (mobile uses the in-card save button) ─── */}
        {sortedRows.length > 0 && !sessionCompleted && !isViewingPastWeek && (
          <div className="hidden md:flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleSaveSession} disabled={!hasAnyData || !activeSession}
              className="rounded-xl bg-herb text-paper font-bold px-6 py-3 text-sm hover:bg-herb/90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center gap-2.5 shadow-sm">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Lưu buổi tập
            </button>
            {!hasAnyData && <span className="text-xs text-ink/35 italic">Nhập ít nhất một giá trị để lưu</span>}
            {anyError && !anySaving && (
              <span className="flex items-center gap-1.5 text-xs text-danger/65"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Lỗi lưu — kiểm tra kết nối</span>
            )}
          </div>
        )}

        {/* ── Completed history ────────────────────────────────────────────── */}
        {completedSessions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Lịch sử buổi tập</h3>
              <span className="font-mono text-[10px] text-ink/30 tabular-nums">{completedSessions.length} buổi</span>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-white divide-y divide-ink/6 overflow-hidden">
              {pagedHistory.map(s => {
                const setCount = s.sets?.[0]?.count ?? 0
                return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-herb/10 flex items-center justify-center">
                      <svg className="h-4 w-4 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink leading-tight">{formatDate(s.session_date)}</p>
                      <p className="text-xs text-ink/40 mt-0.5 font-mono tabular-nums">
                        {setCount > 0 ? `${setCount} hiệp` : 'Không có hiệp nào'}
                        {s.duration_minutes ? ` · ${s.duration_minutes} phút` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 border bg-herb/10 text-herb border-herb/20">Hoàn thành</span>
                  </div>
                )
              })}
            </div>
            <PaginationBar currentPage={historyPage} totalPages={historyTotalPages}
              onPrev={() => setHistoryPage(p => Math.max(1, p - 1))}
              onNext={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))} />
          </div>
        )}

        <Footer />
      </div>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Footer() {
  return (
    <div className="pt-2 pb-4 text-center">
      <p className="font-sans text-[11px] font-medium text-ink/20 tracking-wide">
        Powered by Trung Precision Coach System
      </p>
    </div>
  )
}

function PaginationBar({ currentPage, totalPages, onPrev, onNext }: {
  currentPage: number; totalPages: number; onPrev: () => void; onNext: () => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button type="button" onClick={onPrev} disabled={currentPage === 1} aria-label="Trang trước"
        className="h-8 w-8 flex items-center justify-center rounded-xl border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="font-mono text-xs text-ink/50 tabular-nums select-none text-center min-w-[5rem]">Trang {currentPage} / {totalPages}</span>
      <button type="button" onClick={onNext} disabled={currentPage === totalPages} aria-label="Trang sau"
        className="h-8 w-8 flex items-center justify-center rounded-xl border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}

interface SurveyQuestionProps {
  label: string; options: { value: string; label: string; letter: string }[]
  selected: string | null; onSelect: (value: string) => void
}
function SurveyQuestion({ label, options, selected, onSelect }: SurveyQuestionProps) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt, idx) => {
          const isSelected = selected === opt.value
          const isLastOdd  = options.length % 2 !== 0 && idx === options.length - 1
          return (
            <button key={opt.value} type="button" onClick={() => onSelect(opt.value)}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all active:scale-[0.97]',
                isLastOdd && 'col-span-2',
                isSelected ? 'border-ink bg-ink text-paper shadow-sm' : 'border-slate-200 bg-white text-ink/60 hover:border-slate-400 hover:text-ink',
              )}>
              <span className={cn('shrink-0 h-6 w-6 rounded-full text-[10px] font-black flex items-center justify-center leading-none', isSelected ? 'bg-white/20 text-paper' : 'bg-slate-100 text-ink/40')}>{opt.letter}</span>
              <span className={cn('text-sm font-semibold leading-tight', isSelected ? 'text-paper' : 'text-ink/70')}>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
