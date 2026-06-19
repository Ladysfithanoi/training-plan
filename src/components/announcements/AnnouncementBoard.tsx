import { formatDate } from '@/lib/utils'
import type { Announcement } from '@/types'

/**
 * Bảng tin — the announcement board exactly as HLV see it above the user guide
 * (newest first). Presentational only (no hooks), so it renders in both the
 * server guide page and the client admin preview. Hidden when there is nothing
 * to show. Cover images are inline base64 data-URLs, so a plain <img> is used
 * (no next/image domain config needed).
 */
export function AnnouncementBoard({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber/12 text-amber">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Bảng tin</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <article
            key={item.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-ink/8 bg-white"
          >
            {item.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt={item.title}
                className="h-40 w-full object-cover bg-ink/5"
              />
            )}
            <div className="flex flex-1 flex-col p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber">
                {formatDate(item.created_at)}
              </p>
              <h3 className="mt-1 text-base font-bold text-ink leading-snug">{item.title}</h3>
              <p className="mt-2 text-sm text-ink/60 leading-relaxed whitespace-pre-line">
                {item.content}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
