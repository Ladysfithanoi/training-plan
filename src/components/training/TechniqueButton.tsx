'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

/**
 * Convert a YouTube link (watch / youtu.be / shorts / embed) into an embeddable
 * URL. Returns null when the link isn't a recognisable YouTube URL, in which
 * case the modal falls back to an "open in new tab" link.
 */
function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\.|^m\./, '')
    let id = ''
    if (host === 'youtu.be') {
      id = u.pathname.slice(1)
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v') ?? ''
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.slice(7)
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.slice(8)
    }
    id = id.split('/')[0]
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  } catch {
    return null
  }
}

interface TechniqueButtonProps {
  url?: string | null
  exerciseName: string
  /** Visual style: 'link' (inline text, default) or 'chip' (bordered pill). */
  variant?: 'link' | 'chip'
  className?: string
}

const PlayIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path d="M8 5v14l11-7z" />
  </svg>
)

/**
 * "Xem kỹ thuật" — a small trigger that opens a modal with the exercise's
 * technique video. Renders nothing when no link is configured. Used in the
 * Exercise Library and inside the athlete-facing training block.
 */
export function TechniqueButton({ url, exerciseName, variant = 'link', className }: TechniqueButtonProps) {
  const [open, setOpen] = useState(false)
  if (!url) return null

  const embed = toYouTubeEmbed(url)

  const base =
    variant === 'chip'
      ? 'inline-flex items-center gap-1 rounded-full border border-amber/30 bg-amber/8 px-2 py-0.5 text-[10px] font-semibold text-amber hover:bg-amber/15 transition-colors'
      : 'inline-flex items-center gap-1 text-[11px] font-semibold text-amber hover:text-amber/80 hover:underline transition-colors'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${base} ${className ?? ''}`}
        title={`Xem kỹ thuật — ${exerciseName}`}
      >
        <PlayIcon />
        Xem kỹ thuật
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Kỹ thuật — ${exerciseName}`} size="lg">
        {embed ? (
          <div className="relative w-full overflow-hidden rounded-xl bg-ink/90" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              src={embed}
              title={`Hướng dẫn kỹ thuật ${exerciseName}`}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="space-y-4 text-center py-4">
            <p className="text-sm text-ink/60">Không thể nhúng liên kết này. Mở trong tab mới để xem.</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 text-sm font-semibold text-paper hover:bg-amber/90 transition-colors"
            >
              <PlayIcon />
              Mở video hướng dẫn
            </a>
          </div>
        )}
      </Modal>
    </>
  )
}
