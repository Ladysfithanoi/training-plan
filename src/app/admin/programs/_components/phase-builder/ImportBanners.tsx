import type { SplitDay } from '@/lib/trainingSplit'
import type { ImportResult } from '../ImportScheduleExcelModal'
import type { ProgramImportResult, WeekImportResult } from '../ImportPlanExcelModal'

// Short-lived banners summarising the last Excel import.

/** Result of the last one-week import — only that week changed. */
export function WeekImportBanner({
  weekImportSummary, onDismiss,
}: { weekImportSummary: WeekImportResult; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-herb/25 bg-herb/6 px-4 py-3 flex items-start gap-3">
      <span className="shrink-0 text-base leading-none mt-0.5">✅</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-herb">
          Đã nhập {weekImportSummary.dayCount} buổi tập vào{' '}
          {weekImportSummary.week == null ? 'bộ Gốc' : `Tuần ${weekImportSummary.week}`}
          {' '}({weekImportSummary.added} dòng bài tập)
        </p>
        <p className="text-[11px] text-ink/60 leading-relaxed">
          {weekImportSummary.week == null
            ? 'Bộ Gốc áp dụng cho mọi tuần chưa có bản riêng.'
            : 'Các tuần khác giữ nguyên — chọn tab tuần ở trên để nhập tiếp tuần kế.'}
        </p>
        {weekImportSummary.createdExercises.length > 0 && (
          <p className="text-[11px] text-ink/60 leading-relaxed">
            {weekImportSummary.createdExercises.length} bài tập mới đã được thêm vào Kho bài tập
            ({weekImportSummary.createdExercises.map(e => e.name).join(', ')}) — mới chỉ có tên,
            hãy vào <span className="font-semibold">Thư viện</span> để điền loại bài, chuỗi
            chuyển động và nhóm cơ.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss()}
        aria-label="Đóng thông báo"
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-ink/30 hover:text-ink hover:bg-ink/6 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}

/** Result of the last whole-program import — the meso's weeks, days and exercises were all rewritten. */
export function ProgramImportBanner({
  programImportSummary, onDismiss,
}: { programImportSummary: ProgramImportResult; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-herb/25 bg-herb/6 px-4 py-3 flex items-start gap-3">
      <span className="shrink-0 text-base leading-none mt-0.5">✅</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-herb">
          Đã tạo {programImportSummary.weeks.length} tuần tập từ Excel
          {' '}({programImportSummary.splitDays.length} buổi/tuần,{' '}
          {programImportSummary.added} dòng bài tập)
        </p>
        <p className="text-[11px] text-ink/60 leading-relaxed">
          Mỗi tuần đã có bản riêng — bấm vào <span className="font-semibold">Tuần 1…N</span> ở trên
          để xem và chỉnh từng tuần.
        </p>
        {programImportSummary.createdExercises.length > 0 && (
          <p className="text-[11px] text-ink/60 leading-relaxed">
            {programImportSummary.createdExercises.length} bài tập mới đã được thêm vào Kho bài tập
            ({programImportSummary.createdExercises.map(e => e.name).join(', ')}) — mới chỉ có tên,
            hãy vào <span className="font-semibold">Thư viện</span> để điền loại bài, chuỗi
            chuyển động và nhóm cơ.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss()}
        aria-label="Đóng thông báo"
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-ink/30 hover:text-ink hover:bg-ink/6 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}

/**
 * Result of the last single-day import — highlights any name that was newly
 * added to Kho bài tập, since those still need their details filled in.
 */
export function DayImportBanner({
  importSummary, activeDay, onDismiss,
}: { importSummary: ImportResult; activeDay: SplitDay | null; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-herb/25 bg-herb/6 px-4 py-3 flex items-start gap-3">
      <span className="shrink-0 text-base leading-none mt-0.5">✅</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-herb">
          Đã nhập {importSummary.added} bài tập từ Excel
          {activeDay ? ` vào “${activeDay.label}”` : ''}
        </p>
        {importSummary.createdExercises.length > 0 && (
          <p className="text-[11px] text-ink/60 leading-relaxed">
            {importSummary.createdExercises.length} bài tập mới đã được thêm vào Kho bài tập
            ({importSummary.createdExercises.map(e => e.name).join(', ')}) — mới chỉ có tên,
            hãy vào <span className="font-semibold">Thư viện</span> để điền loại bài, chuỗi
            chuyển động và nhóm cơ.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss()}
        aria-label="Đóng thông báo"
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-ink/30 hover:text-ink hover:bg-ink/6 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}
