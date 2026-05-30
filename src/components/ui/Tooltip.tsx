import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface TooltipProps {
  text: string
  children: ReactNode
  className?: string
  /** Which side the bubble appears on. Defaults to 'top'. */
  position?: 'top' | 'bottom'
}

/**
 * Lightweight CSS-only tooltip — no JS needed.
 * Uses Tailwind named-group variant so it doesn't conflict with ancestor groups.
 */
export function Tooltip({ text, children, className, position = 'top' }: TooltipProps) {
  return (
    <span className={cn('group/tip relative inline-flex items-center', className)}>
      {children}

      {/* Bubble */}
      <span
        aria-hidden
        role="tooltip"
        className={cn(
          // positioning
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-50',
          position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          // appearance
          'w-max max-w-[200px] rounded-lg bg-ink/95 px-3 py-2',
          'text-[11px] leading-snug text-paper shadow-xl text-center break-words whitespace-normal',
          // transition
          'opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150',
        )}
      >
        {text}
        {/* Arrow */}
        <span
          className={cn(
            'absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent',
            position === 'top' ? 'top-full border-t-ink/95' : 'bottom-full border-b-ink/95',
          )}
        />
      </span>
    </span>
  )
}
