'use client'

/**
 * ImportScheduleExcelModal
 * ────────────────────────
 * Fills ONE training day of a meso from an Excel/CSV sheet instead of adding
 * bài tập one at a time.
 *
 * The sheet only ever carries prescription data (name, hiệp, reps, RIR, STT).
 * Names are matched against Kho bài tập case-insensitively:
 *   • already in the library → reused as-is, nothing about it is touched
 *   • not in the library     → created with ONLY its name, so the coach fills in
 *     type / vùng rep / nhóm cơ by hand in Thư viện afterwards
 * That split is deliberate: a spreadsheet is a fine place to plan a session but
 * a bad place to curate an exercise library.
 */

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  COLUMN_ALIASES,
  cellText,
  normalizeHeader,
  parseBool,
  resolveColumn,
  splitRepRange,
} from '@/lib/excelImport'
import type { Exercise, PhaseExercise } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  name: string
  sets: string
  repMin: string
  repMax: string
  rir: string
  orderLabel: string
  isWarmup: boolean
  notes: string
}

export interface ImportResult {
  added: number
  createdExercises: { id: string; name: string }[]
  phaseExercises: (PhaseExercise & { exercise: Exercise })[]
}

interface Props {
  open: boolean
  onClose: () => void
  /** Current library — decides which sheet names are flagged as new. */
  exercises: Exercise[]
  phaseId: string
  /** Day the rows land on; null when the meso has no split configured. */
  dayId: string | null
  dayLabel: string | null
  /** Week scope (migration 011): null = Gốc, 1..N = that week's override. */
  weekNumber: number | null
  onImported: (result: ImportResult) => void
}

// Column resolution + cell coercion live in @/lib/excelImport — shared with the
// whole-program (multi-sheet) importer so both accept identical spreadsheets.

// ─── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'Tên bài tập', 'Số hiệp', 'Reps', 'RIR', 'STT', 'Khởi động', 'Ghi chú',
]

