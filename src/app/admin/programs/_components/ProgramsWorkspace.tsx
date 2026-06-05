'use client'

/**
 * ProgramsWorkspace
 * ─────────────────
 * Client-side coordinator that owns the single source of truth for
 * `selectedBlockId` and broadcasts it to both child sections so that:
 *
 *   • Section 1 (ProgramBuilder)       — highlights the active block pill
 *   • Section 2 (PhaseExerciseBuilder) — shows phases for that block ONLY
 *
 * Neither child manages its own "which block is active" state — this
 * component is the sole owner.  This eliminates the cross-block phase
 * leakage bug and the redundant sub-selector in section 2.
 */

import { useState, useEffect } from 'react'
import { ProgramBuilder } from './ProgramBuilder'
import { PhaseExerciseBuilder } from './PhaseExerciseBuilder'
import type { TrainingBlock, Exercise, MovementPattern, Phase } from '@/types'

type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface ProgramsWorkspaceProps {
  blocks:    BlockWithPhases[]
  exercises: Exercise[]
  patterns:  MovementPattern[]
  currentUserId: string
  isAdmin: boolean
}

export function ProgramsWorkspace({ blocks: initialBlocks, exercises, patterns, currentUserId, isAdmin }: ProgramsWorkspaceProps) {
  // Single source of truth for the blocks (with phases), shared by BOTH sections
  // so an edit in section 2 (PhaseExerciseBuilder) instantly updates the
  // structure/timeline/rep-matrix in section 1 (ProgramBuilder).
  const [blocks, setBlocks] = useState<BlockWithPhases[]>(initialBlocks)
  // Re-sync when the server re-fetches (router.refresh after create/delete).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBlocks(initialBlocks) }, [initialBlocks])

  // Prefer first block that has at least one phase; otherwise fall back to first block.
  const [selectedBlockId, setSelectedBlockId] = useState<string>(
    (initialBlocks.find(b => (b.phases ?? []).length > 0) ?? initialBlocks[0])?.id ?? '',
  )

  // Coaches may only edit blocks they created; admins may edit anything.
  const selectedBlock = blocks.find(b => b.id === selectedBlockId) ?? null
  const canEditSelected = isAdmin || (selectedBlock?.created_by === currentUserId)

  return (
    <div className="space-y-10">

      {/* ── Bước 1: Cấu trúc khối tập ─────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-ink text-paper text-xs font-bold flex items-center justify-center">1</span>
          Cấu trúc Khối Tập Luyện
        </h2>
        <ProgramBuilder
          blocks={blocks}
          exercises={exercises}
          patterns={patterns}
          selectedBlockId={selectedBlockId}
          onBlockSelect={setSelectedBlockId}
          onBlocksChange={setBlocks}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      </section>

      {/* ── Bước 2: Cấu hình bài tập theo giai đoạn ───────────────────────── */}
      {blocks.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-ink text-paper text-xs font-bold flex items-center justify-center">2</span>
            Cấu hình Bài Tập theo Giai Đoạn
          </h2>
          {canEditSelected ? (
            <>
              <p className="text-sm text-ink/50 mb-5">
                Giai đoạn bên dưới tự động khớp với khối đang chọn ở trên.
                Gán bài tập cho từng meso, chỉnh sửa trực tiếp — tự lưu.
              </p>
              <PhaseExerciseBuilder
                blocks={blocks}
                exercises={exercises}
                patterns={patterns}
                selectedBlockId={selectedBlockId}
                onBlocksChange={setBlocks}
              />
            </>
          ) : (
            <div className="rounded-xl border border-amber/20 bg-amber/5 px-5 py-4">
              <p className="text-sm font-semibold text-amber/90">Giáo án dùng chung</p>
              <p className="text-sm text-ink/55 mt-1">
                Đây là giáo án do người khác tạo — bạn chỉ có thể xem, không thể chỉnh sửa
                cấu hình bài tập. Bạn vẫn có thể <strong>giao</strong> giáo án này cho học viên
                của mình ở trang <strong>Danh sách Học viên</strong>.
              </p>
            </div>
          )}
        </section>
      )}

    </div>
  )
}
