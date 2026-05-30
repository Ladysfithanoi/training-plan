'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { TrainingBlock, Phase } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 4

// ─── Sort types ───────────────────────────────────────────────────────────────

type SortKey =
  | 'date_desc'    // Mới nhất → cũ nhất (default)
  | 'date_asc'     // Cũ nhất → mới nhất
  | 'meso_asc'     // Số meso: Thấp → Cao
  | 'meso_desc'    // Số meso: Cao → Thấp
  | 'weeks_asc'    // Thời lượng: Ngắn → Dài
  | 'weeks_desc'   // Thời lượng: Dài → Ngắn

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BlockWithPhases = TrainingBlock & { phases?: Pick<Phase, 'id' | 'duration_weeks' | 'phase_order'>[] }

function blockTotalWeeks(b: BlockWithPhases): number {
  return (b.phases ?? []).reduce((sum, p) => sum + (p.duration_weeks ?? 0), 0)
}

function blockMesoCount(b: BlockWithPhases): number {
  // Prefer the live phases array from the join; fall back to the stored field
  return b.phases?.length ?? b.total_mesocycles ?? 0
}

function sortBlocks(blocks: BlockWithPhases[], key: SortKey): BlockWithPhases[] {
  return [...blocks].sort((a, b) => {
    switch (key) {
      case 'date_desc':  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'date_asc':   return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      case 'meso_asc':   return blockMesoCount(a) - blockMesoCount(b)
      case 'meso_desc':  return blockMesoCount(b) - blockMesoCount(a)
      case 'weeks_asc':  return blockTotalWeeks(a) - blockTotalWeeks(b)
      case 'weeks_desc': return blockTotalWeeks(b) - blockTotalWeeks(a)
    }
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CoachProgramSelectorProps {
  availableBlocks: TrainingBlock[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CoachProgramSelector({ availableBlocks }: CoachProgramSelectorProps) {
  const router = useRouter()

  const blocks = availableBlocks as BlockWithPhases[]

  // ── Selection + action state ───────────────────────────────────────────────
  const [selectedBlockId, setSelectedBlockId] = useState<string>(blocks[0]?.id ?? '')
  const [starting,        setStarting]        = useState(false)

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')

  // ── Sort + pagination state ───────────────────────────────────────────────
  const [sortKey,     setSortKey]     = useState<SortKey>('date_desc')
  const [currentPage, setCurrentPage] = useState(1)

  // ── Sort change helper (always resets to page 1) ──────────────────────────
  function applySort(key: SortKey) {
    setSortKey(key)
    setCurrentPage(1)
  }

  // Derive per-dropdown "active" indicator
  const dateSortValue  = sortKey.startsWith('date_')  ? sortKey : ''
  const mesoSortValue  = sortKey.startsWith('meso_')  ? sortKey : ''
  const weeksSortValue = sortKey.startsWith('weeks_') ? sortKey : ''

  // ── Pipeline: search → sort → paginate ────────────────────────────────────
  const searchFiltered = searchQuery.trim()
    ? blocks.filter(b =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : blocks

  const sorted     = sortBlocks(searchFiltered, sortKey)
  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE))
  const paged      = sorted.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  // ── Activate program ───────────────────────────────────────────────────────
  async function handleStart() {
    if (!selectedBlockId) return
    setStarting(true)
    try {
      const res = await fetch('/api/coach/my-program', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ block_id: selectedBlockId }),
      })
      if (!res.ok) {
        const payload = await res.json() as { error?: string }
        alert(payload.error ?? 'Không thể kích hoạt chương trình')
        return
      }
      router.refresh()
    } catch {
      alert('Lỗi kết nối — vui lòng thử lại')
    } finally {
      setStarting(false)
    }
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (blocks.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-ink/12 bg-white px-8 py-14 text-center space-y-3">
        <p className="text-4xl opacity-20">🏋️</p>
        <p className="font-sans text-sm font-semibold text-ink/50">Chưa có khối tập luyện nào</p>
        <p className="font-sans text-xs text-ink/30">
          Tạo ít nhất một khối tập trong{' '}
          <a href="/admin/programs" className="text-amber underline underline-offset-2">
            Giáo án tập luyện
          </a>{' '}
          trước khi bắt đầu.
        </p>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Heading card ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border-2 border-dashed border-amber/25 bg-amber/5 px-5 py-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0">🎯</span>
          <div>
            <h2 className="font-sans text-base font-bold text-ink">Chọn khối tập để bắt đầu</h2>
            <p className="font-sans text-sm text-ink/55 mt-0.5">
              Chọn một khối tập luyện và xác nhận để kích hoạt chương trình cá nhân.
            </p>
          </div>
        </div>
      </div>

      {/* ── Search box ────────────────────────────────────────────────────── */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/30 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Tìm kiếm khối tập…"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
          className="w-full rounded-xl border border-ink/15 bg-white pl-9 pr-4 py-2.5 text-sm text-ink placeholder:text-ink/30 outline-none focus:border-amber/50 focus:ring-2 focus:ring-amber/10 transition-all"
        />
      </div>

      {/* ── Sort toolbar ──────────────────────────────────────────────────── */}
      {blocks.length > 1 && (
        <div className="flex flex-col gap-1.5">
          {/* Row 1: Date + Meso */}
          <div className="flex gap-1.5">
            <SortSelect
              value={dateSortValue}
              placeholder="Ngày tạo"
              options={[
                { value: 'date_desc', label: 'Mới nhất trước' },
                { value: 'date_asc',  label: 'Cũ nhất trước'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as SortKey)}
              active={sortKey.startsWith('date_')}
            />
            <SortSelect
              value={mesoSortValue}
              placeholder="Số Meso"
              options={[
                { value: 'meso_asc',  label: 'Meso: Ít → Nhiều' },
                { value: 'meso_desc', label: 'Meso: Nhiều → Ít'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as SortKey)}
              active={sortKey.startsWith('meso_')}
            />
          </div>
          {/* Row 2: Weeks + result count */}
          <div className="flex items-center gap-1.5">
            <SortSelect
              value={weeksSortValue}
              placeholder="Thời lượng"
              options={[
                { value: 'weeks_asc',  label: 'Ngắn → Dài' },
                { value: 'weeks_desc', label: 'Dài → Ngắn'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as SortKey)}
              active={sortKey.startsWith('weeks_')}
            />
            <span className="ml-auto font-mono text-[10px] text-ink/30 tabular-nums whitespace-nowrap shrink-0">
              {searchQuery.trim() ? `${sorted.length} / ${blocks.length} khối` : `${blocks.length} khối`}
            </span>
          </div>
        </div>
      )}

      {/* ── Block list ────────────────────────────────────────────────────── */}
      {paged.length === 0 ? (
        <p className="py-6 text-center font-sans text-sm text-ink/35">
          Không tìm thấy khối tập phù hợp.
        </p>
      ) : (
        <div className="space-y-2">
          {paged.map(block => {
            const isSelected = block.id === selectedBlockId
            const mesoCount  = blockMesoCount(block)
            const totalWeeks = blockTotalWeeks(block)

            return (
              <button
                key={block.id}
                type="button"
                onClick={() => setSelectedBlockId(block.id)}
                className={cn(
                  'w-full flex items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
                  isSelected
                    ? 'border-amber bg-amber/8 shadow-sm'
                    : 'border-ink/10 bg-white hover:border-ink/20 hover:bg-ink/2',
                )}
              >
                {/* Radio dot */}
                <span className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors',
                  isSelected ? 'border-amber' : 'border-ink/20',
                )}>
                  {isSelected && <span className="h-2 w-2 rounded-full bg-amber" />}
                </span>

                <div className="min-w-0 flex-1">
                  {/* Block name */}
                  <p className={cn(
                    'font-sans font-semibold text-sm leading-snug',
                    isSelected ? 'text-amber' : 'text-ink',
                  )}>
                    {block.name}
                  </p>

                  {/* Description */}
                  {block.description && (
                    <p className="font-sans text-xs text-ink/45 mt-0.5 leading-relaxed line-clamp-2">
                      {block.description}
                    </p>
                  )}

                  {/* Metric badges */}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className={cn(
                      'font-mono text-[10px] tabular-nums font-semibold rounded-full px-2 py-0.5',
                      isSelected ? 'bg-amber/15 text-amber/80' : 'bg-ink/6 text-ink/40',
                    )}>
                      {mesoCount} giai đoạn
                    </span>
                    {totalWeeks > 0 && (
                      <>
                        <span className="text-ink/20 text-[10px]">·</span>
                        <span className={cn(
                          'font-mono text-[10px] tabular-nums',
                          isSelected ? 'text-amber/70' : 'text-ink/35',
                        )}>
                          {totalWeeks} tuần
                        </span>
                      </>
                    )}
                    <span className={cn(
                      'font-mono text-[10px] tabular-nums',
                      isSelected ? 'text-amber/50' : 'text-ink/25',
                    )}>
                      · {new Date(block.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Pagination footer ──────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => p - 1)}
            aria-label="Trang trước"
            className="h-8 w-8 rounded-lg flex items-center justify-center border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <span className="font-mono text-xs text-ink/45 tabular-nums select-none">
            Trang <span className="text-ink/60 font-semibold">{currentPage}</span> / {totalPages}
          </span>

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(p => p + 1)}
            aria-label="Trang sau"
            className="h-8 w-8 rounded-lg flex items-center justify-center border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Confirm button ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-1 border-t border-ink/6">
        <button
          type="button"
          onClick={handleStart}
          disabled={!selectedBlockId || starting}
          className="rounded-xl bg-amber text-paper font-sans font-semibold px-7 py-3 text-sm hover:bg-amber/90 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center gap-2.5 shadow-sm"
        >
          {starting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Bắt đầu chương trình
        </button>

        <p className="font-sans text-xs text-ink/35">
          Chương trình cũ (nếu có) sẽ được tạm dừng tự động.
        </p>
      </div>
    </div>
  )
}

// ─── SortSelect sub-component ─────────────────────────────────────────────────

interface SortSelectProps {
  value:    string
  placeholder: string
  options:  { value: string; label: string }[]
  onChange: (value: string) => void
  active:   boolean
}

function SortSelect({ value, placeholder, options, onChange, active }: SortSelectProps) {
  return (
    <div className="relative flex-1 min-w-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'w-full h-8 appearance-none rounded-lg border pl-2.5 pr-6 text-[11px] font-medium outline-none transition-colors cursor-pointer truncate',
          active
            ? 'border-amber/40 bg-amber/7 text-amber font-semibold'
            : 'border-ink/12 bg-white text-ink/50 hover:border-ink/25 hover:text-ink/70',
        )}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Custom chevron icon */}
      <svg
        className={cn(
          'pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3',
          active ? 'text-amber' : 'text-ink/30',
        )}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}
