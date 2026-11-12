'use client'

/**
 * "Tạo bằng AI" — the coach answers a short questionnaire, Gemini drafts a whole
 * training block (mesos → sessions → exercises from Kho bài tập), the coach
 * previews it and, on confirm, the block is created.
 *
 *   form ──▶ generating ──▶ preview ──▶ creating ──▶ (onCreated)
 *              POST /api/programs/ai/generate        POST /api/programs/ai/create
 */

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { phaseTypeLabel, phaseTypeBadgeClass, cn } from '@/lib/utils'
import { getSplitConfig } from '@/lib/trainingSplit'
import {
  DEFAULT_AI_ANSWERS,
  GOAL_OPTIONS,
  LEVEL_OPTIONS,
  GENDER_OPTIONS,
  ENDING_OPTIONS,
  EQUIPMENT_OPTIONS,
  FOCUS_MUSCLE_OPTIONS,
  SESSIONS_PER_WEEK,
  SESSION_MINUTES,
  MESO_COUNT,
  WEEKS_PER_MESO,
  orderLabelFor,
} from '@/lib/aiBlock'
import type { AiBlockAnswers, AiPlan } from '@/lib/aiBlock'
import type { TrainingBlock, Phase } from '@/types'

type BlockWithPhases = TrainingBlock & { phases: Phase[] }
type Step = 'form' | 'generating' | 'preview' | 'creating'

