'use client'

/**
 * ImportProgramExcelModal
 * ───────────────────────
 * Fills a WHOLE meso from one workbook: **each sheet is a training week**, and
 * a "Buổi tập" column inside a sheet splits its rows into training days.
 *
 * A 4-sheet file therefore becomes 4 weeks in the app automatically — the coach
 * never has to click "Tùy chỉnh tuần này" four times and paste each session by
 * hand. Week numbers are read from the sheet names ("Tuần 1", "Week 1", "W1",
 * or plain "1"); a sheet whose name says nothing about a week falls back to its
 * position in the workbook.
 *
 * Day slots are matched against the meso's existing buổi tập by label (accent /
 * case insensitive), so re-importing an updated file keeps every exercise pinned
 * where it already was. Unknown session names become brand-new day slots.
 *
 * Exercise names behave exactly like the single-day importer:
 *   • already in Kho bài tập → reused as-is, nothing about it is touched
 *   • not in the library     → created with ONLY its name, for the coach to
 *     complete in Thư viện afterwards
 *
 * Storage (migration 011): week W's rows are written with week_number = W, and
 * the first imported week is duplicated into the base (Gốc) scope so a meso
 * longer than the file still resolves to a sensible program.
 */

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  COLUMN_ALIASES,
  cellText,
  dayLabelKey,
  inferDayType,
  inferSplitType,
  normalizeHeader,
  parseBool,
  parseWeekFromSheetName,
  resolveColumn,
  splitRepRange,
} from '@/lib/excelImport'
import { DAY_TYPE_LABELS } from '@/lib/trainingSplit'
import type { DayType, SplitDay, SplitType } from '@/lib/trainingSplit'
import { cn } from '@/lib/utils'
import type { Exercise, Phase, PhaseExercise } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgramRow {
  name: string
  sets: string
  repMin: string
  repMax: string
  rir: string
  orderLabel: string
  isWarmup: boolean
  notes: string
  /** Session name exactly as written in the sheet. */
  dayLabel: string
  /** dayLabelKey(dayLabel) — links the row to a ParsedDay. */
  dayKey: string
}

interface ParsedWeek {
  week: number
  sheetName: string
  rows: ProgramRow[]
}

interface ParsedDay {
  key: string
  /** Label as written in the sheet (or the meso's own label when matched). */
  label: string
  type: DayType
  /** Existing SplitDay.id when matched, otherwise a fresh UUID. */
  id: string
  /** True when this session does not exist in the meso yet. */
  isNew: boolean
}

interface Parsed {
  weeks: ParsedWeek[]
  days: ParsedDay[]
  splitType: SplitType
  /** Sheets that carried no usable rows, reported so nothing looks lost. */
  skipped: string[]
  /** True when no sheet had a "Buổi tập" column — everything became one day. */
  singleDayFallback: boolean
}

export interface ProgramImportResult {
  added: number
  weeks: number[]
  createdExercises: { id: string; name: string }[]
  phase: Phase | null
  exercises: (PhaseExercise & { exercise: Exercise })[]
  splitType: SplitType
  splitDays: SplitDay[]
}

interface Props {
  open: boolean
  onClose: () => void
  /** Current library — decides which sheet names are flagged as new. */
  exercises: Exercise[]
  phaseId: string
  phaseName: string
  /** The meso's current day slots — imported sessions are matched against these. */
  splitDays: SplitDay[]
  /** The meso's configured length, shown next to the sheet count. */
  durationWeeks: number
  onImported: (result: ProgramImportResult) => void
}

// ─── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'Buổi tập', 'Tên bài tập', 'Số hiệp', 'Reps', 'RIR', 'STT', 'Khởi động', 'Ghi chú',
]