const TEMPLATE_SAMPLE = [
  ['Barbell Back Squat',      4, '5-8',   2, 'A',  '',  'Giữ lưng trung tính'],
  ['Romanian Deadlift',       3, '8-12',  2, 'B',  '',  ''],
  ['Leg Press',               3, '10-15', 1, 'C',  '',  ''],
  ['Seated Leg Curl',         3, '12-15', 1, 'D',  '',  ''],
  ['Đạp xe khởi động',        1, '10',    5, '',   'x', 'Làm nóng 5 phút'],
]

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportScheduleExcelModal({
  open, onClose, exercises, phaseId, dayId, dayLabel, weekNumber, onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [rows, setRows]           = useState<ParsedRow[]>([])
  const [fileName, setFileName]   = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone]           = useState<ImportResult | null>(null)

  /** Lowercase library names — drives the "mới" badge in the preview. */
  const libraryNames = new Set(exercises.map(e => e.name.trim().toLowerCase()))
  const newNameCount = new Set(
    rows.map(r => r.name.trim().toLowerCase())
        .filter(n => n && !libraryNames.has(n)),
  ).size

  function reset() {
    setRows([])
    setFileName(null)
    setParseError(null)
    setImportError(null)
    setDone(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Template download ──────────────────────────────────────────────────────
  async function downloadTemplate() {
    const xlsx  = await import('xlsx')
    const sheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE])
    sheet['!cols'] = [
      { wch: 30 }, { wch: 9 }, { wch: 10 }, { wch: 7 },
      { wch: 7 }, { wch: 11 }, { wch: 32 },
    ]
    const book = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(book, sheet, 'Bài tập')
    xlsx.writeFile(book, 'mau-nhap-bai-tap.xlsx')
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    reset()
    setFileName(file.name)

    try {
      const xlsx     = await import('xlsx')
      const buffer   = await file.arrayBuffer()
      const workbook = xlsx.read(buffer, { type: 'array' })
      const sheet    = workbook.Sheets[workbook.SheetNames[0]]
      const raw      = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

      if (raw.length < 2) {
        setParseError('Tệp không có dòng dữ liệu nào (chỉ có tiêu đề hoặc rỗng).')
        return
      }

      const headers  = (raw[0] ?? []).map(normalizeHeader)
      const nameIdx  = resolveColumn(headers, COLUMN_ALIASES.name)

      if (nameIdx === -1) {
        setParseError('Không tìm thấy cột "Tên bài tập". Hàng đầu tiên phải là tiêu đề cột — tải file mẫu để xem đúng định dạng.')
        return
      }

      const setsIdx   = resolveColumn(headers, COLUMN_ALIASES.sets)
      const repsIdx   = resolveColumn(headers, COLUMN_ALIASES.reps)
      const repMinIdx = resolveColumn(headers, COLUMN_ALIASES.repMin)
      const repMaxIdx = resolveColumn(headers, COLUMN_ALIASES.repMax)
      const rirIdx    = resolveColumn(headers, COLUMN_ALIASES.rir)
      const orderIdx  = resolveColumn(headers, COLUMN_ALIASES.order)
      const warmupIdx = resolveColumn(headers, COLUMN_ALIASES.warmup)
      const notesIdx  = resolveColumn(headers, COLUMN_ALIASES.notes)

      const parsed: ParsedRow[] = []
      for (let i = 1; i < raw.length; i++) {
        const row  = raw[i] ?? []
        const name = cellText(row[nameIdx])
        if (!name) continue

        // Separate min/max columns win; otherwise fall back to a "8-12" cell.
        let repMin = repMinIdx !== -1 ? cellText(row[repMinIdx]) : ''
        let repMax = repMaxIdx !== -1 ? cellText(row[repMaxIdx]) : ''
        if ((!repMin || !repMax) && repsIdx !== -1) {
          const range = splitRepRange(row[repsIdx])
          if (range) { repMin = repMin || range.min; repMax = repMax || range.max }
        }

        parsed.push({
          name,
          sets:       setsIdx   !== -1 ? cellText(row[setsIdx])   : '',
          repMin:     repMin    || '8',
          repMax:     repMax    || '12',
          rir:        rirIdx    !== -1 ? cellText(row[rirIdx])    : '',
          orderLabel: orderIdx  !== -1 ? cellText(row[orderIdx]).toUpperCase() : '',
          isWarmup:   warmupIdx !== -1 ? parseBool(row[warmupIdx]) : false,
          notes:      notesIdx  !== -1 ? cellText(row[notesIdx])  : '',
        })
      }

      if (parsed.length === 0) {
        setParseError('Không có dòng nào có tên bài tập.')
        return
      }

      setRows(parsed)
    } catch (err) {
      setParseError(`Lỗi đọc tệp: ${err instanceof Error ? err.message : 'Không xác định'}`)
    }
  }

  function updateRow(i: number, patch: Partial<ParsedRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    setImporting(true)
    setImportError(null)

    try {
      const res = await fetch(`/api/phases/${phaseId}/exercises/import`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_id:      dayId,
          week_number: weekNumber,
          rows: rows
            .filter(r => r.name.trim())
            .map(r => ({
              name:           r.name.trim(),
              target_sets:    r.sets   ? parseInt(r.sets, 10)   : 3,
              target_rep_min: r.repMin ? parseInt(r.repMin, 10) : 8,
              target_rep_max: r.repMax ? parseInt(r.repMax, 10) : 12,
              rir_target:     r.rir    ? parseInt(r.rir, 10)    : 2,
              order_label:    r.orderLabel || null,
              is_warmup:      r.isWarmup,
              notes:          r.notes || null,
            })),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setImportError(data.error ?? 'Nhập thất bại')
        return
      }

      const result: ImportResult = {
        added:            data.added ?? 0,
        createdExercises: data.created_exercises ?? [],
        phaseExercises:   data.exercises ?? [],
      }
      setDone(result)
      onImported(result)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Lỗi kết nối')
    } finally {
      setImporting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const scopeLabel = [
    dayLabel ? `buổi “${dayLabel}”` : 'giáo án',
    weekNumber == null ? 'Gốc (mọi tuần)' : `Tuần ${weekNumber}`,
  ].join(' · ')

  return (
    <Modal open={open} onClose={handleClose} title="Nhập bài tập từ Excel" size="lg">
      {done ? (
        <div className="py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-herb/10 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-ink">Nhập thành công</p>
          <p className="text-sm text-ink/55">
            {done.added} bài tập đã được thêm vào {scopeLabel}.
          </p>
          {done.createdExercises.length > 0 && (
            <div className="mx-auto max-w-md rounded-xl border border-amber/25 bg-amber/6 px-4 py-3 text-left">
              <p className="text-xs font-semibold text-amber mb-1">
                {done.createdExercises.length} bài tập mới đã được thêm vào Kho bài tập
              </p>
              <p className="text-xs text-ink/55 leading-relaxed">
                {done.createdExercises.map(e => e.name).join(', ')}
              </p>
              <p className="text-[11px] text-ink/40 mt-2">
                Mới chỉ có tên — hãy vào <span className="font-semibold">Thư viện</span> để điền loại bài,
                chuỗi chuyển động, vùng rep và nhóm cơ.
              </p>
            </div>
          )}
          <Button variant="primary" onClick={handleClose}>Hoàn tất</Button>
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Scope ──────────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-ink/10 bg-ink/3 px-4 py-3 text-xs text-ink/60">
            Bài tập sẽ được thêm vào <span className="font-semibold text-ink">{scopeLabel}</span>.
          </div>

          {/* ── Drop zone ──────────────────────────────────────────────────── */}
          <div
            className="rounded-xl border-2 border-dashed border-ink/20 p-6 text-center cursor-pointer hover:border-amber/50 hover:bg-amber/3 transition-all"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) void handleFile(file)
            }}
          >
            <svg className="h-8 w-8 text-ink/25 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-ink/60">
              {fileName ?? 'Kéo thả hoặc nhấn để chọn tệp'}
            </p>
            <p className="text-xs text-ink/35 mt-1">.xlsx, .xls, .csv — hàng đầu tiên là tiêu đề cột</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
          </div>

          {/* ── Template + column hint ─────────────────────────────────────── */}
          <div className="rounded-xl bg-amber/6 border border-amber/15 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-semibold text-amber">Chưa có file? Tải mẫu về rồi điền vào</p>
              <Button size="sm" variant="secondary" onClick={() => void downloadTemplate()}>
                ⬇ Tải file mẫu
              </Button>
            </div>
            <p className="text-[11px] text-ink/55 leading-relaxed">
              Cột nhận dạng được (không phân biệt hoa/thường, có dấu hay không):{' '}
              <span className="font-medium text-ink/70">Tên bài tập</span> (bắt buộc), Số hiệp,
              Reps (&ldquo;8-12&rdquo;) hoặc Rep min / Rep max, RIR, STT, Khởi động, Ghi chú.
            </p>
            <p className="text-[11px] text-ink/45 leading-relaxed">
              Tên bài đã có trong Kho bài tập sẽ được dùng lại nguyên trạng. Tên chưa có sẽ được
              thêm vào Kho — <span className="font-medium">chỉ mỗi tên</span>, các thông tin khác điền tay sau.
            </p>
          </div>

          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {/* ── Preview ────────────────────────────────────────────────────── */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-ink">
                  {rows.length} bài tập — kiểm tra trước khi nhập
                </p>
                {newNameCount > 0 && (
                  <p className="text-xs text-amber font-medium">
                    {newNameCount} bài tập mới sẽ được thêm vào Kho bài tập
                  </p>
                )}
              </div>

              <div className="overflow-auto max-h-72 rounded-xl border border-ink/8 bg-white">
                <table className="w-full text-xs min-w-[680px]">
                  <thead className="border-b border-ink/8 sticky top-0 bg-white z-10">
                    <tr className="text-ink/40 uppercase tracking-wide">
                      <th className="text-left px-3 py-2">Tên bài tập</th>
                      <th className="text-left px-3 py-2 w-16">Hiệp</th>
                      <th className="text-left px-3 py-2 w-16">Rep min</th>
                      <th className="text-left px-3 py-2 w-16">Rep max</th>
                      <th className="text-left px-3 py-2 w-14">RIR</th>
                      <th className="text-left px-3 py-2 w-14">STT</th>
                      <th className="text-left px-3 py-2 w-16">K.động</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {rows.map((row, i) => {
                      const isNew = !!row.name.trim() && !libraryNames.has(row.name.trim().toLowerCase())
                      return (
                        <tr key={i} className="hover:bg-ink/2">
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={row.name}
                                onChange={e => updateRow(i, { name: e.target.value })}
                                className="w-full bg-transparent focus:outline-none focus:bg-white rounded px-1 py-0.5 border border-transparent focus:border-amber/40"
                              />
                              {isNew && (
                                <span className="shrink-0 rounded-full bg-amber/15 text-amber border border-amber/30 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none">
                                  mới
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" value={row.sets} placeholder="3"
                              onChange={e => updateRow(i, { sets: e.target.value })}
                              className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40" />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" value={row.repMin}
                              onChange={e => updateRow(i, { repMin: e.target.value })}
                              className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40" />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" value={row.repMax}
                              onChange={e => updateRow(i, { repMax: e.target.value })}
                              className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40" />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" value={row.rir} placeholder="2"
                              onChange={e => updateRow(i, { rir: e.target.value })}
                              className="w-10 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40" />
                          </td>
                          <td className="px-3 py-1.5">
                            <input value={row.orderLabel} placeholder="auto"
                              onChange={e => updateRow(i, { orderLabel: e.target.value.toUpperCase() })}
                              className="w-12 bg-transparent focus:outline-none focus:bg-white rounded px-1 border border-transparent focus:border-amber/40" />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <input type="checkbox" checked={row.isWarmup}
                              onChange={e => updateRow(i, { isWarmup: e.target.checked })}
                              className="accent-amber" />
                          </td>
                          <td className="px-1 py-1.5">
                            <button type="button" onClick={() => removeRow(i)} title="Bỏ dòng này"
                              className="h-6 w-6 flex items-center justify-center rounded text-ink/25 hover:text-danger hover:bg-danger/6 transition-colors">
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {importError && <p className="text-sm text-danger">{importError}</p>}

              <div className="flex gap-2">
                <Button variant="herb" loading={importing} onClick={() => void handleImport()} className="flex-1">
                  Nhập {rows.length} bài tập
                </Button>
                <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
              </div>
            </div>
          )}

          {rows.length === 0 && (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
