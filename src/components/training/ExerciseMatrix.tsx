'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { PhaseExercise } from '@/types'

// ─── Shared matrix types (used by Coach + Guest training views) ───────────────

export interface GridCell { setId: string | null; kg: string; reps: string }
export type GridState = Record<string, GridCell>
export interface ActiveSetLite {
  id: string; exercise_id: string; set_number: number
  weight_kg: number | null; actual_reps: number | null
}
export type SaveStatus = 'idle' | 'saving' | 'error'

export const MAX_SETS = 6

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExerciseMatrixProps {
  rows:                PhaseExercise[]
  grid:                GridState
  activeSets:          ActiveSetLite[]
  cellSave:            Record<string, SaveStatus>
  exerciseNotes:       Record<string, string>
  onNoteChange:        (exerciseId: string, value: string) => void
  onCellChange:        (exerciseId: string, setNum: number, field: 'kg' | 'reps', value: string) => void
  onCellBlur:          (exerciseId: string, setNum: number) => void
  overloadSuggestions: Record<string, string>
  isOverloadWeek:      boolean
  /** Resets mobile focus index when the active week/day changes. */
  scopeKey:            string
  legendLabel:         string
  sessionCompleted:    boolean
  sessionCreating:     boolean
  anySaving:           boolean
  anyError:            boolean
  /** Mobile-only "Lưu buổi tập" handler, rendered under the last focus card. */
  onSaveSession:       () => void
  saveDisabled:        boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCell(grid: GridState, activeSets: ActiveSetLite[], exerciseId: string, setNum: number): GridCell {
  const key = `${exerciseId}:${setNum}`
  if (grid[key]) return grid[key]
  const saved = activeSets.find(s => s.exercise_id === exerciseId && s.set_number === setNum)
  if (saved) {
    return {
      setId: saved.id,
      kg:   saved.weight_kg   != null ? String(saved.weight_kg)   : '',
      reps: saved.actual_reps != null ? String(saved.actual_reps) : '',
    }
  }
  return { setId: null, kg: '', reps: '' }
}

function cleanKg(v: string)   { return v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') }
function cleanReps(v: string) { return v.replace(/\D/g, '') }

function targetLabelOf(pe: PhaseExercise): string {
  const t = pe.target_sets ?? 3
  return pe.is_amrap
    ? `${t}× ${pe.target_rep_min}–${pe.target_rep_max}+A`
    : `${t} × ${pe.target_rep_min}–${pe.target_rep_max}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExerciseMatrix(props: ExerciseMatrixProps) {
  const {
    rows, grid, activeSets, cellSave, exerciseNotes,
    onNoteChange, onCellChange, onCellBlur,
    overloadSuggestions, isOverloadWeek, scopeKey, legendLabel,
    sessionCompleted, sessionCreating, anySaving, anyError,
    onSaveSession, saveDisabled,
  } = props

  // ── Mobile focus index + per-exercise extra-set reveal ────────────────────
  const [focusIdx, setFocusIdx]         = useState(0)
  const [extraVisible, setExtraVisible] = useState<Record<string, number>>({})

  // Reset focus to the first exercise whenever the week/day scope changes.
  // Deliberate prop→state sync; the rule's perf concern doesn't apply here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setFocusIdx(0) }, [scopeKey])

  // How many set rows to show for an exercise (mobile): max of target sets,
  // already-logged sets, and any rows the user explicitly revealed.
  function visibleSetCount(pe: PhaseExercise): number {
    const target = pe.target_sets ?? 3
    let filled = 0
    for (let n = 1; n <= MAX_SETS; n++) {
      const c = getCell(grid, activeSets, pe.exercise_id, n)
      if (c.kg || c.reps) filled = n
    }
    const base = Math.max(target, filled)
    return Math.min(MAX_SETS, Math.max(base, extraVisible[pe.exercise_id] ?? 0))
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-6 py-12 text-center space-y-3">
        <p className="text-4xl opacity-20">📋</p>
        <p className="text-sm text-ink/40">Chưa có bài tập nào cho buổi này.</p>
      </div>
    )
  }

  // ── Shared status chips (legend) ──────────────────────────────────────────
  const statusChips = (
    <span className="flex items-center gap-2.5 text-[10px] text-ink/30">
      {sessionCompleted && (
        <span className="flex items-center gap-1 text-herb font-bold">
          <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Buổi tập đã ghi nhận
        </span>
      )}
      {sessionCreating && (
        <span className="flex items-center gap-1 text-amber/60 font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />Đang khởi tạo…
        </span>
      )}
      {anySaving && !sessionCreating && (
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />Đang lưu…</span>
      )}
      {anyError && !anySaving && (
        <span className="flex items-center gap-1.5 text-danger/65"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Lỗi lưu</span>
      )}
    </span>
  )

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════════
          DESKTOP — full table grid (md and up)
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block rounded-2xl border border-ink/10 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-ink/6 flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ink/35">{legendLabel}</span>
          <span className="ml-auto flex items-center gap-2.5 text-[10px] text-ink/30">
            {statusChips}
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded border border-amber/30 bg-amber/8" />Kg</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded border border-herb/30 bg-herb/8" />Lần</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0" style={{ minWidth: '780px', width: '100%' }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-20 border-b border-r border-ink/8 bg-paper px-2.5 py-2.5 text-left" style={{ width: 44 }}>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30">STT</span>
                </th>
                <th className="sticky z-20 border-b border-r border-ink/8 bg-paper px-3 py-2.5 text-left" style={{ left: 44, minWidth: 148 }}>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30">Tên bài</span>
                </th>
                <th className="border-b border-r border-ink/8 bg-paper/80 px-3 py-2.5 text-left" style={{ width: 96 }}>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30">Mục tiêu</span>
                </th>
                {Array.from({ length: MAX_SETS }, (_, i) => (
                  <th key={i} className="border-b border-r border-ink/8 bg-paper/80 px-2 py-2 text-center" style={{ width: 96 }}>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30 block">Hiệp {i + 1}</span>
                    <div className="flex justify-center gap-2 mt-0.5">
                      <span className="text-[8px] text-amber/50 font-mono font-semibold">Kg</span>
                      <span className="text-[8px] text-herb/50 font-mono font-semibold">Lần</span>
                    </div>
                  </th>
                ))}
                <th className="border-b border-ink/8 bg-paper/80 px-3 py-2.5 text-left" style={{ minWidth: 104 }}>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30">Ghi chú</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pe, rowIdx) => {
                const exerciseId  = pe.exercise_id
                const exName      = pe.exercise?.name ?? 'Bài tập'
                const exType      = pe.exercise?.type ?? ''
                const targetSets  = pe.target_sets ?? 3
                const rowTint  = rowIdx % 2 === 1
                const stickyBg = rowTint ? 'bg-[#F0EBE1]' : 'bg-paper'
                return (
                  <tr key={pe.id}>
                    <td className={cn('sticky left-0 z-10 border-b border-r border-ink/7 px-2.5 py-3', stickyBg)} style={{ width: 44 }}>
                      <span className="font-sans font-bold text-xs text-ink/60">{pe.order_label ?? '—'}</span>
                    </td>
                    <td className={cn('sticky z-10 border-b border-r border-ink/7 px-3 py-2.5', stickyBg)} style={{ left: 44, minWidth: 148 }}>
                      <p className="font-sans font-semibold text-sm text-ink leading-tight">{exName}</p>
                      {exType && <p className="text-[10px] text-ink/35 mt-0.5 capitalize">{exType}</p>}
                      {pe.is_amrap && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-amber/15 border border-amber/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber leading-none">🔥 AMRAP</span>
                      )}
                      {pe.is_warmup && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-sky-400/12 border border-sky-400/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-600 leading-none">🤸 Khởi động</span>
                      )}
                      {pe.notes && (
                        <p className="mt-1.5 text-[10px] text-ink/55 leading-snug whitespace-pre-line">📝 {pe.notes}</p>
                      )}
                    </td>
                    <td className={cn('border-b border-r border-ink/7 px-3 py-2.5', rowTint ? 'bg-ink/[0.018]' : '')} style={{ width: 96 }}>
                      <p className="font-mono text-[11px] text-ink/65 whitespace-nowrap">{targetLabelOf(pe)}</p>
                      {pe.rir_target != null && !pe.is_amrap && <p className="font-mono text-[10px] text-ink/35">RIR {pe.rir_target}</p>}
                      {pe.target_percentage_1rm != null && <p className="font-mono text-[10px] text-danger/55 font-semibold">{pe.target_percentage_1rm}% 1RM</p>}
                    </td>
                    {Array.from({ length: MAX_SETS }, (_, si) => {
                      const setNum     = si + 1
                      const cellKey    = `${exerciseId}:${setNum}`
                      const cell       = getCell(grid, activeSets, exerciseId, setNum)
                      const ss         = cellSave[cellKey] ?? 'idle'
                      const isTarget   = setNum <= targetSets
                      const overloadKg = isOverloadWeek ? overloadSuggestions[cellKey] : undefined
                      return (
                        <td key={si} className={cn('border-b border-r border-ink/7 px-1.5 py-2', rowTint ? 'bg-ink/[0.018]' : '', !isTarget && 'opacity-30')} style={{ width: 96 }}>
                          <div className="flex items-center gap-1">
                            <input
                              type="text" inputMode="decimal"
                              placeholder={overloadKg ? `→${overloadKg}` : '—'}
                              aria-label={`${exName} hiệp ${setNum} kg`}
                              value={cell.kg}
                              onChange={e => onCellChange(exerciseId, setNum, 'kg', cleanKg(e.target.value))}
                              onBlur={() => onCellBlur(exerciseId, setNum)}
                              className={cn(
                                'h-8 w-[42px] rounded border text-center text-sm font-mono tabular-nums outline-none transition-colors bg-transparent',
                                cell.kg ? 'border-amber/35 text-ink font-semibold' : 'border-ink/10 text-ink/40',
                                overloadKg && !cell.kg ? 'placeholder:text-amber/45 placeholder:font-medium' : 'placeholder:text-ink/18',
                                ss === 'saving' && 'border-amber/60 animate-pulse',
                                ss === 'error'  && 'border-danger/45 bg-danger/4',
                                !cell.kg && 'focus:border-amber/50 focus:bg-amber/4',
                                 cell.kg && 'focus:border-amber  focus:bg-amber/4',
                              )}
                            />
                            <input
                              type="text" inputMode="numeric" placeholder="—"
                              aria-label={`${exName} hiệp ${setNum} reps`}
                              value={cell.reps}
                              onChange={e => onCellChange(exerciseId, setNum, 'reps', cleanReps(e.target.value))}
                              onBlur={() => onCellBlur(exerciseId, setNum)}
                              className={cn(
                                'h-8 w-[42px] rounded border text-center text-sm font-mono tabular-nums outline-none transition-colors bg-transparent placeholder:text-ink/18',
                                cell.reps ? 'border-herb/35 text-ink font-semibold' : 'border-ink/10 text-ink/40',
                                ss === 'saving' && 'border-herb/60 animate-pulse',
                                ss === 'error'  && 'border-danger/45 bg-danger/4',
                                !cell.reps && 'focus:border-herb/50 focus:bg-herb/4',
                                 cell.reps && 'focus:border-herb  focus:bg-herb/4',
                              )}
                            />
                          </div>
                        </td>
                      )
                    })}
                    <td className={cn('border-b border-ink/7 px-2 py-2', rowTint ? 'bg-ink/[0.018]' : '')} style={{ minWidth: 104 }}>
                      <input
                        type="text" placeholder="—" maxLength={120}
                        aria-label={`${exName} ghi chú`}
                        value={exerciseNotes[exerciseId] ?? ''}
                        onChange={e => onNoteChange(exerciseId, e.target.value)}
                        className="h-8 w-full rounded border border-ink/10 bg-transparent px-2 text-xs font-mono text-ink/70 outline-none transition-colors placeholder:text-ink/18 focus:border-ink/30 focus:bg-ink/3"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MOBILE — Focus Mode, one exercise card at a time (below md)
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="md:hidden space-y-4">
        <MobileFocus
          rows={rows}
          focusIdx={Math.min(focusIdx, rows.length - 1)}
          setFocusIdx={setFocusIdx}
          grid={grid}
          activeSets={activeSets}
          cellSave={cellSave}
          exerciseNotes={exerciseNotes}
          onNoteChange={onNoteChange}
          onCellChange={onCellChange}
          onCellBlur={onCellBlur}
          overloadSuggestions={overloadSuggestions}
          isOverloadWeek={isOverloadWeek}
          visibleSetCount={visibleSetCount}
          revealSet={(exId, current) => setExtraVisible(prev => ({ ...prev, [exId]: Math.min(MAX_SETS, current + 1) }))}
          statusChips={statusChips}
          sessionCompleted={sessionCompleted}
          onSaveSession={onSaveSession}
          saveDisabled={saveDisabled}
        />
      </div>
    </>
  )
}

// ─── Mobile focus card ────────────────────────────────────────────────────────

interface MobileFocusProps {
  rows:                PhaseExercise[]
  focusIdx:            number
  setFocusIdx:         (n: number) => void
  grid:                GridState
  activeSets:          ActiveSetLite[]
  cellSave:            Record<string, SaveStatus>
  exerciseNotes:       Record<string, string>
  onNoteChange:        (exerciseId: string, value: string) => void
  onCellChange:        (exerciseId: string, setNum: number, field: 'kg' | 'reps', value: string) => void
  onCellBlur:          (exerciseId: string, setNum: number) => void
  overloadSuggestions: Record<string, string>
  isOverloadWeek:      boolean
  visibleSetCount:     (pe: PhaseExercise) => number
  revealSet:           (exerciseId: string, current: number) => void
  statusChips:         React.ReactNode
  sessionCompleted:    boolean
  onSaveSession:       () => void
  saveDisabled:        boolean
}

function MobileFocus(p: MobileFocusProps) {
  const pe = p.rows[p.focusIdx]
  if (!pe) return null

  const exerciseId = pe.exercise_id
  const exName     = pe.exercise?.name ?? 'Bài tập'
  const exType     = pe.exercise?.type ?? ''
  const visible    = p.visibleSetCount(pe)
  const isLast     = p.focusIdx === p.rows.length - 1
  const isFirst    = p.focusIdx === 0

  return (
    <>
      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40">
          Bài tập {p.focusIdx + 1} / {p.rows.length}
        </p>
        <div className="flex items-center gap-2.5">
          {p.statusChips}
          <div className="flex gap-1">
            {p.rows.map((r, i) => (
              <button key={r.id} type="button" aria-label={`Tới bài ${i + 1}`} onClick={() => p.setFocusIdx(i)}
                className={cn('h-1.5 rounded-full transition-all', i === p.focusIdx ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20')} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Exercise card ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-ink/10 bg-white shadow-sm p-5 space-y-4">
        {/* header */}
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 h-7 min-w-7 px-1.5 rounded-lg bg-ink/6 flex items-center justify-center font-sans font-bold text-xs text-ink/60">
            {pe.order_label ?? '—'}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink leading-tight">{exName}</p>
            <p className="font-mono text-xs text-ink/55 mt-0.5">
              {targetLabelOf(pe)}
              {pe.rir_target != null && !pe.is_amrap && <span className="text-ink/35"> · RIR {pe.rir_target}</span>}
              {pe.target_percentage_1rm != null && <span className="text-danger/55 font-semibold"> · {pe.target_percentage_1rm}% 1RM</span>}
            </p>
            {exType && <p className="text-[10px] text-ink/35 mt-0.5 capitalize">{exType}</p>}
            {pe.is_amrap && (
              <span className="mt-1 inline-flex items-center rounded-full bg-amber/15 border border-amber/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber leading-none">🔥 AMRAP</span>
            )}
            {pe.is_warmup && (
              <span className="mt-1 inline-flex items-center rounded-full bg-sky-400/12 border border-sky-400/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-600 leading-none">🤸 Khởi động</span>
            )}
          </div>
        </div>

        {/* coach note — prescription guidance the athlete should follow */}
        {pe.notes && (
          <div className="rounded-xl border border-amber/25 bg-amber/5 px-3.5 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber/70 mb-1">📝 Ghi chú từ HLV</p>
            <p className="text-sm text-ink/75 leading-snug whitespace-pre-line">{pe.notes}</p>
          </div>
        )}

        {/* column labels */}
        <div className="flex items-center gap-3 px-1">
          <span className="w-14 shrink-0" />
          <span className="flex-1 text-center text-[10px] font-bold uppercase tracking-widest text-amber/60">Kg</span>
          <span className="flex-1 text-center text-[10px] font-bold uppercase tracking-widest text-herb/60">Reps</span>
        </div>

        {/* set rows — big touch targets */}
        <div className="space-y-2.5">
          {Array.from({ length: visible }, (_, si) => {
            const setNum     = si + 1
            const cellKey    = `${exerciseId}:${setNum}`
            const cell       = getCell(p.grid, p.activeSets, exerciseId, setNum)
            const ss         = p.cellSave[cellKey] ?? 'idle'
            const overloadKg = p.isOverloadWeek ? p.overloadSuggestions[cellKey] : undefined
            return (
              <div key={si} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm font-bold text-ink/45">Hiệp {setNum}</span>
                <input
                  type="text" inputMode="decimal"
                  placeholder={overloadKg ? `→${overloadKg}` : 'Kg'}
                  aria-label={`${exName} hiệp ${setNum} kg`}
                  value={cell.kg}
                  onChange={e => p.onCellChange(exerciseId, setNum, 'kg', cleanKg(e.target.value))}
                  onBlur={() => p.onCellBlur(exerciseId, setNum)}
                  className={cn(
                    'flex-1 min-w-0 py-3 px-4 text-lg font-bold text-center rounded-xl border bg-slate-50 outline-none transition-colors tabular-nums',
                    cell.kg ? 'border-amber/40 text-ink' : 'border-slate-200 text-ink/70',
                    overloadKg && !cell.kg ? 'placeholder:text-amber/45' : 'placeholder:text-ink/25 placeholder:font-medium',
                    ss === 'saving' && 'border-amber/60 animate-pulse',
                    ss === 'error'  && 'border-danger/50 bg-danger/5',
                    'focus:border-amber focus:bg-white',
                  )}
                />
                <input
                  type="text" inputMode="numeric" placeholder="Reps"
                  aria-label={`${exName} hiệp ${setNum} reps`}
                  value={cell.reps}
                  onChange={e => p.onCellChange(exerciseId, setNum, 'reps', cleanReps(e.target.value))}
                  onBlur={() => p.onCellBlur(exerciseId, setNum)}
                  className={cn(
                    'flex-1 min-w-0 py-3 px-4 text-lg font-bold text-center rounded-xl border bg-slate-50 outline-none transition-colors tabular-nums placeholder:text-ink/25 placeholder:font-medium',
                    cell.reps ? 'border-herb/40 text-ink' : 'border-slate-200 text-ink/70',
                    ss === 'saving' && 'border-herb/60 animate-pulse',
                    ss === 'error'  && 'border-danger/50 bg-danger/5',
                    'focus:border-herb focus:bg-white',
                  )}
                />
              </div>
            )
          })}
        </div>

        {/* + add set */}
        {visible < MAX_SETS && (
          <button type="button" onClick={() => p.revealSet(exerciseId, visible)}
            className="w-full rounded-xl border border-dashed border-ink/20 py-2.5 text-sm font-semibold text-ink/45 hover:text-ink hover:border-ink/35 hover:bg-ink/3 transition-colors flex items-center justify-center gap-1.5">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Thêm hiệp làm việc
          </button>
        )}

        {/* notes */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35 mb-1.5">Ghi chú</p>
          <input
            type="text" placeholder="Cảm nhận, kỹ thuật…" maxLength={120}
            aria-label={`${exName} ghi chú`}
            value={p.exerciseNotes[exerciseId] ?? ''}
            onChange={e => p.onNoteChange(exerciseId, e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-ink/80 outline-none transition-colors placeholder:text-ink/25 focus:border-ink/30 focus:bg-white"
          />
        </div>

        {/* nav */}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => p.setFocusIdx(Math.max(0, p.focusIdx - 1))} disabled={isFirst}
            className="flex-1 rounded-xl border border-ink/15 py-3 text-sm font-semibold text-ink/55 hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Bài trước
          </button>
          <button type="button" onClick={() => p.setFocusIdx(Math.min(p.rows.length - 1, p.focusIdx + 1))} disabled={isLast}
            className="flex-1 rounded-xl bg-ink text-paper py-3 text-sm font-bold hover:bg-ink/85 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
            Bài tiếp theo
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Save on last card ─────────────────────────────────────────────── */}
      {isLast && !p.sessionCompleted && (
        <button type="button" onClick={p.onSaveSession} disabled={p.saveDisabled}
          className="w-full rounded-xl bg-herb text-paper font-bold py-3.5 text-base hover:bg-herb/90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 shadow-sm">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Lưu buổi tập
        </button>
      )}
    </>
  )
}
