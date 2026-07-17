'use client'

import { useState, useEffect, useRef } from 'react'
import { TechniqueButton } from '@/components/training/TechniqueButton'
import { phaseTypeLabel, phaseTypeBadgeClass, cn } from '@/lib/utils'
import { generateDefaultDays } from '@/lib/trainingSplit'
import type { SplitType, SplitDay } from '@/lib/trainingSplit'
import { resolveWeekExercises, isWeekCustomized } from '@/lib/phaseWeeks'
import type { Phase, Exercise, PhaseExercise, WeekType, TrainingBlock } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface PhaseExerciseRow extends PhaseExercise {
  exercise: Exercise
}

interface Props {
  /** All blocks (with phases[]); the viewer only reads the selected block's phases. */
  blocks: BlockWithPhases[]
  /** Controlled by ProgramsWorkspace — which block is active in section 1. */
  selectedBlockId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEK_TYPE_LABELS: Record<WeekType, string> = {
  standard: '📋 Standard',
  deload:   '🌿 Deload',
  taper:    '⬇️ Taper',
  peaking:  '🎯 Peaking',
}

function weekTypeBadgeClass(wt: WeekType): string {
  if (wt === 'deload')  return 'border-herb/30 bg-herb/8 text-herb'
  if (wt === 'taper')   return 'border-amber/30 bg-amber/8 text-amber'
  if (wt === 'peaking') return 'border-danger/30 bg-danger/8 text-danger'
  return 'border-ink/15 bg-white text-ink/60'
}

/** STT badge colour, keyed on the first letter (matches the builder). */
function orderBadgeClass(label: string): string {
  const ch = label[0]?.toUpperCase()
  if (ch === 'A') return 'bg-amber/15 text-amber border-amber/40'
  if (ch === 'B') return 'bg-herb/15 text-herb border-herb/35'
  if (ch === 'C') return 'bg-sky-500/10 text-sky-600 border-sky-400/30'
  if (ch === 'D') return 'bg-violet-500/10 text-violet-600 border-violet-400/30'
  return 'bg-ink/8 text-ink/55 border-ink/20'
}

function sortRows(rows: PhaseExerciseRow[]): PhaseExerciseRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.sort_order ?? null
    const sb = b.sort_order ?? null
    if (sa != null && sb != null && sa !== sb) return sa - sb
    return (a.order_label ?? 'ZZZ').localeCompare(b.order_label ?? 'ZZZ', undefined, { numeric: true })
  })
}

