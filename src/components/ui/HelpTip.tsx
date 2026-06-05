import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

interface HelpTipProps {
  /** Explanatory text shown in the bubble. */
  text: string
  /** Which side the bubble appears on. Defaults to 'top'. */
  position?: 'top' | 'bottom'
  className?: string
}

/**
 * A small "?" badge that reveals a definition on hover — for explaining
 * jargon (RIR, AMRAP, Meso…) right where it appears. Built on <Tooltip>
 * (CSS-only), so it works in both server and client components.
 */
export function HelpTip({ text, position = 'top', className }: HelpTipProps) {
  return (
    <Tooltip text={text} position={position} className={cn('align-middle', className)}>
      <span
        aria-label="Giải thích"
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-ink/25 text-[9px] font-bold leading-none text-ink/45 hover:border-amber hover:text-amber transition-colors"
      >
        ?
      </span>
    </Tooltip>
  )
}
