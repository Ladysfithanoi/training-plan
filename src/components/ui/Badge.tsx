import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'amber' | 'herb' | 'slate' | 'danger' | 'ink'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-ink/8 text-ink',
  amber:   'bg-amber/12 text-amber border border-amber/25',
  herb:    'bg-herb/12 text-herb border border-herb/25',
  slate:   'bg-slate/12 text-slate border border-slate/25',
  danger:  'bg-danger/12 text-danger border border-danger/25',
  ink:     'bg-ink text-paper',
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5',
        'font-sans text-xs font-semibold uppercase tracking-wide',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
