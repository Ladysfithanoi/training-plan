'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, cn } from '@/lib/utils'
import { HelpTip } from '@/components/ui/HelpTip'
import { GLOSSARY } from '@/lib/glossary'
import { buildNextWeekSuggestion } from '@/lib/autoregulation'
import { computeSessionVolume, computeSessionWorkingSets } from '@/lib/volumeLoad'
import { ExerciseMatrix, type ActiveSetLite } from '@/components/training/ExerciseMatrix'
import type {
  WorkoutSession,
  WorkoutSet,
  PhaseExercise,
  PhaseContext,
  DoubleProgressionHint,
  SessionSurvey,
  SurveyPerformance,
  SurveyRirFeel,
  SurveyRecovery,
} from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SplitDay { id: string; type: string; label: string }

interface GridCell {
  setId: string | null
  kg:    string
  reps:  string
  rir:   string
}

type GridState  = Record<string, GridCell>   // `${exercise_id}:${set_number}`
type SaveStatus = 'idle' | 'saving' | 'error'

// ─── Survey options ───────────────────────────────────────────────────────────

const PERFORMANCE_OPTIONS: { value: SurveyPerformance; label: string; icon: string }[] = [
  { value: 'exceed', label: 'Vượt mục tiêu',  icon: '🔥' },
  { value: 'meet',   label: 'Đạt mục tiêu',   icon: '✅' },
  { value: 'miss',   label: 'Trượt mục tiêu', icon: '📉' },
]
const RIR_OPTIONS: { value: SurveyRirFeel; label: string; icon: string }[] = [
  { value: 'easier',    label: 'Khỏe hơn dự kiến', icon: '💪' },
  { value: 'on_target', label: 'Đúng RIR',          icon: '🎯' },
  { value: 'too_hard',  label: 'Quá nặng',           icon: '😮‍💨' },
]
const RECOVERY_OPTIONS: { value: SurveyRecovery; label: string; icon: string }[] = [
  { value: 'great',  label: 'Khỏe mạnh',   icon: '⚡' },
  { value: 'normal', label: 'Bình thường', icon: '😐' },
  { value: 'sore',   label: 'Đau nhức',    icon: '🤕' },
]