function targetLabelOf(pe: PhaseExerciseRow): string {
  const t = pe.target_sets ?? 3
  return pe.is_amrap
    ? `${t} × ${pe.target_rep_min}–${pe.target_rep_max}+A`
    : `${t} × ${pe.target_rep_min}–${pe.target_rep_max}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PhaseExerciseViewer({ blocks, selectedBlockId }: Props) {
  const activeBlock = blocks.find(b => b.id === selectedBlockId) ?? null
  const phases = (activeBlock?.phases ?? [])
    .slice()
    .sort((a, b) => a.phase_order - b.phase_order)

  // ── Phase (meso) selection ──────────────────────────────────────────────────
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(phases[0]?.id ?? '')
  const [phaseExercises, setPhaseExercises]   = useState<PhaseExerciseRow[]>([])
  const [loading, setLoading]                 = useState(false)

  // Effective phase: fall back to the first phase when the current selection
  // isn't in the active block (e.g. after the block changed). Derived rather than
  // reset via an effect so a block switch repaints in a single render.
  const effectivePhaseId = phases.some(p => p.id === selectedPhaseId)
    ? selectedPhaseId
    : (phases[0]?.id ?? '')
  const selectedPhase = phases.find(p => p.id === effectivePhaseId) ?? null

  // ── Split day + week scope ──────────────────────────────────────────────────
  const splitType: SplitType | null = (selectedPhase?.split_type as SplitType) ?? null
  const splitDays: SplitDay[] = (() => {
    if (!splitType) return []
    const saved = Array.isArray(selectedPhase?.split_days) ? (selectedPhase!.split_days as SplitDay[]) : []
    return saved.length > 0 ? saved : generateDefaultDays(splitType)
  })()

  const [activeDayId, setActiveDayId] = useState<string | null>(null)
  const [activeWeek, setActiveWeek]   = useState<number | null>(null) // null = "Gốc" (base)

  const durationWeeks = selectedPhase?.duration_weeks ?? 0
  const weekNumbers   = Array.from({ length: durationWeeks }, (_, i) => i + 1)

  // Monotonic token so a slow fetch from a previous meso can't repaint a newer one.
  const loadReqRef = useRef(0)

  // ── Load a phase's exercises (read-only GET) ────────────────────────────────
  // The fetch + the scope reset live in a named async function (not the effect
  // body) so the setState calls don't trip react-hooks/set-state-in-effect —
  // the same pattern PhaseExerciseBuilder.loadPhaseExercises uses.
  async function loadPhase(phaseId: string, firstDayId: string | null) {
    setActiveWeek(null)
    setActiveDayId(firstDayId)

    if (!phaseId) {
      setPhaseExercises([])
      return
    }

    const reqId = ++loadReqRef.current
    setLoading(true)
    setPhaseExercises([])
    try {
      const res = await fetch(`/api/phases/${phaseId}/exercises`)
      const data = res.ok ? await res.json() : { exercises: [] }
      if (reqId !== loadReqRef.current) return
      setPhaseExercises(data.exercises ?? [])
    } catch {
      if (reqId === loadReqRef.current) setPhaseExercises([])
    } finally {
      if (reqId === loadReqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Deliberate: resetting scope + fetching on phase change is the whole point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPhase(effectivePhaseId, splitDays[0]?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePhaseId])

  // ── Derived rows for the selected week + day ────────────────────────────────
  const weekForResolve = activeWeek ?? 0 // 0 never matches an override → base rows
  const weekRows = activeWeek == null
    ? phaseExercises.filter(pe => (pe.week_number ?? null) === null)
    : resolveWeekExercises(phaseExercises, weekForResolve)
  const dayRows = (splitType && activeDayId)
    ? weekRows.filter(pe => pe.day_id === activeDayId)
    : weekRows
  const visibleRows = sortRows(dayRows as PhaseExerciseRow[])

  // ── Empty states ────────────────────────────────────────────────────────────
  if (phases.length === 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-white px-5 py-8 text-center">
        <p className="text-sm text-ink/45">Khối tập này chưa có giai đoạn (Meso) nào.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Read-only banner ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber/25 bg-amber/5 px-4 py-3">
        <svg className="h-4 w-4 shrink-0 mt-0.5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber/90">Giáo án dùng chung — chỉ xem</p>
          <p className="text-sm text-ink/55 mt-0.5">
            Đây là giáo án do người khác tạo. Bạn có thể xem toàn bộ bài tập bên trong nhưng
            không chỉnh sửa. Bạn vẫn có thể <strong>giao</strong> giáo án này cho học viên ở
            trang <strong>Danh sách Học viên</strong>.
          </p>
        </div>
      </div>

      {/* ── Meso (phase) selector ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {phases.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedPhaseId(p.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              p.id === effectivePhaseId
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/15 bg-white text-ink/60 hover:border-ink/30 hover:text-ink',
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      {selectedPhase && (
        <>
          {/* ── Phase meta ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={cn('rounded-md px-2 py-0.5 font-semibold', phaseTypeBadgeClass(selectedPhase.phase_type))}>
              {phaseTypeLabel(selectedPhase.phase_type)}
            </span>
            <span className="rounded-md border border-ink/12 bg-white px-2 py-0.5 font-medium text-ink/55">
              {selectedPhase.duration_weeks} tuần
            </span>
            <span className="rounded-md border border-ink/12 bg-white px-2 py-0.5 font-medium text-ink/55">
              {selectedPhase.frequency_per_week} buổi/tuần
            </span>
            <span className={cn('rounded-md border px-2 py-0.5 font-semibold', weekTypeBadgeClass(selectedPhase.week_type))}>
              {WEEK_TYPE_LABELS[selectedPhase.week_type] ?? selectedPhase.week_type}
            </span>
          </div>

          {/* ── Week scope selector (migration 011) ──────────────────────────── */}
          {durationWeeks > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mr-1">Tuần</span>
              <button
                type="button"
                onClick={() => setActiveWeek(null)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                  activeWeek === null
                    ? 'border-ink bg-ink text-paper'
                    : 'border-ink/15 bg-white text-ink/55 hover:border-ink/30',
                )}
              >
                Gốc
              </button>
              {weekNumbers.map(w => {
                const customized = isWeekCustomized(phaseExercises, w)
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setActiveWeek(w)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                      activeWeek === w
                        ? 'border-ink bg-ink text-paper'
                        : customized
                          ? 'border-amber/40 bg-amber/8 text-amber hover:border-amber/60'
                          : 'border-ink/15 bg-white text-ink/55 hover:border-ink/30',
                    )}
                    title={customized ? 'Tuần này có tùy chỉnh riêng' : 'Tuần này dùng cấu hình Gốc'}
                  >
                    {w}{customized && ' ✦'}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Day tabs (if split configured) ───────────────────────────────── */}
          {splitType && splitDays.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {splitDays.map(d => {
                const count = weekRows.filter(pe => pe.day_id === d.id).length
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDayId(d.id)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                      d.id === activeDayId
                        ? 'border-herb bg-herb/10 text-herb-deep'
                        : 'border-ink/12 bg-white text-ink/55 hover:border-ink/25',
                    )}
                  >
                    {d.label}
                    <span className="ml-1.5 text-[10px] font-normal text-ink/35">({count})</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Exercise list (read-only) ────────────────────────────────────── */}
          {loading ? (
            <div className="rounded-2xl border border-ink/10 bg-white px-6 py-12 text-center">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-ink/15 border-t-ink" />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-6 py-12 text-center space-y-2">
              <p className="text-3xl opacity-20">📋</p>
              <p className="text-sm text-ink/40">
                {splitType ? 'Buổi tập này chưa có bài tập nào.' : 'Giai đoạn này chưa có bài tập nào.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleRows.map(pe => {
                const exName = pe.exercise?.name ?? 'Bài tập'
                const exType = pe.exercise?.type ?? ''
                return (
                  <div
                    key={pe.id}
                    className="flex items-start gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-sm"
                  >
                    {/* STT badge */}
                    <span
                      className={cn(
                        'shrink-0 mt-0.5 h-7 min-w-7 px-1.5 rounded-lg border flex items-center justify-center font-sans font-bold text-xs',
                        orderBadgeClass(pe.order_label ?? ''),
                      )}
                    >
                      {pe.order_label ?? '—'}
                    </span>

                    {/* Name + meta */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-sans font-semibold text-sm text-ink leading-tight">{exName}</p>
                        {pe.is_amrap && (
                          <span className="inline-flex items-center rounded-full bg-amber/15 border border-amber/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber leading-none">🔥 AMRAP</span>
                        )}
                        {pe.is_warmup && (
                          <span className="inline-flex items-center rounded-full bg-sky-400/12 border border-sky-400/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-600 leading-none">🤸 Khởi động</span>
                        )}
                      </div>
                      {exType && <p className="text-[10px] text-ink/35 mt-0.5 capitalize">{exType}</p>}
                      {pe.exercise?.video_url && (
                        <div className="mt-1.5">
                          <TechniqueButton url={pe.exercise.video_url} exerciseName={exName} variant="chip" />
                        </div>
                      )}
                      {pe.notes && (
                        <p className="mt-1.5 text-[11px] text-ink/55 leading-snug whitespace-pre-line">📝 {pe.notes}</p>
                      )}
                    </div>

                    {/* Prescription */}
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[13px] font-semibold text-ink/75 whitespace-nowrap">{targetLabelOf(pe)}</p>
                      {pe.rir_target != null && !pe.is_amrap && (
                        <p className="font-mono text-[10px] text-ink/35">RIR {pe.rir_target}</p>
                      )}
                      {pe.target_percentage_1rm != null && (
                        <p className="font-mono text-[10px] text-danger/55 font-semibold">{pe.target_percentage_1rm}% 1RM</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
