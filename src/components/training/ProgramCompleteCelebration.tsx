'use client'

/**
 * ProgramCompleteCelebration
 * ──────────────────────────
 * Shown the moment the athlete logs the LAST buổi tập of the LAST week of the
 * LAST meso of a block (see lib/programCompletion.ts). Congratulates them and
 * spells out what to do next, because "giáo án hết" is the point where people
 * most often drift: without a prescribed next step they either keep repeating
 * the final meso or stop training altogether.
 *
 * Used by both the coach view (/admin/my-training) and the athlete's guest view
 * (/p/[token]); each supplies its own final call-to-action via `cta`.
 */

import { COMPLETION_STEPS } from '@/lib/programCompletion'

interface CtaConfig {
  /** Button label — omit the whole `cta` object to render the hint alone. */
  label?: string
  onClick?: () => void
  /** Sentence under the button (e.g. "Liên hệ HLV để nhận giáo án tiếp theo"). */
  hint: string
}

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Name of the finished block — shown in the header. */
  blockName: string
  /** Meso name, when the view has it (e.g. "Meso 3 — Cường độ"). */
  phaseName?: string | null
  cta: CtaConfig
}

export function ProgramCompleteModal({ open, onClose, blockName, phaseName, cta }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4 bg-ink/55 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl flex flex-col max-h-[92vh]">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-7 pb-5 text-center border-b border-slate-100">
          <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-herb/12 flex items-center justify-center text-3xl leading-none">
            🏆
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-herb mb-1.5">
            Hoàn thành lộ trình
          </p>
          <h2 className="text-xl font-bold text-ink leading-tight">Chúc mừng bạn!</h2>
          <p className="text-sm text-ink/60 mt-2 leading-relaxed">
            Bạn vừa hoàn thành buổi tập cuối cùng của{' '}
            <span className="font-semibold text-ink">{blockName}</span>
            {phaseName ? <> — trọn vẹn tới {phaseName}</> : null}. Toàn bộ giáo án đã đi hết chặng đường của nó.
          </p>
        </div>

        {/* ── Next steps ────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-3 overflow-y-auto">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40">
            Bước tiếp theo nên làm
          </p>
          {COMPLETION_STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <span className="shrink-0 text-lg leading-none mt-0.5">{step.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink leading-snug">
                  {i + 1}. {step.title}
                </p>
                <p className="text-xs text-ink/55 leading-relaxed mt-1">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Action footer ─────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-4 pb-6 space-y-2.5 border-t border-slate-100">
          <p className="text-xs text-ink/50 text-center leading-relaxed">{cta.hint}</p>
          {cta.label && cta.onClick && (
            <button
              type="button"
              onClick={cta.onClick}
              className="w-full rounded-xl bg-herb text-paper font-bold py-3.5 text-sm hover:bg-herb/90 active:scale-[0.98] transition-all shadow-sm"
            >
              {cta.label}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 py-3 text-sm font-medium text-ink/45 hover:text-ink hover:border-slate-300 transition-colors"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  )
}

interface BannerProps {
  blockName: string
  /** Re-opens the modal so the guidance stays reachable after dismissing it. */
  onOpen: () => void
}

/**
 * Persistent reminder that the block is finished. Stays on the page after the
 * modal is dismissed so the athlete can pull the guidance back up any time.
 */
export function ProgramCompleteBanner({ blockName, onOpen }: BannerProps) {
  return (
    <div className="rounded-2xl border-2 border-herb/30 bg-herb/6 px-5 py-4 flex items-start gap-3.5">
      <span className="shrink-0 text-2xl leading-none">🏆</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-herb mb-1">
          Hoàn thành lộ trình
        </p>
        <p className="text-sm text-ink/70 leading-relaxed">
          Bạn đã tập xong buổi cuối cùng của <span className="font-semibold text-ink">{blockName}</span>.
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 text-xs font-bold text-herb underline underline-offset-2 hover:text-herb/80 transition-colors"
        >
          Xem hướng dẫn bước tiếp theo →
        </button>
      </div>
    </div>
  )
}
