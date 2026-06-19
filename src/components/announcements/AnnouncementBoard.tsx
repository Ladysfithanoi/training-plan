'use client'

import { useEffect, useState } from 'react'
import { formatDate, cn } from '@/lib/utils'
import { ANNOUNCEMENT_SEEN_KEY } from '@/lib/announcements'
import type { Announcement } from '@/types'

/**
 * Bảng tin — accordion board (newest first). The newest item is expanded by
 * default as a wide card (text LEFT, image RIGHT); the rest collapse into slim
 * tabs showing only title + date. Clicking a tab expands it and collapses the
 * current one. Items newer than this browser's last view get a "Mới" badge.
 *
 * Pass `markSeenOnView` on the real /bang-tin page so visiting it clears the
 * sidebar's "có tin mới" dot. The admin preview leaves it off.
 */
export function AnnouncementBoard({
  items,
  markSeenOnView = false,
}: {
  items: Announcement[]
  markSeenOnView?: boolean
}) {
  // The user's explicit choice; the effective expanded item is DERIVED so a
  // changing list (admin add/delete in preview) never needs a sync effect.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const expandedId = chosenId && items.some(i => i.id === chosenId)
    ? chosenId
    : (items[0]?.id ?? null)

  // last-seen snapshot (for "Mới" badges) + a mounted flag, read from localStorage
  // after hydration. Combined into one state so a single setState updates both.
  const [seen, setSeen] = useState<{ snapshot: number | null; mounted: boolean }>({
    snapshot: null,
    mounted: false,
  })

  useEffect(() => {
    const raw = localStorage.getItem(ANNOUNCEMENT_SEEN_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen({ snapshot: raw ? new Date(raw).getTime() : null, mounted: true })
    if (markSeenOnView && items[0]) {
      localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, items[0].created_at)
      window.dispatchEvent(new Event('announcements:seen'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items[0]?.id, markSeenOnView])

  if (items.length === 0) return null

  function isNew(item: Announcement): boolean {
    if (!seen.mounted) return false
    const t = new Date(item.created_at).getTime()
    return seen.snapshot === null ? true : t > seen.snapshot
  }

  return (
    <div className="space-y-3">
      {items.map(item =>
        item.id === expandedId ? (
          <ExpandedCard key={item.id} item={item} fresh={isNew(item)} />
        ) : (
          <CollapsedTab
            key={item.id}
            item={item}
            fresh={isNew(item)}
            onClick={() => setChosenId(item.id)}
          />
        ),
      )}
    </div>
  )
}

function NewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-paper">
      <span className="h-1.5 w-1.5 rounded-full bg-paper/90" />
      Mới
    </span>
  )
}

/** The expanded, full-width announcement: text LEFT, image RIGHT (stacks on mobile). */
function ExpandedCard({ item, fresh }: { item: Announcement; fresh: boolean }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm">
      <div className="flex flex-col md:flex-row-reverse">
        {item.image_url && (
          <div className="flex shrink-0 items-center justify-center border-b border-ink/6 bg-ink/[0.03] p-3 md:w-[44%] md:border-b-0 md:border-l">
            {/* Full image, never cropped (object-contain). eslint-disable: data-URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.image_url}
              alt={item.title}
              className="block max-h-[300px] w-auto max-w-full rounded-lg object-contain md:max-h-[460px]"
            />
          </div>
        )}
        <div className="flex flex-1 flex-col p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-amber/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber">
              {formatDate(item.created_at)}
            </span>
            {fresh && <NewBadge />}
          </div>
          <h3 className="mt-3 text-xl font-bold leading-snug text-ink sm:text-2xl">{item.title}</h3>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink/65">
            {item.content}
          </p>
        </div>
      </div>
    </article>
  )
}

/** A collapsed announcement: just title + date, click to expand. */
function CollapsedTab({
  item,
  fresh,
  onClick,
}: {
  item: Announcement
  fresh: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-5 py-3.5 text-left transition-colors',
        fresh
          ? 'border-danger/30 hover:border-danger/50 hover:bg-danger/[0.03]'
          : 'border-ink/10 hover:border-amber/40 hover:bg-amber/[0.03]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 font-mono text-[11px] font-semibold text-ink/40">
          {formatDate(item.created_at)}
        </span>
        <span className="truncate font-semibold text-ink">{item.title}</span>
        {fresh && <NewBadge />}
      </div>
      <svg
        className="h-4 w-4 shrink-0 text-ink/30 transition-colors group-hover:text-amber"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}
