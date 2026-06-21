'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Input } from '@/components/ui/Input'
import { PhaseTimeline } from '@/components/programs/PhaseTimeline'
import { RepRangeMatrix } from '@/components/programs/RepRangeMatrix'
import { HelpTip } from '@/components/ui/HelpTip'
import { GLOSSARY } from '@/lib/glossary'
import { phaseTypeLabel, phaseTypeBadgeClass, cn } from '@/lib/utils'
import { SPLIT_CONFIGS } from '@/lib/trainingSplit'
import type { SplitType } from '@/lib/trainingSplit'
import type { TrainingBlock, Phase, Exercise, MovementPattern, PhaseType, RepRange } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 4

// ─── Sort types ───────────────────────────────────────────────────────────────

type SortKey =
  | 'date_desc'   // Mới nhất đến cũ nhất (default)
  | 'date_asc'    // Cũ nhất đến mới nhất
  | 'meso_asc'    // Số Meso: Thấp → Cao
  | 'meso_desc'   // Số Meso: Cao → Thấp
  | 'weeks_asc'   // Thời lượng: Ngắn → Dài
  | 'weeks_desc'  // Thời lượng: Dài → Ngắn

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sum of duration_weeks across all phases in a block. */
function blockTotalWeeks(b: TrainingBlock & { phases?: Phase[] }): number {
  return (b.phases ?? []).reduce((sum, p) => sum + (p.duration_weeks ?? 0), 0)
}

/** Sort a copy of the blocks array by the given key. */
function sortBlocks(
  blocks: (TrainingBlock & { phases?: Phase[] })[],
  key: SortKey,
): (TrainingBlock & { phases?: Phase[] })[] {
  return [...blocks].sort((a, b) => {
    switch (key) {
      case 'date_desc':  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'date_asc':   return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      case 'meso_asc':   return (a.phases?.length ?? 0) - (b.phases?.length ?? 0)
      case 'meso_desc':  return (b.phases?.length ?? 0) - (a.phases?.length ?? 0)
      case 'weeks_asc':  return blockTotalWeeks(a) - blockTotalWeeks(b)
      case 'weeks_desc': return blockTotalWeeks(b) - blockTotalWeeks(a)
    }
  })
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS = {
  classic_3_meso: {
    label: '3 Meso (Cổ điển)',
    description: 'Tăng dần tần suất + mở rộng vùng reps qua 3 giai đoạn tập luyện',
    phases: [
      { name: 'Meso 1 — Nền tảng',     phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 2, rep_ranges: [{ min: 5, max: 10 }] as RepRange[],                                                                target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Meso 2 — Tích lũy',     phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 3, rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }] as RepRange[],            target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Meso 3 — Cường độ cao', phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 4, rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }, { min: 20, max: 30, exercise_type: 'cable' }] as RepRange[], target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Duy trì',               phase_type: 'maintenance' as PhaseType, duration_weeks: 3, frequency_per_week: 2, rep_ranges: [{ min: 5, max: 10 }] as RepRange[],                                                         target_set_reduction_factor: 0.333, includes_deload: true, max_rir: null, max_weight_percent: null },
    ],
  },
  active_rest_block: {
    label: '3 Meso + Nghỉ tích cực',
    description: 'Tương tự 3 meso nhưng kết thúc bằng giai đoạn nghỉ tích cực',
    phases: [
      { name: 'Meso 1 — Nền tảng',     phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 2, rep_ranges: [{ min: 5, max: 10 }] as RepRange[],                                                                target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Meso 2 — Tích lũy',     phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 3, rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }] as RepRange[],            target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Meso 3 — Cường độ cao', phase_type: 'training' as PhaseType, duration_weeks: 4, frequency_per_week: 4, rep_ranges: [{ min: 5, max: 10 }, { min: 10, max: 20, exercise_type: 'machine' }, { min: 20, max: 30, exercise_type: 'cable' }] as RepRange[], target_set_reduction_factor: 1.0, includes_deload: false, max_rir: null, max_weight_percent: null },
      { name: 'Nghỉ tích cực',         phase_type: 'active_rest' as PhaseType, duration_weeks: 2, frequency_per_week: 2, rep_ranges: [] as RepRange[],                                                                             target_set_reduction_factor: 0.5, includes_deload: false, max_rir: 10, max_weight_percent: 0.5 },
    ],
  },
}

