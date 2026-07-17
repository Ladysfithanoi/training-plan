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
import { PhaseExerciseViewer } from './PhaseExerciseViewer'
import type { TrainingBlock, Exercise, MovementPattern, Phase } from '@/types'

type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface ProgramsWorkspaceProps {
  blocks:    BlockWithPhases[]
  exercises: Exercise[]
  patterns:  MovementPattern[]
  currentUserId: string
  isAdmin: boolean
  /** False for trial (Trải nghiệm) accounts — hides all content-authoring UI. */
  canAuthor: boolean
}

export function ProgramsWorkspace({ blocks: initialBlocks, exercises, patterns, currentUserId, isAdmin, canAuthor }: ProgramsWorkspaceProps) {
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

  // Coaches may only edit blocks they created; admins may edit anything; trial
  // accounts (canAuthor=false) can never edit content.
  const selectedBlock = blocks.find(b => b.id === selectedBlockId) ?? null
  const canEditSelected = canAuthor && (isAdmin || selectedBlock?.created_by === currentUserId)

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
          canAuthor={canAuthor}
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
            // Không có quyền chỉnh (giáo án của người khác, hoặc tài khoản trải
            // nghiệm) → vẫn xem được toàn bộ bài tập bên trong, chỉ là read-only.
            <PhaseExerciseViewer
              blocks={blocks}
              selectedBlockId={selectedBlockId}
            />
          )}
        </section>
      )}

    </div>
  )
}
