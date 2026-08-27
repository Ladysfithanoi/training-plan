'use client'

/**
 * BlockSearchPicker
 * ─────────────────
 * Ô tìm kiếm + sắp xếp + phân trang cho danh sách khối tập (giáo án).
 *
 * Dùng chung cho MỌI nơi phải chọn một giáo án:
 *   • HLV/Admin chọn giáo án cho chính mình  (my-training → CoachProgramSelector)
 *   • Giao giáo án cho học viên              (admin/users → UsersManager)
 *
 * Component chỉ lo phần "tìm & chọn" — nút xác nhận do nơi gọi tự dựng.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { TrainingBlock, Phase } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Khối tập tối thiểu mà picker cần. Mọi trường phụ đều tuỳ chọn để dùng được
 *  với cả truy vấn rút gọn (`select('id, name')`) lẫn truy vấn đầy đủ. */
export type PickerBlock = Pick<TrainingBlock, 'id' | 'name'> & {
  description?:      string | null
  total_mesocycles?: number
  created_at?:       string
  phases?:           Pick<Phase, 'id' | 'duration_weeks' | 'phase_order'>[]
}

export type BlockSortKey =
  | 'date_desc'    // Mới nhất → cũ nhất (mặc định)
  | 'date_asc'     // Cũ nhất → mới nhất
  | 'meso_asc'     // Số meso: Thấp → Cao
  | 'meso_desc'    // Số meso: Cao → Thấp
  | 'weeks_asc'    // Thời lượng: Ngắn → Dài
  | 'weeks_desc'   // Thời lượng: Dài → Ngắn

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function blockTotalWeeks(b: PickerBlock): number {
  return (b.phases ?? []).reduce((sum, p) => sum + (p.duration_weeks ?? 0), 0)
}

export function blockMesoCount(b: PickerBlock): number {
  // Ưu tiên mảng phases từ join; nếu không có thì dùng cột đã lưu.
  return b.phases?.length ?? b.total_mesocycles ?? 0
}

function blockTime(b: PickerBlock): number {
  return b.created_at ? new Date(b.created_at).getTime() : 0
}

export function sortBlocks<T extends PickerBlock>(blocks: T[], key: BlockSortKey): T[] {
  return [...blocks].sort((a, b) => {
    switch (key) {
      case 'date_desc':  return blockTime(b) - blockTime(a)
      case 'date_asc':   return blockTime(a) - blockTime(b)
      case 'meso_asc':   return blockMesoCount(a) - blockMesoCount(b)
      case 'meso_desc':  return blockMesoCount(b) - blockMesoCount(a)
      case 'weeks_asc':  return blockTotalWeeks(a) - blockTotalWeeks(b)
      case 'weeks_desc': return blockTotalWeeks(b) - blockTotalWeeks(a)
    }
  })
}