// ─── Props ────────────────────────────────────────────────────────────────────

type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface ProgramBuilderProps {
  /** Controlled by ProgramsWorkspace — the shared blocks state. */
  blocks: BlockWithPhases[]
  exercises: Exercise[]
  patterns: MovementPattern[]
  /** Controlled: ID of the block currently highlighted. Owned by ProgramsWorkspace. */
  selectedBlockId: string
  /** Notify the workspace that the user changed active block. */
  onBlockSelect: (id: string) => void
  /** Mutate the shared blocks state (create / delete). */
  onBlocksChange: (updater: (prev: BlockWithPhases[]) => BlockWithPhases[]) => void
  currentUserId: string
  isAdmin: boolean
  /** False for trial (Trải nghiệm) accounts — hides create/edit/delete block UI. */
  canAuthor: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProgramBuilder({
  blocks,
  exercises,
  patterns,
  selectedBlockId,
  onBlockSelect,
  onBlocksChange,
  currentUserId,
  isAdmin,
  canAuthor,
}: ProgramBuilderProps) {
  const router = useRouter()

  /** Coaches may edit/delete only blocks they created; admins edit anything;
   *  trial accounts (canAuthor=false) can never edit. */
  const canEdit = (b: BlockWithPhases) => canAuthor && (isAdmin || b.created_by === currentUserId)

  // ── Search + sort + pagination state ───────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey,     setSortKey]     = useState<SortKey>('date_desc')
  const [currentPage, setCurrentPage] = useState(1)

  // ── Modal state ───────────────────────────────────────────────────────────
  const [createOpen,  setCreateOpen]  = useState(false)
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [blockName,   setBlockName]   = useState('')
  const [blockDesc,   setBlockDesc]   = useState('')
  const [preset,      setPreset]      = useState<keyof typeof PRESETS | 'custom'>('classic_3_meso')
  /** Source block id to deep-copy from; '' = create a fresh block from a preset. */
  const [copyFrom,    setCopyFrom]    = useState<string>('')

  // ── Edit block (name + description) modal ──────────────────────────────────
  const [editOpen,    setEditOpen]    = useState(false)
  const [editing,     setEditing]     = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)
  const [editId,      setEditId]      = useState<string | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editDesc,    setEditDesc]    = useState('')

  // ── Delete confirmation (replaces window.confirm) ──────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmDeleteBlock = blocks.find(b => b.id === confirmDeleteId) ?? null

  // ── Search → sort → paginate pipeline ─────────────────────────────────────
  const query           = searchQuery.trim().toLowerCase()
  const filteredBlocks  = query
    ? blocks.filter(b =>
        b.name.toLowerCase().includes(query) ||
        (b.description ?? '').toLowerCase().includes(query),
      )
    : blocks
  const sortedBlocks    = sortBlocks(filteredBlocks, sortKey)
  const totalPages      = Math.max(1, Math.ceil(sortedBlocks.length / ITEMS_PER_PAGE))
  // Clamp the page if a search/sort change shrank the result set below it.
  const safePage        = Math.min(currentPage, totalPages)
  const paginatedBlocks = sortedBlocks.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage       * ITEMS_PER_PAGE,
  )
  const selectedBlock   = blocks.find(b => b.id === selectedBlockId) ?? null

  // ── Search change helper (always resets to page 1) ────────────────────────
  function applySearch(value: string) {
    setSearchQuery(value)
    setCurrentPage(1)
  }

  // ── Sort change helper (always resets to page 1) ──────────────────────────
  function applySort(key: SortKey) {
    setSortKey(key)
    setCurrentPage(1)
  }

  // Derive per-dropdown "active" values so only the matching group shows selection
  const dateSortValue  = sortKey.startsWith('date_')  ? sortKey : ''
  const mesoSortValue  = sortKey.startsWith('meso_')  ? sortKey : ''
  const weeksSortValue = sortKey.startsWith('weeks_') ? sortKey : ''

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openCreateModal() {
    setBlockName('')
    setBlockDesc('')
    setPreset('classic_3_meso')
    setCopyFrom('')
    setCreateError(null)
    setCreateOpen(true)
  }

  /** Pick a source block to copy. Prefills the name (server adds " (n)" if it
   *  collides) only when the name field is still empty, so a typed name wins. */
  function handleSelectCopySource(id: string) {
    setCopyFrom(id)
    if (id) {
      const src = blocks.find(b => b.id === id)
      if (src && !blockName.trim()) setBlockName(src.name)
    }
  }

  async function handleCreate() {
    if (!blockName.trim()) return
    setCreating(true)
    setCreateError(null)

    try {
      const res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        blockName.trim(),
          description: blockDesc.trim() || null,
          // When copying, the structure comes from the source block, not a preset.
          preset:      copyFrom ? null : (preset !== 'custom' ? preset : null),
          copy_from:   copyFrom || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setCreateError(data.error ?? `Lỗi máy chủ (${res.status})`)
        setCreating(false)
        return
      }

      const { block } = data
      onBlocksChange(prev => [block, ...prev])
      onBlockSelect(block.id)
      // New block is newest → switch to date_desc so it lands on page 1
      setSortKey('date_desc')
      setCurrentPage(1)
      setCreateOpen(false)
      setBlockName('')
      setBlockDesc('')
      setCopyFrom('')
      setCreateError(null)
      router.refresh()
    } catch (err) {
      console.error('handleCreate error:', err)
      setCreateError('Không thể kết nối đến máy chủ. Vui lòng thử lại.')
    }

    setCreating(false)
  }

  function openEditModal(block: BlockWithPhases) {
    setEditId(block.id)
    setEditName(block.name)
    setEditDesc(block.description ?? '')
    setEditError(null)
    setEditOpen(true)
  }

  async function handleUpdate() {
    if (!editId || !editName.trim()) return
    setEditing(true)
    setEditError(null)

    try {
      const res = await fetch(`/api/programs/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        editName.trim(),
          description: editDesc.trim() || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setEditError(data.error ?? `Lỗi máy chủ (${res.status})`)
        setEditing(false)
        return
      }

      const { block } = data
      // Patch the shared state so section 1 + 2 update instantly. Keep the
      // existing phases (PATCH only returns the block row, not its phases).
      onBlocksChange(prev =>
        prev.map(b =>
          b.id === editId
            ? { ...b, name: block.name, description: block.description }
            : b,
        ),
      )
      setEditOpen(false)
      setEditError(null)
      // Re-fetch server data so every other view (assignments, athlete pages,
      // coach selector…) that reads this block by id shows the new name/desc.
      router.refresh()
    } catch (err) {
      console.error('handleUpdate error:', err)
      setEditError('Không thể kết nối đến máy chủ. Vui lòng thử lại.')
    }

    setEditing(false)
  }

  async function handleDelete(blockId: string) {
    const res = await fetch(`/api/programs/${blockId}`, { method: 'DELETE' })
    if (res.ok) {
      const newBlocks     = blocks.filter(b => b.id !== blockId)
      onBlocksChange(prev => prev.filter(b => b.id !== blockId))
      if (selectedBlockId === blockId) onBlockSelect(newBlocks[0]?.id ?? '')
      // Clamp page if last page becomes empty
      const newTotalPages = Math.max(1, Math.ceil(newBlocks.length / ITEMS_PER_PAGE))
      if (currentPage > newTotalPages) setCurrentPage(newTotalPages)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* ── Block list ────────────────────────────────────────────────────── */}
      <div className="space-y-3">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Các Khối Tập
          </h2>
          {canAuthor && (
            <Button size="sm" type="button" onClick={openCreateModal}>
              + Tạo mới
            </Button>
          )}
        </div>

        {/* ── Search box ───────────────────────────────────────────────────── */}
        {blocks.length > 1 && (
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/30"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => applySearch(e.target.value)}
              placeholder="Tìm khối tập theo tên…"
              className="w-full h-9 rounded-lg border border-ink/12 bg-white pl-9 pr-9 text-sm text-ink placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => applySearch('')}
                aria-label="Xoá tìm kiếm"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-ink/35 hover:text-ink hover:bg-ink/5 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* ── Sort toolbar ─────────────────────────────────────────────────── */}
        {blocks.length > 1 && (
          <div className="flex flex-col gap-1.5">
            {/* Row 1: Date + Meso */}
            <div className="flex gap-1.5">
              {/* Sort by date */}
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

              {/* Sort by meso count */}
              <SortSelect
                value={mesoSortValue}
                placeholder="Số Meso"
                options={[
                  { value: 'meso_asc',  label: 'Meso: Ít → Nhiều' },
                  { value: 'meso_desc', label: 'Meso: Nhiều → Ít' },
                ]}
                onChange={v => applySort((v || 'date_desc') as SortKey)}
                active={sortKey.startsWith('meso_')}
              />
            </div>

            {/* Row 2: Weeks + count badge */}
            <div className="flex items-center gap-1.5">
              {/* Sort by total weeks */}
              <SortSelect
                value={weeksSortValue}
                placeholder="Thời lượng"
                options={[
                  { value: 'weeks_asc',  label: 'Ngắn → Dài' },
                  { value: 'weeks_desc', label: 'Dài → Ngắn' },
                ]}
                onChange={v => applySort((v || 'date_desc') as SortKey)}
                active={sortKey.startsWith('weeks_')}
              />

              <span className="ml-auto font-mono text-[10px] text-ink/30 tabular-nums whitespace-nowrap shrink-0">
                {query ? `${filteredBlocks.length}/${blocks.length}` : blocks.length} khối
              </span>
            </div>
          </div>
        )}

        {/* ── Block cards ──────────────────────────────────────────────────── */}
        {blocks.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-center text-ink/40 py-4">
                Chưa có khối tập nào.<br />Hãy tạo khối tập đầu tiên của bạn!
              </p>
            </CardBody>
          </Card>
        ) : sortedBlocks.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-center text-ink/40 py-4">
                Không tìm thấy khối tập nào khớp với “{searchQuery.trim()}”.
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="space-y-2">
              {paginatedBlocks.map(block => {
                const phaseCount  = block.phases?.length ?? 0
                const totalWeeks  = blockTotalWeeks(block)
                const isSelected  = selectedBlockId === block.id

                return (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onBlockSelect(block.id)}
                    className={cn(
                      'w-full text-left rounded-xl border px-4 py-3 transition-all',
                      isSelected
                        ? 'border-ink bg-white shadow-sm'
                        : 'border-ink/8 bg-white/60 hover:border-ink/20',
                    )}
                  >
                    <p className="font-sans font-semibold text-sm text-ink leading-snug">
                      {block.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn(
                        'font-mono text-[10px] tabular-nums rounded-full px-2 py-0.5 font-semibold',
                        isSelected
                          ? 'bg-ink/8 text-ink/60'
                          : 'bg-ink/5 text-ink/40',
                      )}>
                        {phaseCount} giai đoạn
                      </span>
                      {totalWeeks > 0 && (
                        <>
                          <span className="text-ink/20 text-[10px]">·</span>
                          <span className={cn(
                            'font-mono text-[10px] tabular-nums text-ink/35',
                            isSelected && 'text-ink/50',
                          )}>
                            {totalWeeks} tuần
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* ── Pagination footer ───────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage(safePage - 1)}
                  aria-label="Trang trước"
                  className="h-8 w-8 rounded-lg flex items-center justify-center border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="font-mono text-xs text-ink/45 tabular-nums select-none">
                  Trang {safePage} / {totalPages}
                </span>

                <button
                  type="button"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage(safePage + 1)}
                  aria-label="Trang sau"
                  className="h-8 w-8 rounded-lg flex items-center justify-center border border-ink/12 text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Block detail ──────────────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        {!selectedBlock ? (
          <Card>
            <CardBody>
              <p className="text-sm text-center text-ink/40 py-8">
                Chọn một khối tập để xem chi tiết các giai đoạn bên trong.
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink font-sans">{selectedBlock.name}</h2>
                {selectedBlock.description && (
                  <p className="text-sm text-ink/50 mt-1 font-sans">{selectedBlock.description}</p>
                )}
                {/* Summary badges */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="font-mono text-[10px] tabular-nums rounded-full px-2.5 py-1 bg-ink/5 text-ink/50 font-semibold">
                    {selectedBlock.phases?.length ?? 0} giai đoạn
                  </span>
                  {blockTotalWeeks(selectedBlock) > 0 && (
                    <span className="font-mono text-[10px] tabular-nums rounded-full px-2.5 py-1 bg-amber/8 text-amber/80 border border-amber/15 font-semibold">
                      {blockTotalWeeks(selectedBlock)} tuần
                    </span>
                  )}
                  {!canEdit(selectedBlock) && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 bg-ink/5 text-ink/40">
                      Dùng chung
                    </span>
                  )}
                </div>
              </div>
              {canEdit(selectedBlock) && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditModal(selectedBlock)}
                  >
                    Sửa
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(selectedBlock.id)}
                    className="text-danger hover:bg-danger/8"
                  >
                    Xoá khối tập
                  </Button>
                </div>
              )}
            </div>

            {/* Phase timeline */}
            {(selectedBlock.phases?.length ?? 0) > 0 ? (
              <>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-3">
                    Tiến trình giai đoạn
                  </h3>
                  <PhaseTimeline phases={selectedBlock.phases ?? []} />
                </div>

                {(selectedBlock.phases ?? []).some(p => p.phase_type === 'training') && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-3 flex items-center gap-1.5">
                      Ma trận vùng Reps
                      <HelpTip text={GLOSSARY.repZones.def} />
                    </h3>
                    <Card>
                      <CardBody>
                        <RepRangeMatrix phases={selectedBlock.phases ?? []} />
                      </CardBody>
                    </Card>
                  </div>
                )}

                {/* Periodization summary — tabular row-by-row layout */}
                <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-6 shadow-sm">
                  <h3 className="text-lg md:text-xl font-bold text-slate-800 mb-4 md:mb-6 flex items-center gap-2">
                    Cấu trúc Phân kỳ
                    <HelpTip text={GLOSSARY.meso.def} />
                  </h3>

                  {/* Column headers — hidden on mobile (rows stack with inline labels) */}
                  <div className="hidden md:grid grid-cols-12 gap-4 items-center pb-2 mb-1 border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <span className="col-span-2">Trạng thái</span>
                    <span className="col-span-3">Giai đoạn</span>
                    <span className="col-span-2">Thời lượng</span>
                    <span className="col-span-2">Tần suất</span>
                    <span className="col-span-3">Chi tiết</span>
                  </div>

                  {(selectedBlock.phases ?? [])
                    .sort((a, b) => a.phase_order - b.phase_order)
                    .map(phase => {
                      // ── Per-phase derived display values ────────────────────
                      const badgePastel =
                        phase.phase_type === 'training'    ? 'bg-emerald-50 text-emerald-700'
                        : phase.phase_type === 'maintenance' ? 'bg-slate-100 text-slate-600'
                        : 'bg-sky-50 text-sky-700'

                      const frequency =
                        phase.phase_type === 'training'    ? `${phase.frequency_per_week}×/tuần`
                        : phase.phase_type === 'maintenance' ? '2×/tuần'
                        : '≤2 buổi/tuần'

                      const detail =
                        phase.phase_type === 'training'
                          ? `${phase.rep_ranges.map(rr => `${rr.min}–${rr.max}`).join(', ')} reps`
                        : phase.phase_type === 'maintenance'
                          ? `5–10 reps · ${Math.round(phase.target_set_reduction_factor * 100)}% khối lượng Meso-2${phase.includes_deload ? ' · Kết thúc bằng deload' : ''}`
                          : `<${Math.round((phase.max_weight_percent ?? 0.5) * 100)}% trọng lượng · tối đa ${phase.max_rir ?? 10} RIR`

                      const splitType = (phase as { split_type?: string }).split_type
                      const splitLabel = splitType
                        ? (SPLIT_CONFIGS[splitType as SplitType]?.label ?? splitType)
                        : null

                      return (
                        <div key={phase.id} className="flex flex-col gap-1.5 md:grid md:grid-cols-12 md:gap-4 md:items-center py-3.5 md:py-4 border-b border-slate-100 md:border-slate-50 last:border-none">
                          {/* A — status badge */}
                          <div className="md:col-span-2">
                            <span className={cn(
                              'inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full uppercase tracking-wide',
                              badgePastel,
                            )}>
                              {phaseTypeLabel(phase.phase_type)}
                            </span>
                          </div>

                          {/* B — title + optional split sub-tag */}
                          <div className="md:col-span-3 min-w-0">
                            <p className="font-bold text-slate-700 text-sm leading-tight">{phase.name}</p>
                            {splitLabel && (
                              <span className="bg-amber-50 text-amber-700 text-[11px] font-medium px-2 py-0.5 rounded-md mt-1 inline-block">
                                {splitLabel}
                              </span>
                            )}
                          </div>

                          {/* C — duration */}
                          <div className="md:col-span-2">
                            <p className="text-sm font-medium text-slate-600">
                              <span className="md:hidden text-slate-400 font-normal">Thời lượng: </span>
                              {phase.duration_weeks} tuần
                            </p>
                          </div>

                          {/* D — frequency */}
                          <div className="md:col-span-2">
                            <p className="text-sm font-medium text-slate-600">
                              <span className="md:hidden text-slate-400 font-normal">Tần suất: </span>
                              {frequency}
                            </p>
                          </div>

                          {/* E — rep ranges & custom rules */}
                          <div className="md:col-span-3">
                            <p className="text-sm text-slate-500 leading-relaxed break-words">
                              <span className="md:hidden text-slate-400">Chi tiết: </span>
                              {detail}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </>
            ) : (
              <Card>
                <CardBody>
                  <p className="text-sm text-center text-ink/40 py-4">
                    Khối tập này chưa có giai đoạn nào. Giai đoạn sẽ được tạo khi bạn chọn preset.
                  </p>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Create Block Modal ────────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateError(null) }}
        title="Tạo Khối Tập Luyện Mới"
        size="lg"
      >
        <div className="space-y-5">
          {/* Copy-from-existing selector */}
          {blocks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                Sao chép từ khối có sẵn (tuỳ chọn)
              </label>
              <div className="relative">
                <select
                  value={copyFrom}
                  onChange={e => handleSelectCopySource(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-ink/15 pl-3 pr-9 py-2.5 text-sm text-ink bg-white focus:border-amber focus:ring-1 focus:ring-amber outline-none cursor-pointer"
                >
                  <option value="">— Không, tạo khối mới —</option>
                  {sortBlocks(blocks, 'date_desc').map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {copyFrom && (
                <p className="text-xs text-ink/50">
                  Toàn bộ giai đoạn, bài tập và cấu hình ngày tập sẽ được sao chép.
                  Nếu trùng tên, hệ thống tự thêm số thứ tự để phân biệt.
                </p>
              )}
            </div>
          )}

          <Input
            label="Tên khối tập"
            value={blockName}
            onChange={e => setBlockName(e.target.value)}
            placeholder="VD: Khối Tăng Cơ Mùa Hè"
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Mô tả (tuỳ chọn)
            </label>
            <textarea
              rows={2}
              value={blockDesc}
              onChange={e => setBlockDesc(e.target.value)}
              placeholder="Ghi chú ngắn về mục tiêu của khối tập..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink bg-white placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-none"
            />
          </div>

          {/* Preset selector — hidden when copying (structure comes from source) */}
          {!copyFrom && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Cấu trúc giai đoạn (Preset)</p>
            {Object.entries(PRESETS).map(([key, p]) => (
              <label
                key={key}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all',
                  preset === key
                    ? 'border-ink bg-white shadow-sm'
                    : 'border-ink/8 hover:border-ink/20',
                )}
              >
                <input
                  type="radio"
                  name="preset"
                  value={key}
                  checked={preset === key}
                  onChange={() => setPreset(key as keyof typeof PRESETS)}
                  className="mt-0.5 accent-amber"
                />
                <div>
                  <p className="font-sans font-semibold text-sm text-ink">{p.label}</p>
                  <p className="font-sans text-xs text-ink/50 mt-0.5">{p.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.phases.map((ph, i) => (
                      <span
                        key={i}
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5',
                          phaseTypeBadgeClass(ph.phase_type),
                        )}
                      >
                        {ph.name}
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            ))}
            <label
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all',
                preset === 'custom'
                  ? 'border-ink bg-white shadow-sm'
                  : 'border-ink/8 hover:border-ink/20',
              )}
            >
              <input
                type="radio"
                name="preset"
                value="custom"
                checked={preset === 'custom'}
                onChange={() => setPreset('custom')}
                className="mt-0.5 accent-amber"
              />
              <div>
                <p className="font-sans font-semibold text-sm text-ink">Tuỳ chỉnh</p>
                <p className="font-sans text-xs text-ink/50 mt-0.5">Tạo khối trống và thêm giai đoạn thủ công</p>
              </div>
            </label>
          </div>
          )}

          {createError && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
              {createError}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              loading={creating}
              onClick={handleCreate}
              disabled={!blockName.trim() || creating}
              className="flex-1"
            >
              Tạo khối tập
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Block Modal (name + description) ──────────────────────────── */}
      <Modal
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditError(null) }}
        title="Sửa Khối Tập Luyện"
        size="lg"
      >
        <div className="space-y-5">
          <Input
            label="Tên khối tập"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="VD: Khối Tăng Cơ Mùa Hè"
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Mô tả (tuỳ chọn)
            </label>
            <textarea
              rows={2}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Ghi chú ngắn về mục tiêu của khối tập..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink bg-white placeholder:text-ink/35 focus:border-amber focus:ring-1 focus:ring-amber outline-none resize-none"
            />
          </div>

          <p className="text-xs text-ink/45">
            Đổi tên hoặc mô tả sẽ tự cập nhật ở mọi nơi dùng khối tập này
            (giáo án đã giao cho học viên, lịch tập cá nhân…).
          </p>

          {editError && (
            <p className="rounded-lg bg-danger/8 border border-danger/20 px-3 py-2 text-sm text-danger">
              {editError}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              loading={editing}
              onClick={handleUpdate}
              disabled={!editName.trim() || editing}
              className="flex-1"
            >
              Lưu thay đổi
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setEditOpen(false); setEditError(null) }}
              disabled={editing}
            >
              Huỷ
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Confirm: xoá khối tập ──────────────────────────────────────────── */}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Xoá khối tập luyện"
        description={
          confirmDeleteBlock
            ? `Xoá khối tập “${confirmDeleteBlock.name}” và tất cả các giai đoạn bên trong? Hành động này không thể hoàn tác.`
            : 'Xoá khối tập này và tất cả các giai đoạn bên trong? Hành động này không thể hoàn tác.'
        }
        confirmLabel="Xoá khối tập"
        onConfirm={() => {
          const id = confirmDeleteId!
          setConfirmDeleteId(null)
          void handleDelete(id)
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
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
      {/* Custom chevron */}
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
