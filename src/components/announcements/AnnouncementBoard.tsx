import { formatDate } from '@/lib/utils'
import type { Announcement } from '@/types'

/**
 * Bảng tin — the announcement cards, the same way HLV see them on the dedicated
 * "Bảng tin" page and in the admin preview. Presentational only (no hooks), so
 * it renders in both server and client trees.
 *
 * Images are shown IN FULL (object-contain on a soft backdrop) so a tall/wide
 * cover is never cropped — the whole uploaded image is always visible. Returns
 * null when empty; callers render their own header / empty state.
 */
export function AnnouncementBoard({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 xl:gap-6">
      {items.map(item => (
        <article
          key={item.id}
          className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm transition-shadow hover:shadow-md"
        >
          {item.image_url && (
            <div className="flex w-full items-center justify-center border-b border-ink/6 bg-ink/[0.03]">
              {/* Full image, never cropped (object-contain), height-capped so a
                  very tall image can't blow out the card. eslint-disable: data-URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image_url}
                alt={item.title}
                className="block max-h-[420px] w-auto max-w-full object-contain"
              />
            </div>
          )}
          <div className="flex flex-1 flex-col p-5 sm:p-6">
            <span className="inline-flex w-fit items-center rounded-full bg-amber/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber">
              {formatDate(item.created_at)}
            </span>
            <h3 className="mt-2.5 text-lg sm:text-xl font-bold text-ink leading-snug">
              {item.title}
            </h3>
            <p className="mt-2.5 text-sm sm:text-[15px] text-ink/65 leading-relaxed whitespace-pre-line">
              {item.content}
            </p>
          </div>
        </article>
      ))}
    </div>
  )
}