/** Bỏ dấu + thường hoá: gõ "day tay" vẫn ra "Đẩy tay". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
}

export function filterBlocks<T extends PickerBlock>(blocks: T[], query: string): T[] {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return blocks
  return blocks.filter(b => {
    const haystack = normalize(`${b.name} ${b.description ?? ''}`)
    return terms.every(t => haystack.includes(t))
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BlockSearchPickerProps {
  blocks:          PickerBlock[]
  selectedBlockId: string
  onSelect:        (blockId: string) => void
  /** Số khối hiển thị mỗi trang (mặc định 4). */
  pageSize?:       number
  placeholder?:    string
  /** Ẩn thanh sắp xếp khi chỗ hiển thị quá hẹp. */
  showSort?:       boolean
  className?:      string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BlockSearchPicker({
  blocks,
  selectedBlockId,
  onSelect,
  pageSize = 4,
  placeholder = 'Tìm giáo án theo tên…',
  showSort = true,
  className,
}: BlockSearchPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey,     setSortKey]     = useState<BlockSortKey>('date_desc')
  const [currentPage, setCurrentPage] = useState(1)

  function applySearch(value: string) {
    setSearchQuery(value)
    setCurrentPage(1)
  }

  function applySort(key: BlockSortKey) {
    setSortKey(key)
    setCurrentPage(1)
  }

  // Chỉ báo "đang sắp xếp theo" cho từng dropdown
  const dateSortValue  = sortKey.startsWith('date_')  ? sortKey : ''
  const mesoSortValue  = sortKey.startsWith('meso_')  ? sortKey : ''
  const weeksSortValue = sortKey.startsWith('weeks_') ? sortKey : ''

  // ── Pipeline: tìm kiếm → sắp xếp → phân trang ─────────────────────────────
  const filtered   = filterBlocks(blocks, searchQuery)
  const sorted     = sortBlocks(filtered, sortKey)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page       = Math.min(currentPage, totalPages)
  const paged      = sorted.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className={cn('space-y-3', className)}>

      {/* ── Ô tìm kiếm ──────────────────────────────────────────────────── */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/30"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={e => applySearch(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-ink/15 bg-white py-2.5 pl-9 pr-9 text-sm text-ink placeholder:text-ink/30 outline-none transition-all focus:border-amber/50 focus:ring-2 focus:ring-amber/10"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => applySearch('')}
            aria-label="Xoá tìm kiếm"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Thanh sắp xếp ───────────────────────────────────────────────── */}
      {showSort && blocks.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <SortSelect
              value={dateSortValue}
              placeholder="Ngày tạo"
              options={[
                { value: 'date_desc', label: 'Mới nhất trước' },
                { value: 'date_asc',  label: 'Cũ nhất trước'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as BlockSortKey)}
              active={sortKey.startsWith('date_')}
            />
            <SortSelect
              value={mesoSortValue}
              placeholder="Số Meso"
              options={[
                { value: 'meso_asc',  label: 'Meso: Ít → Nhiều' },
                { value: 'meso_desc', label: 'Meso: Nhiều → Ít'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as BlockSortKey)}
              active={sortKey.startsWith('meso_')}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <SortSelect
              value={weeksSortValue}
              placeholder="Thời lượng"
              options={[
                { value: 'weeks_asc',  label: 'Ngắn → Dài' },
                { value: 'weeks_desc', label: 'Dài → Ngắn'  },
              ]}
              onChange={v => applySort((v || 'date_desc') as BlockSortKey)}
              active={sortKey.startsWith('weeks_')}
            />
            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-ink/30">
              {searchQuery.trim() ? `${sorted.length} / ${blocks.length} khối` : `${blocks.length} khối`}
            </span>
          </div>
        </div>
      )}

      {/* Không hiện thanh sắp xếp thì vẫn cho biết đang lọc còn bao nhiêu */}
      {!showSort && searchQuery.trim() && (
        <p className="text-right font-mono text-[10px] tabular-nums text-ink/30">
          {sorted.length} / {blocks.length} khối
        </p>
      )}

      {/* ── Danh sách khối ──────────────────────────────────────────────── */}
      {paged.length === 0 ? (
        <p className="py-6 text-center font-sans text-sm text-ink/35">
          {blocks.length === 0
            ? 'Chưa có giáo án nào.'
            : `Không tìm thấy giáo án khớp với “${searchQuery.trim()}”.`}
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
                onClick={() => onSelect(block.id)}
                className={cn(
                  'flex w-full items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
                  isSelected
                    ? 'border-amber bg-amber/8 shadow-sm'
                    : 'border-ink/10 bg-white hover:border-ink/20 hover:bg-ink/2',
                )}
              >
                {/* Nút radio */}
                <span className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isSelected ? 'border-amber' : 'border-ink/20',
                )}>
                  {isSelected && <span className="h-2 w-2 rounded-full bg-amber" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'font-sans text-sm font-semibold leading-snug',
                    isSelected ? 'text-amber' : 'text-ink',
                  )}>
                    {block.name}
                  </p>

                  {block.description && (
                    <p className="mt-0.5 line-clamp-2 font-sans text-xs leading-relaxed text-ink/45">
                      {block.description}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                      isSelected ? 'bg-amber/15 text-amber/80' : 'bg-ink/6 text-ink/40',
                    )}>
                      {mesoCount} giai đoạn
                    </span>
                    {totalWeeks > 0 && (
                      <>
                        <span className="text-[10px] text-ink/20">·</span>
                        <span className={cn(
                          'font-mono text-[10px] tabular-nums',
                          isSelected ? 'text-amber/70' : 'text-ink/35',
                        )}>
                          {totalWeeks} tuần
                        </span>
                      </>
                    )}
                    {block.created_at && (
                      <span className={cn(
                        'font-mono text-[10px] tabular-nums',
                        isSelected ? 'text-amber/50' : 'text-ink/25',
                      )}>
                        · {new Date(block.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Phân trang ──────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setCurrentPage(page - 1)}
            aria-label="Trang trước"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/12 text-ink/40 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-25"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <span className="select-none font-mono text-xs tabular-nums text-ink/45">
            Trang <span className="font-semibold text-ink/60">{page}</span> / {totalPages}
          </span>

          <button
            type="button"
            disabled={page === totalPages}
            onClick={() => setCurrentPage(page + 1)}
            aria-label="Trang sau"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/12 text-ink/40 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-25"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── SortSelect ───────────────────────────────────────────────────────────────

interface SortSelectProps {
  value:       string
  placeholder: string
  options:     { value: string; label: string }[]
  onChange:    (value: string) => void
  active:      boolean
}

function SortSelect({ value, placeholder, options, onChange, active }: SortSelectProps) {
  return (
    <div className="relative min-w-0 flex-1">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'h-8 w-full cursor-pointer appearance-none truncate rounded-lg border pl-2.5 pr-6 text-[11px] font-medium outline-none transition-colors',
          active
            ? 'border-amber/40 bg-amber/7 font-semibold text-amber'
            : 'border-ink/12 bg-white text-ink/50 hover:border-ink/25 hover:text-ink/70',
        )}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <svg
        className={cn(
          'pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2',
          active ? 'text-amber' : 'text-ink/30',
        )}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}