/** Sets/reps drift week to week so the template shows what per-week editing is for. */
function templateRows(week: number): (string | number)[][] {
  const sets = 2 + week
  return [
    ['Đẩy (Push)', 'Barbell Bench Press',   sets, '6-8',   2, 'A', '',  ''],
    ['Đẩy (Push)', 'Incline Dumbbell Press', 3,   '8-12',  2, 'B', '',  ''],
    ['Đẩy (Push)', 'Cable Fly',              3,   '12-15', 1, 'C', '',  ''],
    ['Kéo (Pull)', 'Pull Up',               sets, '6-10',  2, 'A', '',  ''],
    ['Kéo (Pull)', 'Barbell Row',            3,   '8-12',  2, 'B', '',  ''],
    ['Kéo (Pull)', 'Face Pull',              3,   '15-20', 1, 'C', '',  ''],
    ['Chân (Legs)', 'Barbell Back Squat',   sets, '5-8',   2, 'A', '',  'Giữ lưng trung tính'],
    ['Chân (Legs)', 'Romanian Deadlift',     3,   '8-12',  2, 'B', '',  ''],
    ['Chân (Legs)', 'Seated Leg Curl',       3,   '12-15', 1, 'C', '',  ''],
  ]
}

const TEMPLATE_WEEKS = 4

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportProgramExcelModal({
  open, onClose, exercises, phaseId, phaseName, splitDays, durationWeeks, onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [parsed, setParsed]         = useState<Parsed | null>(null)
  const [fileName, setFileName]     = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewWeek, setPreviewWeek] = useState(0)

  const [mode, setMode]                 = useState<'replace' | 'append'>('replace')
  const [syncDuration, setSyncDuration] = useState(true)
  const [syncFrequency, setSyncFrequency] = useState(true)

  const [importing, setImporting]   = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone]             = useState<ProgramImportResult | null>(null)

  /** Lowercase library names — drives the "bài tập mới" count. */
  const libraryNames = useMemo(
    () => new Set(exercises.map(e => e.name.trim().toLowerCase())),
    [exercises],
  )

  const totalRows = parsed?.weeks.reduce((n, w) => n + w.rows.length, 0) ?? 0

  const newNames = useMemo(() => {
    if (!parsed) return [] as string[]
    const out = new Set<string>()
    for (const week of parsed.weeks) {
      for (const row of week.rows) {
        const key = row.name.trim().toLowerCase()
        if (key && !libraryNames.has(key)) out.add(row.name.trim())
      }
    }
    return [...out]
  }, [parsed, libraryNames])

  function reset() {
    setParsed(null)
    setFileName(null)
    setParseError(null)
    setImportError(null)
    setDone(null)
    setPreviewWeek(0)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Template download ──────────────────────────────────────────────────────
  // One sheet per week, named "Tuần N" — the exact shape this modal reads back.
  async function downloadTemplate() {
    const xlsx = await import('xlsx')
    const book = xlsx.utils.book_new()
    for (let w = 1; w <= TEMPLATE_WEEKS; w++) {
      const sheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...templateRows(w)])
      sheet['!cols'] = [
        { wch: 16 }, { wch: 30 }, { wch: 9 }, { wch: 10 },
        { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 28 },
      ]
      xlsx.utils.book_append_sheet(book, sheet, `Tuần ${w}`)
    }
    xlsx.writeFile(book, 'mau-chuong-trinh-nhieu-tuan.xlsx')
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    reset()
    setFileName(file.name)

    try {
      const xlsx     = await import('xlsx')
      const buffer   = await file.arrayBuffer()
      const workbook = xlsx.read(buffer, { type: 'array' })

      if (workbook.SheetNames.length === 0) {
        setParseError('Tệp không có sheet nào.')
        return
      }

      const weeks: ParsedWeek[] = []
      const skipped: string[]   = []
      /** Week numbers already claimed, so two sheets never collide. */
      const usedWeeks = new Set<number>()
      let sawDayColumn = false

      // First pass: honour every sheet name that explicitly states its week, so
      // a workbook ordered 3,1,2 still lands on the right weeks.
      const sheetWeeks = workbook.SheetNames.map(name => parseWeekFromSheetName(name))
      for (const w of sheetWeeks) {
        if (w != null && !usedWeeks.has(w)) usedWeeks.add(w)
      }
      /** Next free week number for a sheet that didn't name one. */
      let nextFreeWeek = 1
      function claimWeek(): number {
        while (usedWeeks.has(nextFreeWeek)) nextFreeWeek++
        usedWeeks.add(nextFreeWeek)
        return nextFreeWeek
      }
      /** Weeks actually handed out — guards two sheets both called "Tuần 1". */
      const assignedWeeks = new Set<number>()

      workbook.SheetNames.forEach((sheetName, sheetIdx) => {
        const sheet = workbook.Sheets[sheetName]
        const raw   = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

        if (raw.length < 2) { skipped.push(sheetName); return }

        const headers = (raw[0] ?? []).map(normalizeHeader)
        const nameIdx = resolveColumn(headers, COLUMN_ALIASES.name)
        if (nameIdx === -1) { skipped.push(sheetName); return }

        const dayIdx    = resolveColumn(headers, COLUMN_ALIASES.day)
        const setsIdx   = resolveColumn(headers, COLUMN_ALIASES.sets)
        const repsIdx   = resolveColumn(headers, COLUMN_ALIASES.reps)
        const repMinIdx = resolveColumn(headers, COLUMN_ALIASES.repMin)
        const repMaxIdx = resolveColumn(headers, COLUMN_ALIASES.repMax)
        const rirIdx    = resolveColumn(headers, COLUMN_ALIASES.rir)
        const orderIdx  = resolveColumn(headers, COLUMN_ALIASES.order)
        const warmupIdx = resolveColumn(headers, COLUMN_ALIASES.warmup)
        const notesIdx  = resolveColumn(headers, COLUMN_ALIASES.notes)

        if (dayIdx !== -1) sawDayColumn = true

        // No "Buổi tập" column → the whole sheet is one session. Reuse the meso's
        // first day label when it has one so the import merges instead of adding
        // a duplicate session next to it.
        const fallbackLabel = splitDays[0]?.label ?? 'Buổi 1'

        const rows: ProgramRow[] = []
        /** Last non-empty day cell — lets a sheet leave it blank on repeat rows. */
        let currentLabel = fallbackLabel

        for (let i = 1; i < raw.length; i++) {
          const row = raw[i] ?? []

          if (dayIdx !== -1) {
            const cell = cellText(row[dayIdx])
            if (cell) currentLabel = cell
          }

          const name = cellText(row[nameIdx])
          if (!name) continue

          // Separate min/max columns win; otherwise fall back to a "8-12" cell.
          let repMin = repMinIdx !== -1 ? cellText(row[repMinIdx]) : ''
          let repMax = repMaxIdx !== -1 ? cellText(row[repMaxIdx]) : ''
          if ((!repMin || !repMax) && repsIdx !== -1) {
            const range = splitRepRange(row[repsIdx])
            if (range) { repMin = repMin || range.min; repMax = repMax || range.max }
          }

          rows.push({
            name,
            sets:       setsIdx   !== -1 ? cellText(row[setsIdx]) : '',
            repMin:     repMin    || '8',
            repMax:     repMax    || '12',
            rir:        rirIdx    !== -1 ? cellText(row[rirIdx])  : '',
            orderLabel: orderIdx  !== -1 ? cellText(row[orderIdx]).toUpperCase() : '',
            isWarmup:   warmupIdx !== -1 ? parseBool(row[warmupIdx]) : false,
            notes:      notesIdx  !== -1 ? cellText(row[notesIdx]) : '',
            dayLabel:   currentLabel,
            dayKey:     dayLabelKey(currentLabel),
          })
        }

        if (rows.length === 0) { skipped.push(sheetName); return }

        const named = sheetWeeks[sheetIdx]
        const week  = (named != null && !assignedWeeks.has(named)) ? named : claimWeek()
        assignedWeeks.add(week)
        weeks.push({ week, sheetName, rows })
      })

      if (weeks.length === 0) {
        setParseError(
          'Không sheet nào có cột "Tên bài tập" kèm dữ liệu. Hàng đầu tiên của mỗi sheet phải là tiêu đề cột — tải file mẫu để xem đúng định dạng.',
        )
        return
      }

      weeks.sort((a, b) => a.week - b.week)

      // ── Resolve the day slots ────────────────────────────────────────────────
      // Order of first appearance across the weeks, so the split reads in the
      // same order the coach wrote the sheet.
      const existingByKey = new Map(splitDays.map(d => [dayLabelKey(d.label), d]))
      const days: ParsedDay[] = []
      const seenKeys = new Set<string>()

      for (const week of weeks) {
        for (const row of week.rows) {
          if (seenKeys.has(row.dayKey)) continue
          seenKeys.add(row.dayKey)

          const existing = existingByKey.get(row.dayKey)
          // A matched day keeps the meso's own label (its exercises stay pinned);
          // a new one keeps the label exactly as typed in the sheet.
          days.push(existing
            ? { key: row.dayKey, label: existing.label, type: existing.type as DayType, id: existing.id, isNew: false }
            : { key: row.dayKey, label: row.dayLabel, type: inferDayType(row.dayLabel), id: crypto.randomUUID(), isNew: true },
          )
        }
      }

      setParsed({
        weeks,
        days,
        splitType: inferSplitType(days.map(d => d.type)),
        skipped,
        singleDayFallback: !sawDayColumn,
      })
      setPreviewWeek(0)
    } catch (err) {
      setParseError(`Lỗi đọc tệp: ${err instanceof Error ? err.message : 'Không xác định'}`)
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    setImportError(null)

    const idByKey = new Map(parsed.days.map(d => [d.key, d.id]))

    try {
      const res = await fetch(`/api/phases/${phaseId}/import-program`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          split_type:    parsed.splitType,
          split_days:    parsed.days.map(d => ({ id: d.id, type: d.type, label: d.label })),
          base_week:     parsed.weeks[0].week,
          set_duration:  syncDuration,
          set_frequency: syncFrequency,
          weeks: parsed.weeks.map(w => ({
            week: w.week,
            rows: w.rows.map(r => ({
              day_id:         idByKey.get(r.dayKey) ?? null,
              name:           r.name.trim(),
              target_sets:    r.sets   ? parseInt(r.sets, 10)   : 3,
              target_rep_min: r.repMin ? parseInt(r.repMin, 10) : 8,
              target_rep_max: r.repMax ? parseInt(r.repMax, 10) : 12,
              rir_target:     r.rir    ? parseInt(r.rir, 10)    : 2,
              order_label:    r.orderLabel || null,
              is_warmup:      r.isWarmup,
              notes:          r.notes || null,
            })),
          })),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setImportError(data.error ?? 'Nhập thất bại')
        return
      }

      const result: ProgramImportResult = {
        added:            data.added ?? 0,
        weeks:            data.weeks ?? [],
        createdExercises: data.created_exercises ?? [],
        phase:            data.phase ?? null,
        exercises:        data.exercises ?? [],
        splitType:        parsed.splitType,
        splitDays:        parsed.days.map(d => ({ id: d.id, type: d.type, label: d.label })),
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
  const activeWeek = parsed?.weeks[previewWeek] ?? null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nhập cả chương trình nhiều tuần từ Excel"
      size="lg"
    >
      {done ? (
        <div className="py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-herb/10 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-ink">Đã tạo xong chương trình</p>
          <p className="text-sm text-ink/55">
            {done.weeks.length} tuần · {done.splitDays.length} buổi/tuần · {done.added} dòng bài tập
            đã được ghi vào <span className="font-semibold text-ink/75">{phaseName}</span>.
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

          {/* ── How it works ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-ink/10 bg-ink/3 px-4 py-3 text-xs text-ink/60 leading-relaxed">
            <span className="font-semibold text-ink">Mỗi sheet = một tuần tập.</span>{' '}
            Tên sheet (&ldquo;Tuần 1&rdquo;, &ldquo;Week 2&rdquo;, &ldquo;W3&rdquo;) quyết định số tuần;
            cột <span className="font-semibold text-ink/75">Buổi tập</span> trong sheet chia các dòng
            thành từng buổi. Toàn bộ sẽ được ghi vào giáo án{' '}
            <span className="font-semibold text-ink">{phaseName}</span>.
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
            <p className="text-xs text-ink/35 mt-1">.xlsx, .xls — mỗi sheet là một tuần</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
          </div>

          {/* ── Template + column hint ─────────────────────────────────────── */}
          <div className="rounded-xl bg-amber/6 border border-amber/15 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-semibold text-amber">
                Chưa có file? Tải mẫu {TEMPLATE_WEEKS} tuần × 3 buổi về rồi điền vào
              </p>
              <Button size="sm" variant="secondary" onClick={() => void downloadTemplate()}>
                ⬇ Tải file mẫu
              </Button>
            </div>
            <p className="text-[11px] text-ink/55 leading-relaxed">
              Cột nhận dạng được (không phân biệt hoa/thường, có dấu hay không):{' '}
              <span className="font-medium text-ink/70">Buổi tập</span>,{' '}
              <span className="font-medium text-ink/70">Tên bài tập</span> (bắt buộc), Số hiệp,
              Reps (&ldquo;8-12&rdquo;) hoặc Rep min / Rep max, RIR, STT, Khởi động, Ghi chú.
            </p>
            <p className="text-[11px] text-ink/45 leading-relaxed">
              Buổi trùng tên với buổi đã có trong giáo án sẽ được dùng lại; tên mới sẽ tạo thêm buổi.
              Tên bài đã có trong Kho bài tập được dùng lại nguyên trạng, tên chưa có sẽ được thêm
              vào Kho — <span className="font-medium">chỉ mỗi tên</span>.
            </p>
          </div>

          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {/* ── Preview ────────────────────────────────────────────────────── */}
          {parsed && (
            <div className="space-y-4">

              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Tuần', value: parsed.weeks.length },
                  { label: 'Buổi / tuần', value: parsed.days.length },
                  { label: 'Dòng bài tập', value: totalRows },
                ].map(tile => (
                  <div key={tile.label} className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-center">
                    <p className="text-xl font-bold text-ink tabular-nums leading-none">{tile.value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink/40 mt-1">{tile.label}</p>
                  </div>
                ))}
              </div>

              {/* Day slots resolved from the sheet */}
              <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink/40">
                  Buổi tập trong tệp
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.days.map(d => (
                    <span
                      key={d.id}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                        d.isNew
                          ? 'border-amber/40 bg-amber/8 text-amber'
                          : 'border-herb/35 bg-herb/8 text-herb',
                      )}
                    >
                      {d.label}
                      <span className="text-ink/35 font-normal">{DAY_TYPE_LABELS[d.type]}</span>
                      {d.isNew && (
                        <span className="rounded-full bg-amber/20 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none">
                          mới
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                {parsed.singleDayFallback && (
                  <p className="text-[11px] text-ink/45 leading-relaxed">
                    Tệp không có cột <span className="font-medium">Buổi tập</span> — mỗi sheet được coi là
                    một buổi duy nhất. Thêm cột đó nếu một tuần có nhiều buổi.
                  </p>
                )}
              </div>

              {/* Week preview */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {parsed.weeks.map((w, i) => (
                    <button
                      key={w.week}
                      type="button"
                      onClick={() => setPreviewWeek(i)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                        i === previewWeek
                          ? 'border-amber bg-amber/10 text-amber'
                          : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
                      )}
                      title={`Sheet “${w.sheetName}”`}
                    >
                      Tuần {w.week}
                      <span className="ml-1.5 font-normal text-ink/35">{w.rows.length}</span>
                    </button>
                  ))}
                </div>

                {activeWeek && (
                  <div className="overflow-auto max-h-64 rounded-xl border border-ink/8 bg-white">
                    <table className="w-full text-xs min-w-[520px]">
                      <thead className="border-b border-ink/8 sticky top-0 bg-white z-10">
                        <tr className="text-ink/40 uppercase tracking-wide">
                          <th className="text-left px-3 py-2">Buổi</th>
                          <th className="text-left px-3 py-2">Bài tập</th>
                          <th className="text-left px-3 py-2 w-14">Hiệp</th>
                          <th className="text-left px-3 py-2 w-20">Reps</th>
                          <th className="text-left px-3 py-2 w-12">RIR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink/5">
                        {activeWeek.rows.map((row, i) => {
                          const day   = parsed.days.find(d => d.key === row.dayKey)
                          const isNew = !!row.name.trim() && !libraryNames.has(row.name.trim().toLowerCase())
                          return (
                            <tr key={i} className="hover:bg-ink/2">
                              <td className="px-3 py-1.5 text-ink/50">{day?.label ?? '—'}</td>
                              <td className="px-3 py-1.5">
                                <span className="text-ink">{row.name}</span>
                                {isNew && (
                                  <span className="ml-1.5 rounded-full bg-amber/15 text-amber border border-amber/30 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none">
                                    mới
                                  </span>
                                )}
                                {row.isWarmup && (
                                  <span className="ml-1.5 text-[9px] uppercase font-bold text-ink/35">k.động</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 tabular-nums text-ink/60">{row.sets || '3'}</td>
                              <td className="px-3 py-1.5 tabular-nums text-ink/60">{row.repMin}–{row.repMax}</td>
                              <td className="px-3 py-1.5 tabular-nums text-ink/60">{row.rir || '2'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Warnings */}
              {newNames.length > 0 && (
                <p className="text-xs text-amber font-medium">
                  {newNames.length} bài tập mới sẽ được thêm vào Kho bài tập
                </p>
              )}
              {parsed.skipped.length > 0 && (
                <p className="text-[11px] text-ink/45">
                  Bỏ qua {parsed.skipped.length} sheet không có dữ liệu hợp lệ: {parsed.skipped.join(', ')}.
                </p>
              )}

              {/* ── Options ─────────────────────────────────────────────────── */}
              <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink/40">
                  Cách ghi vào giáo án
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { value: 'replace' as const, title: 'Thay thế toàn bộ', desc: 'Xoá hết bài tập đang có trong Meso rồi ghi mới theo tệp.' },
                    { value: 'append'  as const, title: 'Thêm vào',          desc: 'Giữ nguyên bài tập cũ, nối tiếp bài tập từ tệp.' },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMode(opt.value)}
                      className={cn(
                        'rounded-xl border px-3 py-2.5 text-left transition-all',
                        mode === opt.value
                          ? 'border-amber bg-amber/8'
                          : 'border-ink/12 hover:border-ink/30',
                      )}
                    >
                      <p className={cn('text-xs font-semibold', mode === opt.value ? 'text-amber' : 'text-ink')}>
                        {opt.title}
                      </p>
                      <p className="text-[11px] text-ink/50 leading-relaxed mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                <label className="flex items-start gap-2 text-xs text-ink/65 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncDuration}
                    onChange={e => setSyncDuration(e.target.checked)}
                    className="accent-amber mt-0.5"
                  />
                  <span>
                    Đặt độ dài Meso = {parsed.weeks[parsed.weeks.length - 1].week} tuần
                    <span className="text-ink/40"> (hiện tại {durationWeeks} tuần)</span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-ink/65 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncFrequency}
                    onChange={e => setSyncFrequency(e.target.checked)}
                    className="accent-amber mt-0.5"
                  />
                  <span>Đặt số buổi/tuần = {parsed.days.length}</span>
                </label>
              </div>

              {mode === 'replace' && (
                <p className="text-[11px] text-danger/80 leading-relaxed">
                  ⚠ &ldquo;Thay thế toàn bộ&rdquo; sẽ xoá mọi bài tập hiện có của Meso{' '}
                  <span className="font-semibold">{phaseName}</span> — kể cả các tuần đã tùy chỉnh riêng.
                </p>
              )}

              {importError && <p className="text-sm text-danger">{importError}</p>}

              <div className="flex gap-2">
                <Button variant="herb" loading={importing} onClick={() => void handleImport()} className="flex-1">
                  Tạo {parsed.weeks.length} tuần tập
                </Button>
                <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
              </div>
            </div>
          )}

          {!parsed && (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
