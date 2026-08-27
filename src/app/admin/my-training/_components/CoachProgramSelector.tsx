'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BlockSearchPicker } from '@/components/programs/BlockSearchPicker'
import type { TrainingBlock, Phase } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 4

// ─── Props ────────────────────────────────────────────────────────────────────

type BlockWithPhases = TrainingBlock & { phases?: Pick<Phase, 'id' | 'duration_weeks' | 'phase_order'>[] }

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
      // Drop the ?switch=1 param — otherwise the page keeps forcing the selector
      // (forceSelector stays true) and the freshly-activated program never shows.
      router.replace('/admin/my-training')
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
              Tìm theo tên hoặc mô tả, chọn một khối tập luyện và xác nhận để kích hoạt chương trình cá nhân.
            </p>
          </div>
        </div>
      </div>

      {/* ── Tìm kiếm + chọn khối ──────────────────────────────────────────── */}
      <BlockSearchPicker
        blocks={blocks}
        selectedBlockId={selectedBlockId}
        onSelect={setSelectedBlockId}
        pageSize={ITEMS_PER_PAGE}
        placeholder="Tìm kiếm khối tập…"
        className="space-y-5"
      />

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