interface Props {
  open:      boolean
  onClose:   () => void
  /** Called with the block the server created from the confirmed plan. */
  onCreated: (block: BlockWithPhases) => void
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

/** One question: a label, an optional hint and its answer control. */
function Question({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case text-ink/35">{hint}</span>}
      </p>
      {children}
    </div>
  )
}

/** A row of pill buttons; `selected` decides which ones are lit. */
function Chips<T extends string | number>({
  options, selected, onPick,
}: {
  options:  { value: T; label: string }[]
  selected: (value: T) => boolean
  onPick:   (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onPick(o.value)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
            selected(o.value)
              ? 'border-amber bg-amber/10 text-amber'
              : 'border-ink/15 bg-white text-ink/60 hover:border-ink/30 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const textareaClass =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink leading-snug ' +
  'focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-y placeholder:text-ink/30'

export function AiBlockModal({ open, onClose, onCreated }: Props) {
  const [answers, setAnswers] = useState<AiBlockAnswers>(DEFAULT_AI_ANSWERS)
  const [step, setStep]       = useState<Step>('form')
  const [plan, setPlan]       = useState<AiPlan | null>(null)
  /** Exercises the AI named that are not in Kho bài tập (left out of the plan). */
  const [dropped, setDropped] = useState(0)
  /** The equipment filter left too few exercises, so the whole library was used. */
  const [equipmentRelaxed, setEquipmentRelaxed] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const busy = step === 'generating' || step === 'creating'

  function set<K extends keyof AiBlockAnswers>(key: K, value: AiBlockAnswers[K]) {
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  function toggleFocus(muscle: string) {
    setAnswers(prev => ({
      ...prev,
      focusMuscles: prev.focusMuscles.includes(muscle)
        ? prev.focusMuscles.filter(m => m !== muscle)
        : [...prev.focusMuscles, muscle],
    }))
  }

  /** Closing is ignored while a request is in flight so its result isn't lost. */
  function handleClose() {
    if (busy) return
    onClose()
  }

  async function generate() {
    setStep('generating')
    setError(null)
    try {
      const res = await fetch('/api/programs/ai/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ answers }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.plan) {
        setError(data.error ?? `Lỗi máy chủ (${res.status})`)
        setStep(plan ? 'preview' : 'form')
        return
      }
      setPlan(data.plan as AiPlan)
      setDropped(Number(data.dropped) || 0)
      setEquipmentRelaxed(!!data.equipmentRelaxed)
      setStep('preview')
    } catch (err) {
      console.error('AI generate error:', err)
      setError('Không thể kết nối đến máy chủ. Vui lòng thử lại.')
      setStep(plan ? 'preview' : 'form')
    }
  }

  async function create() {
    if (!plan) return
    setStep('creating')
    setError(null)
    try {
      const res = await fetch('/api/programs/ai/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.block) {
        setError(data.error ?? `Lỗi máy chủ (${res.status})`)
        setStep('preview')
        return
      }
      // Start clean the next time the modal is opened.
      setPlan(null)
      setStep('form')
      setAnswers(prev => ({ ...prev, blockName: '' }))
      onCreated(data.block as BlockWithPhases)
    } catch (err) {
      console.error('AI create error:', err)
      setError('Không thể kết nối đến máy chủ. Vui lòng thử lại.')
      setStep('preview')
    }
  }

  const totalWeeks = answers.mesoCount * answers.weeksPerMeso
  const showPreview = (step === 'preview' || step === 'creating') && plan

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={showPreview ? 'Xem trước khối tập AI đề xuất' : 'Tạo khối tập bằng AI'}
      size="lg"
    >
      {/* ── Generating ─────────────────────────────────────────────────────── */}
      {step === 'generating' && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber/30 border-t-amber" />
          <div>
            <p className="text-sm font-semibold text-ink">AI đang dựng khối tập…</p>
            <p className="text-xs text-ink/45 mt-1">
              Có thể mất tới một phút. Vui lòng không đóng cửa sổ này.
            </p>
          </div>
        </div>
      )}

      {/* ── Questionnaire ──────────────────────────────────────────────────── */}
      {step === 'form' && (
        <div className="space-y-5">
          <p className="text-xs text-ink/50 leading-relaxed">
            Trả lời vài câu hỏi về người tập. AI sẽ đề xuất một khối tập hoàn chỉnh — các meso,
            từng buổi tập và bài tập lấy từ <span className="font-semibold">Kho bài tập</span> hiện có.
            Bạn được xem trước rồi mới quyết định tạo, và vẫn chỉnh sửa được như khối tập thường.
          </p>

          <Question label="Mục tiêu chính">
            <Chips options={GOAL_OPTIONS} selected={v => answers.goal === v} onPick={v => set('goal', v)} />
          </Question>

          <Question label="Trình độ tập luyện">
            <Chips options={LEVEL_OPTIONS} selected={v => answers.level === v} onPick={v => set('level', v)} />
          </Question>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Question label="Giới tính">
              <Chips options={GENDER_OPTIONS} selected={v => answers.gender === v} onPick={v => set('gender', v)} />
            </Question>
            <Input
              label="Tuổi (không bắt buộc)"
              type="number"
              min={10}
              max={90}
              value={answers.age ?? ''}
              onChange={e => set('age', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="vd 32"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Question label="Số buổi tập mỗi tuần">
              <Chips
                options={range(SESSIONS_PER_WEEK.min, SESSIONS_PER_WEEK.max).map(n => ({ value: n, label: `${n} buổi` }))}
                selected={v => answers.sessionsPerWeek === v}
                onPick={v => set('sessionsPerWeek', v)}
              />
            </Question>
            <Question label="Thời lượng mỗi buổi">
              <Chips
                options={SESSION_MINUTES.map(n => ({ value: n, label: `${n} phút` }))}
                selected={v => answers.sessionMinutes === v}
                onPick={v => set('sessionMinutes', v)}
              />
            </Question>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Question label="Số meso tập luyện">
              <Chips
                options={range(MESO_COUNT.min, MESO_COUNT.max).map(n => ({ value: n, label: `${n} meso` }))}
                selected={v => answers.mesoCount === v}
                onPick={v => set('mesoCount', v)}
              />
            </Question>
            <Question label="Số tuần mỗi meso">
              <Chips
                options={range(WEEKS_PER_MESO.min, WEEKS_PER_MESO.max).map(n => ({ value: n, label: `${n} tuần` }))}
                selected={v => answers.weeksPerMeso === v}
                onPick={v => set('weeksPerMeso', v)}
              />
            </Question>
          </div>

          <Question label="Kết thúc khối tập bằng" hint={`(phần tập luyện chính dài ${totalWeeks} tuần)`}>
            <Chips options={ENDING_OPTIONS} selected={v => answers.ending === v} onPick={v => set('ending', v)} />
          </Question>

          <Question label="Dụng cụ có sẵn">
            <Chips options={EQUIPMENT_OPTIONS} selected={v => answers.equipment === v} onPick={v => set('equipment', v)} />
          </Question>

          <Question label="Nhóm cơ muốn ưu tiên" hint="(chọn nhiều, hoặc bỏ trống để phát triển cân đối)">
            <Chips
              options={FOCUS_MUSCLE_OPTIONS.map(m => ({ value: m as string, label: m as string }))}
              selected={v => answers.focusMuscles.includes(v)}
              onPick={toggleFocus}
            />
          </Question>

          <Question label="Chấn thương / hạn chế vận động" hint="(không bắt buộc)">
            <textarea
              value={answers.limitations}
              onChange={e => set('limitations', e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="vd: đau khớp gối phải khi squat sâu, thoát vị đĩa đệm L4-L5…"
              className={textareaClass}
            />
          </Question>

          <Question label="Ghi chú thêm cho AI" hint="(không bắt buộc)">
            <textarea
              value={answers.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="vd: thích tập mông 2 lần/tuần, không thích bài nhảy, mới sinh 6 tháng…"
              className={textareaClass}
            />
          </Question>

          <Input
            label="Tên khối tập (bỏ trống để AI tự đặt)"
            value={answers.blockName}
            onChange={e => set('blockName', e.target.value)}
            maxLength={80}
            placeholder="vd: Tăng cơ mông – đùi 12 tuần"
          />

          {error && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="primary" onClick={() => void generate()} className="flex-1">
              ✨ Tạo bằng AI
            </Button>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {/* ── Preview ────────────────────────────────────────────────────────── */}
      {showPreview && (
        <div className="space-y-4">
          <Input
            label="Tên khối tập"
            value={plan.name}
            maxLength={80}
            onChange={e => setPlan({ ...plan, name: e.target.value })}
          />
          {plan.description && (
            <p className="text-xs text-ink/55 leading-relaxed">{plan.description}</p>
          )}

          {(dropped > 0 || equipmentRelaxed) && (
            <div className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] text-ink/65 space-y-1">
              {dropped > 0 && (
                <p>AI có nhắc tới {dropped} bài không có trong Kho bài tập — các bài đó đã được bỏ ra.</p>
              )}
              {equipmentRelaxed && (
                <p>
                  Kho bài tập có quá ít bài hợp với dụng cụ đã chọn, nên AI được dùng toàn bộ kho.
                  Hãy kiểm tra lại bài tập trước khi dùng.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            {plan.phases.map((phase, phaseIdx) => (
              <div key={phaseIdx} className="rounded-xl border border-ink/10 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-ink/8 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{phase.name}</p>
                  <span className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5',
                    phaseTypeBadgeClass(phase.phase_type),
                  )}>
                    {phaseTypeLabel(phase.phase_type)}
                  </span>
                  <span className="ml-auto text-[11px] text-ink/45 font-mono">
                    {phase.duration_weeks} tuần · {phase.frequency_per_week} buổi/tuần
                    {phase.days.length > 0 ? ` · ${getSplitConfig(phase.split_type).label}` : ''}
                  </span>
                </div>

                {phase.days.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-ink/40">Giai đoạn này chưa có buổi tập — thêm sau khi tạo.</p>
                ) : (
                  <div className="divide-y divide-ink/5">
                    {phase.days.map((day, dayIdx) => (
                      <div key={dayIdx} className="px-4 py-3">
                        <p className="text-xs font-semibold text-amber mb-1.5">{day.label}</p>
                        <ul className="space-y-1">
                          {day.exercises.map((ex, exIdx) => (
                            <li key={exIdx} className="text-xs text-ink/80">
                              <div className="flex items-baseline gap-2">
                                <span className="w-5 shrink-0 font-bold text-ink/35">{orderLabelFor(exIdx)}</span>
                                <span className="flex-1 min-w-0 font-medium text-ink">{ex.name}</span>
                                <span className="shrink-0 font-mono tabular-nums text-ink/55">
                                  {ex.sets} × {ex.rep_min}–{ex.rep_max} · RIR {ex.rir}
                                </span>
                              </div>
                              {ex.note && (
                                <p className="pl-7 text-[11px] text-ink/45 leading-snug">📝 {ex.note}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-[11px] text-ink/45 leading-relaxed">
            Đây là bản đề xuất của AI — hãy rà lại trước khi giao cho người tập. Sau khi tạo, bạn chỉnh
            sửa từng meso, buổi tập và bài tập ở Bước 2 như mọi khối tập khác.
          </p>

          {error && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              loading={step === 'creating'}
              disabled={step === 'creating' || !plan.name.trim()}
              onClick={() => void create()}
              className="flex-1"
            >
              Tạo khối tập này
            </Button>
            <Button type="button" variant="secondary" disabled={step === 'creating'} onClick={() => void generate()}>
              Tạo lại
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={step === 'creating'}
              onClick={() => { setError(null); setStep('form') }}
            >
              Sửa câu trả lời
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
