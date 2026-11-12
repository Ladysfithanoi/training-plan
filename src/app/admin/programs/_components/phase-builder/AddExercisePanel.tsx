import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card, CardBody } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { PATTERN_NAMES_BY_DAY } from '@/lib/trainingSplit'
import type { SplitType, SplitDay, DayType } from '@/lib/trainingSplit'
import type { Phase, Exercise, WeekType } from '@/types'
import { LOADING_STYLE_OPTIONS, orderBadgeClass } from './shared'
import type { AddExerciseForm } from './useAddExerciseForm'

/** The "Thêm bài tập" form card. Field state comes from useAddExerciseForm. */
export function AddExercisePanel({
  form, selectedPhase, activeDay, splitType, patternOptions, filteredExercises,
  phaseWeekType, isStrengthContext, nextHorizontalLabel, handleAdd, onClose,
}: {
  form:                AddExerciseForm
  selectedPhase:       Phase
  activeDay:           SplitDay | null
  splitType:           SplitType | null
  patternOptions:      { value: string; label: string }[]
  /** Exercises offered by the picker (already filtered by day / pattern). */
  filteredExercises:   Exercise[]
  phaseWeekType:       WeekType
  /** Strength / Peaking / Taper context → prescribe by %1RM, no RIR / AMRAP. */
  isStrengthContext:   boolean
  /** The STT label a horizontal-loading exercise would get next. */
  nextHorizontalLabel: string
  handleAdd:           () => Promise<void>
  onClose:             () => void
}) {
  const {
    filterPattern, setFilterPattern,
    selectedExercise, setSelectedExercise,
    targetSets, setTargetSets,
    targetRepMin, setTargetRepMin,
    targetRepMax, setTargetRepMax,
    rirTarget, setRirTarget,
    loadingStyle, setLoadingStyle,
    orderLabel, setOrderLabel,
    addError, adding,
    isAmrap, setIsAmrap,
    target1rmPct, setTarget1rmPct,
    isWarmup, setIsWarmup,
    exerciseNotes, setExerciseNotes,
  } = form

  return (
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

          {/* ── %1RM mục tiêu (tùy chọn) — hypertrophy/standard context ──────
              Strength context already exposes %1RM in column 4 of the grid;
              here we surface it for every other context so the coach can
              prescribe an explicit load in any phase. */}
          {!isStrengthContext && (
            <div className="flex flex-col gap-1.5 max-w-[240px]">
              <label className="text-xs font-semibold font-sans uppercase tracking-wide text-ink/60">
                % 1RM mục tiêu
                <span className="ml-1.5 font-normal normal-case text-ink/35">(tùy chọn)</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="30"
                  max="100"
                  step="5"
                  value={target1rmPct}
                  onChange={e => setTarget1rmPct(e.target.value)}
                  placeholder="vd 70"
                  className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3 pr-9 font-mono text-sm text-ink focus:border-amber focus:ring-1 focus:ring-amber outline-none placeholder:font-mono placeholder:text-ink/30"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink/40 pointer-events-none">
                  %
                </span>
              </div>
              {target1rmPct && (
                <span className="self-start inline-flex items-center rounded-full bg-danger/10 border border-danger/25 px-2 py-0.5 font-mono text-[10px] font-bold text-danger">
                  {target1rmPct}% 1RM
                </span>
              )}
            </div>
          )}

          {/* ── Bài khởi động (warmup) — independent display marker ─────────── */}
          <label className={cn(
            'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all select-none',
            isWarmup
              ? 'border-sky-400/45 bg-sky-400/8'
              : 'border-ink/10 bg-ink/2 hover:border-ink/20',
          )}>
            <input
              type="checkbox"
              checked={isWarmup}
              onChange={e => setIsWarmup(e.target.checked)}
              className="h-4 w-4 mt-0.5 shrink-0 rounded border-ink/20 accent-sky-500"
            />
            <div className="min-w-0">
              <p className={cn(
                'text-xs font-bold font-sans',
                isWarmup ? 'text-sky-600' : 'text-ink',
              )}>
                🤸 Bài khởi động
              </p>
              <p className="text-[11px] font-sans text-ink/45 mt-0.5 leading-snug">
                Đánh dấu đây là bài khởi động — bảng bài tập sẽ hiện ghi chú “Bài khởi động”
                để người tập nhận biết.
              </p>
            </div>
          </label>

          {/* ── Ghi chú cho học viên (phase_exercises.notes) ───────────────── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold font-sans uppercase tracking-wide text-ink/60">
              Ghi chú bài tập
              <span className="ml-1.5 font-normal normal-case text-ink/35">(học viên sẽ thấy)</span>
            </label>
            <textarea
              value={exerciseNotes}
              onChange={e => setExerciseNotes(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="vd: Giữ lưng thẳng, hạ chậm 3 giây, nghỉ 90s giữa hiệp…"
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink leading-snug focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-y placeholder:text-ink/30"
            />
          </div>

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
            <Button size="sm" variant="secondary" onClick={() => onClose()}>
              Huỷ
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
