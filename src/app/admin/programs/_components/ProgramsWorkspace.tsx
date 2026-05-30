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

import { useState } from 'react'
import { ProgramBuilder } from './ProgramBuilder'
import { PhaseExerciseBuilder } from './PhaseExerciseBuilder'
import type { TrainingBlock, Exercise, MovementPattern, Phase } from '@/types'

type BlockWithPhases = TrainingBlock & { phases: Phase[] }

interface ProgramsWorkspaceProps {
  blocks:    BlockWithPhases[]
  exercises: Exercise[]
  patterns:  MovementPattern[]
}

export function ProgramsWorkspace({ blocks, exercises, patterns }: ProgramsWorkspaceProps) {
  // Prefer first block that has at least one phase; otherwise fall back to first block.
  const [selectedBlockId, setSelectedBlockId] = useState<string>(
    (blocks.find(b => (b.phases ?? []).length > 0) ?? blocks[0])?.id ?? '',
  )

  return (
    <div className="space-y-10">

      {/* ── Bước 1: Cấu trúc khối tập ─────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-ink text-paper text-xs font-bold flex items-center justify-center">1</span>
          Cấu trúc Khối Tập Luyện
        </h2>
        <ProgramBuilder
          blocks={blocks as TrainingBlock[]}
          exercises={exercises}
          patterns={patterns}
          selectedBlockId={selectedBlockId}
          onBlockSelect={setSelectedBlockId}
        />
      </section>

      {/* ── Bước 2: Cấu hình bài tập theo giai đoạn ───────────────────────── */}
      {blocks.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-ink text-paper text-xs font-bold flex items-center justify-center">2</span>
            Cấu hình Bài Tập theo Giai Đoạn
          </h2>
          <p className="text-sm text-ink/50 mb-5">
            Giai đoạn bên dưới tự động khớp với khối đang chọn ở trên.
            Gán bài tập cho từng meso, chỉnh sửa trực tiếp — tự lưu.
          </p>
          <PhaseExerciseBuilder
            blocks={blocks}
            exercises={exercises}
            patterns={patterns}
            selectedBlockId={selectedBlockId}
          />
        </section>
      )}

    </div>
  )
}