const PHASE_CATEGORY_LABEL: Record<string, string> = {
  volume: 'Giai đoạn Tích lũy',
  load:   'Giai đoạn Tăng tải',
  peak:   'Giai đoạn Đạt đỉnh',
  other:  'Giai đoạn Tập luyện',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInitialGrid(sets: WorkoutSet[]): GridState {
  const grid: GridState = {}
  for (const s of sets) {
    const key = `${s.exercise_id}:${s.set_number}`
    grid[key] = {
      setId: s.id,
      kg:   s.weight_kg   != null ? String(s.weight_kg)   : '',
      reps: s.actual_reps != null ? String(s.actual_reps) : '',
      rir:  s.rir         != null ? String(s.rir)         : '',
    }
  }
  return grid
}

function sortByOrderLabel(exercises: PhaseExercise[]): PhaseExercise[] {
  return [...exercises].sort((a, b) =>
    (a.order_label ?? 'ZZZ').localeCompare(b.order_label ?? 'ZZZ', undefined, { numeric: true }),
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkoutLoggerProps {
  session:        WorkoutSession
  phaseExercises: PhaseExercise[]
  phaseSplitDays: SplitDay[]
  phaseContext:   PhaseContext | null
  prevSuggestion: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkoutLogger({
  session,
  phaseExercises,
  phaseSplitDays,
  phaseContext,
  prevSuggestion,
}: WorkoutLoggerProps) {
  const router = useRouter()
  const apiBase    = `/api/workouts/${session.id}`
  const isCompleted = session.status === 'completed'
  const isPeaking   = phaseContext?.weekType === 'peaking' || phaseContext?.weekType === 'taper'

  // ── Grid state (ref-mirrored for stale-closure-safe async saves) ───────────
  const [grid, _setGrid] = useState<GridState>(() =>
    buildInitialGrid((session.sets ?? []) as WorkoutSet[])
  )
  const gridRef = useRef<GridState>(grid)
  function setGrid(fn: (prev: GridState) => GridState) {
    _setGrid(prev => {
      const next = fn(prev)
      gridRef.current = next
      return next
    })
  }

  // ── Per-cell save status ───────────────────────────────────────────────────
  const [cellSave, setCellSave] = useState<Record<string, SaveStatus>>({})

  // ── Per-exercise notes ────────────────────────────────────────────────────
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({})

  // ── Week selector (Tier 1) ─────────────────────────────────────────────────
  const durationWeeks = phaseContext?.durationWeeks ?? 0
  const weekNumbers   = Array.from({ length: durationWeeks }, (_, i) => i + 1)
  const [activeWeek, setActiveWeek] = useState<number>(
    Math.min(Math.max(phaseContext?.weekInPhase ?? 1, 1), Math.max(durationWeeks, 1)),
  )
  const isDeloadWeek = (w: number) =>
    w === durationWeeks && (phaseContext?.weekType === 'deload' || phaseContext?.weekType === 'taper')

  // ── Day tab (Tier 2) ───────────────────────────────────────────────────────
  const hasSplit   = phaseSplitDays.length > 0
  const [activeDayId, setActiveDayId] = useState<string | null>(
    phaseSplitDays[0]?.id ?? null,
  )

  // Switching week resets day to first tab
  function handleWeekSelect(w: number) {
    setActiveWeek(w)
    setActiveDayId(phaseSplitDays[0]?.id ?? null)
  }

  // ── Auto-save toast ────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showSaveToast() {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500)
  }

  // ── Double-progression hints (keyed by exercise_id) ───────────────────────
  const [progressionHints, setProgressionHints] = useState<Record<string, DoubleProgressionHint>>({})

  // ── Post-workout celebration ───────────────────────────────────────────────
  const [sessionComplete,      setSessionComplete]      = useState(false)
  const [completedVolumeKg,    setCompletedVolumeKg]    = useState(0)
  const [completedWorkingSets, setCompletedWorkingSets] = useState(0)
  const [finishing,            setFinishing]            = useState(false)

  // ── Autoregulation survey ──────────────────────────────────────────────────
  const [survey, setSurvey] = useState<Partial<SessionSurvey>>({})

  // ── Debounce timers ────────────────────────────────────────────────────────
  const debounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-save machinery
  // ─────────────────────────────────────────────────────────────────────────

  async function autoSaveCell(exerciseId: string, setNum: number) {
    const cellKey = `${exerciseId}:${setNum}`
    const cell    = gridRef.current[cellKey]
    if (!cell) return

    if (!cell.setId && !cell.reps) return
    if (!cell.kg && !cell.reps) return

    setCellSave(prev => ({ ...prev, [cellKey]: 'saving' }))

    try {
      const weightKg   = cell.kg   ? parseFloat(cell.kg)    : null
      const actualReps = cell.reps ? parseInt(cell.reps, 10) : null
      const rir        = cell.rir  ? parseInt(cell.rir, 10)  : null

      if (cell.setId) {
        // PATCH existing set — server recomputes rpe + e1RM from rir
        const res = await fetch(`${apiBase}/sets?set_id=${cell.setId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ weight_kg: weightKg, actual_reps: actualReps, rir }),
        })
        if (!res.ok) throw new Error('patch_failed')
      } else {
        // POST new set
        const res = await fetch(`${apiBase}/sets`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            exercise_id: exerciseId,
            set_number:  setNum,
            actual_reps: actualReps ?? 0,
            weight_kg:   weightKg,
            rir,
            is_warmup:   false,
          }),
        })
        if (!res.ok) throw new Error('post_failed')
        const payload = await res.json() as {
          set?:           { id: string }
          hint?:          DoubleProgressionHint | null
          estimatedOneRm?: number | null
        }
        if (payload.set?.id) {
          setGrid(prev => ({
            ...prev,
            [cellKey]: { ...prev[cellKey], setId: payload.set!.id },
          }))
        }
        // Store double-progression hint
        if (payload.hint?.shouldIncrease) {
          setProgressionHints(prev => ({ ...prev, [exerciseId]: payload.hint! }))
        }
      }

      setCellSave(prev => ({ ...prev, [cellKey]: 'idle' }))
      showSaveToast()
    } catch {
      setCellSave(prev => ({ ...prev, [cellKey]: 'error' }))
    }
  }

  function updateCell(
    exerciseId: string,
    setNum:     number,
    field:      'kg' | 'reps' | 'rir',
    value:      string,
  ) {
    const cellKey = `${exerciseId}:${setNum}`
    setGrid(prev => ({
      ...prev,
      [cellKey]: {
        ...(prev[cellKey] ?? { setId: null, kg: '', reps: '', rir: '' }),
        [field]: value,
      },
    }))
    setCellSave(prev => ({ ...prev, [cellKey]: 'idle' }))

    const existing = debounceMap.current.get(cellKey)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => void autoSaveCell(exerciseId, setNum), 700)
    debounceMap.current.set(cellKey, timer)
  }

  function flushCell(exerciseId: string, setNum: number) {
    const cellKey  = `${exerciseId}:${setNum}`
    const existing = debounceMap.current.get(cellKey)
    if (existing) {
      clearTimeout(existing)
      debounceMap.current.delete(cellKey)
      void autoSaveCell(exerciseId, setNum)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session finish
  // ─────────────────────────────────────────────────────────────────────────

  async function finishSession() {
    setFinishing(true)

    const setsForVolume = Object.values(gridRef.current).map(c => ({
      actual_reps: c.reps ? parseInt(c.reps, 10) : null,
      weight_kg:   c.kg   ? parseFloat(c.kg)     : null,
      is_warmup:   false,
    }))
    const volumeKg         = computeSessionVolume(setsForVolume)
    const workingSetsCount = computeSessionWorkingSets(setsForVolume)

    // Compose exercise notes into session notes
    const noteLines = Object.entries(exerciseNotes)
      .filter(([, n]) => n.trim())
      .map(([exId, n]) => {
        const pe   = phaseExercises.find(p => p.exercise_id === exId)
        const name = pe?.exercise?.name ?? exId
        return `${name}: ${n.trim()}`
      })

    let nextWeekSuggestion: string | null = null
    if (survey.performance && survey.rir_feel && survey.recovery) {
      nextWeekSuggestion = buildNextWeekSuggestion(survey as SessionSurvey)
    }

    await fetch(apiBase, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status:               'completed',
        notes:                noteLines.length ? noteLines.join('\n') : null,
        survey_performance:   survey.performance  ?? null,
        survey_rir_feel:      survey.rir_feel     ?? null,
        survey_recovery:      survey.recovery     ?? null,
        next_week_suggestion: nextWeekSuggestion,
      }),
    })

    setFinishing(false)
    setCompletedVolumeKg(Math.round(volumeKg))
    setCompletedWorkingSets(workingSetsCount)
    setSessionComplete(true)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derived values
  // ─────────────────────────────────────────────────────────────────────────

  const dayExercises = hasSplit && activeDayId
    ? phaseExercises.filter(pe => pe.day_id === activeDayId)
    : phaseExercises
  const sortedRows   = sortByOrderLabel(dayExercises)

  // Các hiệp đã lưu của buổi tập — ma trận dùng để đổ lại số liệu cho những ô
  // chưa có trong `grid` (grid đã nạp sẵn từ session.sets nên đây là dự phòng).
  const activeSets: ActiveSetLite[] = ((session.sets ?? []) as WorkoutSet[]).map(s => ({
    id:          s.id,
    exercise_id: s.exercise_id,
    set_number:  s.set_number,
    weight_kg:   s.weight_kg,
    actual_reps: s.actual_reps,
    rir:         s.rir,
  }))

  const hasAnyData   = Object.values(grid).some(c => c.kg || c.reps)
  const anySaving    = Object.values(cellSave).some(s => s === 'saving')
  const anyError     = Object.values(cellSave).some(s => s === 'error')

  // ─────────────────────────────────────────────────────────────────────────
  // Post-workout celebration card
  // ─────────────────────────────────────────────────────────────────────────

  if (sessionComplete) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
        <div className="text-6xl animate-bounce" role="img" aria-label="Tuyệt vời">🏆</div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold text-ink">Buổi tập hoàn thành!</h2>
          <p className="text-sm text-ink/50">{formatDate(session.session_date)}</p>
          {phaseContext && (
            <p className="text-xs text-ink/35">
              {phaseContext.phaseName} · Tuần {phaseContext.weekInPhase}/{phaseContext.durationWeeks}
            </p>
          )}
        </div>

        {completedVolumeKg > 0 ? (
          <div className="w-full max-w-sm rounded-2xl border-2 border-amber/30 bg-amber/6 px-6 py-5 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber/70">
              Tổng khối lượng tạ hôm nay
            </p>
            <p className="text-4xl font-black font-mono text-amber tabular-nums">
              {completedVolumeKg >= 1000
                ? `${(completedVolumeKg / 1000).toFixed(1)}k`
                : completedVolumeKg.toLocaleString('vi-VN')}
              <span className="text-2xl font-bold ml-1">kg</span>
            </p>
            <p className="text-sm text-ink/55 pt-1">
              {completedVolumeKg.toLocaleString('vi-VN')} kg ·{' '}
              <strong className="text-ink">{completedWorkingSets} hiệp làm việc</strong> 💪
            </p>
          </div>
        ) : (
          <div className="w-full max-w-sm rounded-2xl border border-herb/25 bg-herb/5 px-6 py-5">
            <p className="text-sm font-semibold text-herb">Buổi tập đã được ghi nhận!</p>
            <p className="text-xs text-ink/45 mt-1">
              {completedWorkingSets > 0
                ? `${completedWorkingSets} hiệp hoàn thành.`
                : 'Thêm tạ vào các hiệp để theo dõi thể tích.'}
            </p>
          </div>
        )}

        {survey.performance && survey.rir_feel && survey.recovery && (
          <div className="w-full max-w-sm rounded-xl border border-ink/12 bg-ink/3 px-4 py-3.5 flex items-start gap-2.5 text-left">
            <span className="text-base shrink-0">📋</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">
                Kế hoạch tuần sau
              </p>
              <p className="text-xs text-ink/70 leading-relaxed">
                {buildNextWeekSuggestion(survey as SessionSurvey)}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => { router.push('/workouts'); router.refresh() }}
          className="rounded-xl bg-herb text-paper font-semibold px-8 py-3 text-base hover:bg-herb/90 active:scale-[0.98] transition-all shadow-sm"
        >
          ← Quay lại nhật ký
        </button>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main matrix view
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>

    {/* ── Auto-save toast ────────────────────────────────────────────────────── */}
    {toastVisible && (
      <div
        className="fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-xl bg-herb px-4 py-2.5 text-paper shadow-lg"
        role="status"
        aria-live="polite"
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span className="font-sans text-sm font-semibold">Đã lưu thông tin buổi tập</span>
      </div>
    )}

    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber mb-1">
            Nhật ký tập luyện
          </p>
          <h1 className="text-2xl font-bold text-ink">{formatDate(session.session_date)}</h1>
          {phaseContext && (
            <p className="text-sm text-ink/40 mt-0.5">
              {phaseContext.phaseName}
              {PHASE_CATEGORY_LABEL[phaseContext.category] && (
                <> · <span className="text-ink/30">{PHASE_CATEGORY_LABEL[phaseContext.category]}</span></>
              )}
              {' · '}Tuần <span className="font-mono">{phaseContext.weekInPhase}</span>/{phaseContext.durationWeeks}
            </p>
          )}
          {isPeaking && (
            <p className="text-xs text-danger/70 mt-1 font-semibold">
              ⚡ Peak — tạ nặng · reps thấp · kỹ thuật tuyệt đối
            </p>
          )}
        </div>
        <span className={cn(
          'shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 border',
          isCompleted
            ? 'bg-ink/5 text-ink/40 border-ink/10'
            : 'bg-amber/10 text-amber border-amber/20',
        )}>
          {isCompleted ? 'Hoàn thành' : 'Đang tập'}
        </span>
      </div>

      {/* ── Prev session autoregulation banner ── */}
      {prevSuggestion && !isCompleted && (
        <div className="rounded-xl border-2 border-amber/35 bg-amber/7 px-4 py-3.5 flex items-start gap-3">
          <span className="text-lg shrink-0 mt-0.5">💡</span>
          <div>
            <p className="text-[10px] font-bold text-amber uppercase tracking-widest mb-1">
              Gợi ý từ buổi tập tuần trước
            </p>
            <p className="text-sm text-ink/80 leading-relaxed">{prevSuggestion}</p>
          </div>
        </div>
      )}

      {/* ── Double-progression hints ── */}
      {Object.entries(progressionHints).map(([exId, hint]) => {
        if (!hint.shouldIncrease) return null
        const pe = phaseExercises.find(p => p.exercise_id === exId)
        return (
          <div
            key={exId}
            className="rounded-xl border border-herb/25 bg-herb/6 px-4 py-3 flex items-center gap-3"
          >
            <svg className="h-4 w-4 text-herb shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-herb">
                {pe?.exercise?.name ?? 'Bài tập'} — Tăng tạ buổi sau ↑
              </p>
              <p className="text-xs text-ink/55 mt-0.5">
                Hiệp đầu đạt {hint.actualReps} reps ≥ mục tiêu {hint.targetRepMax}
                {hint.suggestedWeightKg != null && (
                  <> — đề xuất <strong className="text-ink">{hint.suggestedWeightKg} kg</strong> lần sau</>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setProgressionHints(prev => {
                const next = { ...prev }
                delete next[exId]
                return next
              })}
              className="text-ink/25 hover:text-ink/50 transition-colors shrink-0 text-sm"
              aria-label="Đóng gợi ý"
            >
              ✕
            </button>
          </div>
        )
      })}

      {/* ══════════════════════════════════════════════════════════════════════
          TIER 1 — Week Selector
          Generated from phaseContext.durationWeeks.
          Defaults to the current week in phase.
      ══════════════════════════════════════════════════════════════════════ */}
      {weekNumbers.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mb-2 px-0.5">
            Chọn tuần
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scroll-smooth">
            {weekNumbers.map(w => {
              const isActive  = w === activeWeek
              const isCurrent = w === (phaseContext?.weekInPhase ?? 1)
              const isDeload  = isDeloadWeek(w)
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => handleWeekSelect(w)}
                  className={cn(
                    'shrink-0 flex flex-col items-center rounded-xl border px-3.5 py-2.5 transition-all min-w-[64px]',
                    isActive && isCurrent  ? 'border-herb bg-herb/10 shadow-sm ring-1 ring-herb/30'
                      : isActive          ? 'border-ink/35 bg-ink/5 shadow-sm'
                      : isCurrent         ? 'border-herb/40 bg-herb/5'
                      : 'border-ink/12 bg-paper hover:border-ink/25 hover:bg-ink/3',
                  )}
                >
                  <span className={cn(
                    'font-mono text-[11px] font-bold tabular-nums leading-none',
                    isActive && isCurrent ? 'text-herb'
                      : isActive          ? 'text-ink/75'
                      : isCurrent         ? 'text-herb/70'
                      : 'text-ink/45',
                  )}>
                    Tuần {w}
                  </span>
                  {isCurrent && (
                    <span className={cn(
                      'mt-1 text-[8px] font-bold uppercase leading-none',
                      isActive ? 'text-herb' : 'text-herb/60',
                    )}>
                      Hiện tại
                    </span>
                  )}
                  {isDeload && (
                    <span className="mt-1 text-[8px] font-bold uppercase text-amber leading-none">
                      Deload
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TIER 2 — Day Tabs
          Exercises are filtered strictly to the selected day tab.
      ══════════════════════════════════════════════════════════════════════ */}
      {hasSplit && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mb-2 px-0.5">
            Chọn buổi tập
          </p>
          <div className="flex flex-wrap gap-1.5">
            {phaseSplitDays.map(day => {
              const count = phaseExercises.filter(pe => pe.day_id === day.id).length
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setActiveDayId(day.id)}
                  className={cn(
                    'rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all flex items-center gap-2',
                    activeDayId === day.id
                      ? 'border-herb bg-herb text-paper shadow-sm'
                      : 'border-ink/12 text-ink/55 hover:border-ink/30 hover:text-ink',
                  )}
                >
                  {day.label}
                  <span className={cn(
                    'font-mono text-[10px] tabular-nums rounded-full px-1.5 py-0.5 font-bold',
                    activeDayId === day.id ? 'bg-white/20 text-paper/80' : 'bg-ink/8 text-ink/40',
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MA TRẬN BÀI TẬP — dùng chung với Lịch tập của HLV và trang giáo án
          chia sẻ qua liên kết. Máy tính: bảng đầy đủ. Điện thoại: chế độ tập
          trung từng bài, có nút "Xem kỹ thuật" và "Bài trước / Bài tiếp theo"
          (bảng ngang 1080px trước đây không bấm được hai thứ này trên iPhone).
      ══════════════════════════════════════════════════════════════════════ */}
      {sortedRows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-6 py-12 text-center space-y-3">
          <p className="text-4xl opacity-20">📋</p>
          <p className="text-sm text-ink/40">
            {hasSplit
              ? 'Ngày tập này chưa có bài tập nào được gán.'
              : 'Giai đoạn hiện tại chưa có bài tập nào.'}
          </p>
        </div>
      ) : (
        <ExerciseMatrix
          rows={sortedRows}
          grid={grid}
          activeSets={activeSets}
          cellSave={cellSave}
          exerciseNotes={exerciseNotes}
          onNoteChange={(exId, v) => setExerciseNotes(prev => ({ ...prev, [exId]: v }))}
          onCellChange={(exId, setNum, field, v) => updateCell(exId, setNum, field, v)}
          onCellBlur={(exId, setNum) => flushCell(exId, setNum)}
          overloadSuggestions={{}}
          isOverloadWeek={false}
          isPeaking={isPeaking}
          scopeKey={`${activeWeek}:${activeDayId ?? 'all'}`}
          legendLabel={`${sortedRows.length} bài tập`}
          sessionCompleted={isCompleted}
          sessionCreating={false}
          anySaving={anySaving}
          anyError={anyError}
          // Nút lưu nằm ở khu vực "Hoàn thành buổi tập" ngay bên dưới (sau phần
          // đánh giá buổi tập) nên tắt nút lưu trong thẻ để khỏi trùng.
          onSaveSession={finishSession}
          saveDisabled={finishing || !hasAnyData}
          showMobileSave={false}
          readOnly={isCompleted}
        />
      )}

      {/* ── Đánh giá buổi tập (Post-workout micro-survey) ── */}
      {!isCompleted && (
        <div className="rounded-2xl border border-ink/10 bg-white overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-ink/6">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              Đánh giá buổi tập
              <HelpTip text={GLOSSARY.autoregulation.def} />
            </h3>
            <p className="text-[11px] text-ink/40 mt-0.5">
              Autoregulation · Eric Helms — xác định kế hoạch tải tuần sau
            </p>
          </div>
          <div className="p-4 space-y-5">
            <SurveyQuestion
              label="1 · Hiệu suất thực hiện"
              options={PERFORMANCE_OPTIONS}
              selected={survey.performance ?? null}
              onSelect={v => setSurvey(s => ({ ...s, performance: v as SurveyPerformance }))}
            />
            <SurveyQuestion
              label="2 · Cảm giác nỗ lực (RIR)"
              options={RIR_OPTIONS}
              selected={survey.rir_feel ?? null}
              onSelect={v => setSurvey(s => ({ ...s, rir_feel: v as SurveyRirFeel }))}
            />
            <SurveyQuestion
              label="3 · Tình trạng cơ thể & khớp"
              options={RECOVERY_OPTIONS}
              selected={survey.recovery ?? null}
              onSelect={v => setSurvey(s => ({ ...s, recovery: v as SurveyRecovery }))}
            />

            {survey.performance && survey.rir_feel && survey.recovery ? (
              <div className={cn(
                'rounded-xl border px-3.5 py-3 flex items-start gap-2.5',
                survey.performance === 'miss' || survey.rir_feel === 'too_hard' || survey.recovery === 'sore'
                  ? 'border-danger/25 bg-danger/5'
                  : survey.performance === 'exceed' || survey.rir_feel === 'easier'
                    ? 'border-herb/25 bg-herb/5'
                    : 'border-ink/12 bg-ink/3',
              )}>
                <span className="text-base shrink-0 mt-0.5">📋</span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45 mb-1">
                    Kế hoạch điều chỉnh tuần sau
                  </p>
                  <p className="text-xs text-ink/75 leading-relaxed">
                    {buildNextWeekSuggestion(survey as SessionSurvey)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-ink/25 text-center">
                Trả lời đủ 3 câu để xem gợi ý điều chỉnh tải tuần sau
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Action bar ── */}
      {!isCompleted && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={finishSession}
            disabled={finishing || !hasAnyData}
            className="rounded-xl bg-herb text-paper font-semibold px-6 py-3 text-sm hover:bg-herb/90 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center gap-2.5 shadow-sm"
          >
            {finishing ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Hoàn thành buổi tập
          </button>

          <button
            type="button"
            onClick={() => router.push('/workouts')}
            className="rounded-xl border border-ink/15 px-5 py-3 text-sm font-medium text-ink/50 hover:text-ink hover:border-ink/25 transition-colors"
          >
            ← Quay lại
          </button>

          {anySaving && (
            <span className="flex items-center gap-1.5 text-xs text-ink/35">
              <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
              Đang lưu…
            </span>
          )}
          {anyError && !anySaving && (
            <span className="flex items-center gap-1.5 text-xs text-danger/65">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              Lỗi lưu — kiểm tra kết nối
            </span>
          )}
        </div>
      )}

      {isCompleted && (
        <button
          type="button"
          onClick={() => router.push('/workouts')}
          className="rounded-xl border border-ink/15 px-5 py-3 text-sm font-medium text-ink/50 hover:text-ink hover:border-ink/25 transition-colors"
        >
          ← Quay lại nhật ký
        </button>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="pt-4 pb-2 text-center">
        <p className="font-sans text-[11px] font-medium text-ink/20 tracking-wide">
          Powered by Trung Precision Coach System
        </p>
      </div>

    </div>
    </>
  )
}

// ─── Survey question sub-component ────────────────────────────────────────────

interface SurveyQuestionProps {
  label:    string
  options:  { value: string; label: string; icon: string }[]
  selected: string | null
  onSelect: (value: string) => void
}

function SurveyQuestion({ label, options, selected, onSelect }: SurveyQuestionProps) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-2.5">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border py-3 px-1 text-center transition-all',
              selected === opt.value
                ? 'border-amber bg-amber/8 shadow-sm'
                : 'border-ink/10 hover:border-ink/20 hover:bg-ink/2',
            )}
          >
            <span className="text-xl leading-none">{opt.icon}</span>
            <span className={cn(
              'text-[11px] font-semibold leading-tight',
              selected === opt.value ? 'text-amber' : 'text-ink/65',
            )}>
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
