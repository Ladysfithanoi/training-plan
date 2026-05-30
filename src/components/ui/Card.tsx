import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a subtle left border accent */
  accent?: 'amber' | 'herb' | 'slate' | 'danger' | 'none'
}

const accentClasses = {
  amber:  'border-l-4 border-l-amber',
  herb:   'border-l-4 border-l-herb',
  slate:  'border-l-4 border-l-slate',
  danger: 'border-l-4 border-l-danger',
  none:   '',
}

export function Card({ accent = 'none', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white border border-ink/8 shadow-sm p-5',
        accentClasses[accent],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold text-ink', className)} {...props}>
      {children}
    </h3>
  )
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-sm text-ink/70', className)} {...props}>
      {children}
    </div>
  )
}
