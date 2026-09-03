'use client'

/**
 * ImportWeekExcelModal
 * ────────────────────
 * Fills EVERY buổi tập of ONE week from a single workbook.
 *
 * The gap it closes: the per-day importer takes one session at a time, and the
 * whole-program importer rewrites every week of the meso. A coach who has this
 * week's sessions in a spreadsheet wants neither — they want the week filled in
 * one go, with the other weeks left untouched.
 *
 * Two file shapes are accepted, both common in the wild:
 *
 *   1. ONE sheet with a "Buổi tập" column — each distinct value is a session:
 *        Buổi tập      | Tên bài tập        | Số hiệp | Reps | …
 *        Đẩy (Push)    | Barbell Bench Press| 4       | 6-8  |
 *        Kéo (Pull)    | Pull Up            | 4       | 6-10 |
 *
 *   2. ONE SHEET PER SESSION — the sheet name is the session label
 *      ("Đẩy (Push)", "Kéo (Pull)", "Chân (Legs)"). A sheet named after a week
 *      too ("Tuần 2 - Đẩy") keeps only the session part.
 *
 * Session names are matched against the meso's existing buổi tập by label
 * (accent / case insensitive), so re-importing an updated file keeps every
 * exercise pinned where it already was. Unknown names become new day slots,
 * appended to the split — days the file does not mention keep their slot.
 *
 * Exercise names behave exactly like the other importers:
 *   • already in Kho bài tập → reused as-is, nothing about it is touched
 *   • not in the library     → created with ONLY its name, for the coach to
 *     complete in Thư viện afterwards
 *
 * Storage (migration 011): rows are written with week_number = the week being
 * imported (NULL for "Gốc"), so no other week of the meso is affected.
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
  parseSheetScope,
  resolveColumn,
  splitRepRange,
} from '@/lib/excelImport'
import { DAY_TYPE_LABELS } from '@/lib/trainingSplit'
import type { DayType, SplitDay, SplitType } from '@/lib/trainingSplit'
import { cn } from '@/lib/utils'
import type { Exercise, Phase, PhaseExercise } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekRow {
  name: string
  sets: string
  repMin: string
  repMax: string
  rir: string
  orderLabel: string
  isWarmup: boolean
  notes: string
  /** Session name exactly as written in the sheet (or in the sheet's name). */
  dayLabel: string
  /** dayLabelKey(dayLabel) — links the row to a ParsedDay. */
  dayKey: string
}

interface ParsedDay {
  key: string
  /** Label as written in the file (or the meso's own label when matched). */
  label: string
  type: DayType
  /** Existing SplitDay.id when matched, otherwise a fresh UUID. */
  id: string
  /** True when this session does not exist in the meso yet. */
  isNew: boolean
  rows: WeekRow[]
}

interface Parsed {
  days: ParsedDay[]
  /** Sheets that carried no usable rows, reported so nothing looks lost. */
  skipped: string[]
  /** True when no sheet had a "Buổi tập" column and the file is one sheet. */
  singleDayFallback: boolean
}

export interface WeekImportResult {
  added: number
  week: number | null
  createdExercises: { id: string; name: string }[]
  phase: Phase | null
  exercises: (PhaseExercise & { exercise: Exercise })[]
  splitType: SplitType
  splitDays: SplitDay[]
  /** How many buổi tập the file actually wrote into. */
  dayCount: number
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
  /** The meso's split type; kept as-is when it already has one. */
  splitType: SplitType | null
  /** Week scope being filled: null = Gốc, 1..N = that week's own program. */
  weekNumber: number | null
  onImported: (result: WeekImportResult) => void
}

// ─── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'Buổi tập', 'Tên bài tập', 'Số hiệp', 'Reps', 'RIR', 'STT', 'Khởi động', 'Ghi chú',
]

const TEMPLATE_ROWS: (string | number)[][] = [
  ['Đẩy (Push)',  'Barbell Bench Press',     4, '6-8',   2, 'A', '',  ''],
  ['Đẩy (Push)',  'Incline Dumbbell Press',  3, '8-12',  2, 'B', '',  ''],
  ['Đẩy (Push)',  'Cable Fly',               3, '12-15', 1, 'C', '',  ''],
  ['Kéo (Pull)',  'Pull Up',                 4, '6-10',  2, 'A', '',  ''],
  ['Kéo (Pull)',  'Barbell Row',             3, '8-12',  2, 'B', '',  ''],
  ['Kéo (Pull)',  'Face Pull',               3, '15-20', 1, 'C', '',  ''],
  ['Chân (Legs)', 'Barbell Back Squat',      4, '5-8',   2, 'A', '',  'Giữ lưng trung tính'],
  ['Chân (Legs)', 'Romanian Deadlift',       3, '8-12',  2, 'B', '',  ''],
  ['Chân (Legs)', 'Seated Leg Curl',         3, '12-15', 1, 'C', '',  ''],
]

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportWeekExcelModal({
  open, onClose, exercises, phaseId, phaseName, splitDays, splitType, weekNumber, onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [parsed, setParsed]         = useState<Parsed | null>(null)
  const [fileName, setFileName]     = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewDay, setPreviewDay] = useState(0)

  const [mode, setMode]             = useState<'replace' | 'append'>('replace')

  const [importing, setImporting]   = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone]             = useState<WeekImportResult | null>(null)

  /** "Gốc" / "Tuần 3" — used in every label so the target is never ambiguous. */
  const scopeLabel = weekNumber == null ? 'bộ Gốc' : `Tuần ${weekNumber}`

  /** Lowercase library names — drives the "bài tập mới" count. */
  const libraryNames = useMemo(
    () => new Set(exercises.map(e => e.name.trim().toLowerCase())),
    [exercises],
  )

  const totalRows = parsed?.days.reduce((n, d) => n + d.rows.length, 0) ?? 0

  const newNames = useMemo(() => {
    if (!parsed) return [] as string[]
    const out = new Set<string>()
    for (const day of parsed.days) {
      for (const row of day.rows) {
        const key = row.name.trim().toLowerCase()
        if (key && !libraryNames.has(key)) out.add(row.name.trim())
      }
    }
    return [...out]
  }, [parsed, libraryNames])

  /** Sessions the meso has but the file never mentions — emptied by "replace". */
  const untouchedDays = useMemo(() => {
    if (!parsed) return [] as SplitDay[]
    const keys = new Set(parsed.days.map(d => d.key))
    return splitDays.filter(d => !keys.has(dayLabelKey(d.label)))
  }, [parsed, splitDays])

  function reset() {
    setParsed(null)
    setFileName(null)
    setParseError(null)
    setImportError(null)
    setDone(null)
    setPreviewDay(0)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Template download ──────────────────────────────────────────────────────
  // One sheet, one "Buổi tập" column — the simplest shape this modal reads back.
  async function downloadTemplate() {
    const xlsx  = await import('xlsx')
    const sheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS])
    sheet['!cols'] = [
      { wch: 16 }, { wch: 30 }, { wch: 9 }, { wch: 10 },
      { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 28 },
    ]
    const book = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(book, sheet, weekNumber == null ? 'Gốc' : `Tuần ${weekNumber}`)
    xlsx.writeFile(book, 'mau-mot-tuan-nhieu-buoi.xlsx')
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

      const rows: WeekRow[]   = []
      const skipped: string[] = []
      let sawDayColumn = false

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

        // Which session this sheet's rows belong to when no "Buổi tập" cell says
        // otherwise: the sheet's own name ("Đẩy (Push)", "Tuần 2 - Đẩy"), else —
        // for a lone unnamed sheet — the meso's first buổi, so the rows merge
        // into it instead of creating a duplicate session beside it.
        const sheetLabel = parseSheetScope(sheetName).dayLabel
        const fallbackLabel = sheetLabel
          ?? (workbook.SheetNames.length === 1
            ? (splitDays[0]?.label ?? 'Buổi 1')
            : `Buổi ${sheetIdx + 1}`)

        /** Last non-empty day cell — lets a sheet leave it blank on repeat rows. */
        let currentLabel = fallbackLabel
        let sheetRowCount = 0

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
          sheetRowCount++
        }

        if (sheetRowCount === 0) skipped.push(sheetName)
      })

      if (rows.length === 0) {
        setParseError(
          'Không sheet nào có cột "Tên bài tập" kèm dữ liệu. Hàng đầu tiên của mỗi sheet phải là tiêu đề cột — tải file mẫu để xem đúng định dạng.',
        )
        return
      }

      // ── Resolve the day slots ────────────────────────────────────────────────
      // Order of first appearance, so the buổi read in the order the coach wrote
      // them. A label the meso already has keeps that day's id (and its label),
      // which is what pins the other weeks' exercises where they are.
      const existingByKey = new Map(splitDays.map(d => [dayLabelKey(d.label), d]))
      const days: ParsedDay[] = []
      const byKey = new Map<string, ParsedDay>()

      for (const row of rows) {
        let day = byKey.get(row.dayKey)
        if (!day) {
          const existing = existingByKey.get(row.dayKey)
          day = existing
            ? { key: row.dayKey, label: existing.label, type: existing.type as DayType, id: existing.id, isNew: false, rows: [] }
            : { key: row.dayKey, label: row.dayLabel, type: inferDayType(row.dayLabel), id: crypto.randomUUID(), isNew: true, rows: [] }
          byKey.set(row.dayKey, day)
          days.push(day)
        }
        day.rows.push(row)
      }

      setParsed({
        days,
        skipped,
        singleDayFallback: !sawDayColumn && days.length === 1,
      })
      setPreviewDay(0)
    } catch (err) {
      setParseError(`Lỗi đọc tệp: ${err instanceof Error ? err.message : 'Không xác định'}`)
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    setImportError(null)

    // The phase's split_days is rewritten wholesale by the endpoint, so send the
    // meso's existing days FIRST and only append the ones the file introduces —
    // a buổi the file never mentions must keep its slot (and its exercises in
    // every other week).
    const existingIds = new Set(splitDays.map(d => d.id))
    const allDays: SplitDay[] = [
      ...splitDays,
      ...parsed.days
        .filter(d => !existingIds.has(d.id))
        .map(d => ({ id: d.id, type: d.type, label: d.label })),
    ]

    try {
      const res = await fetch(`/api/phases/${phaseId}/import-week`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          week_number: weekNumber,
          split_type:  splitType ?? inferSplitType(allDays.map(d => d.type)),
          split_days:  allDays.map(d => ({ id: d.id, type: d.type, label: d.label })),
          rows: parsed.days.flatMap(day => day.rows.map(r => ({
            day_id:         day.id,
            name:           r.name.trim(),
            target_sets:    r.sets   ? parseInt(r.sets, 10)   : 3,
            target_rep_min: r.repMin ? parseInt(r.repMin, 10) : 8,
            target_rep_max: r.repMax ? parseInt(r.repMax, 10) : 12,
            rir_target:     r.rir    ? parseInt(r.rir, 10)    : 2,
            order_label:    r.orderLabel || null,
            is_warmup:      r.isWarmup,
            notes:          r.notes || null,
          }))),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setImportError(data.error ?? 'Nhập thất bại')
        return
      }

      const result: WeekImportResult = {
        added:            data.added ?? 0,
        week:             weekNumber,
        createdExercises: data.created_exercises ?? [],
        phase:            data.phase ?? null,
        exercises:        data.exercises ?? [],
        splitType:        splitType ?? inferSplitType(allDays.map(d => d.type)),
        splitDays:        allDays,
        dayCount:         parsed.days.length,
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
  const activeDay = parsed?.days[previewDay] ?? null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Nhập tất cả buổi tập của ${scopeLabel} từ Excel`}
      size="lg"
    >
      {done ? (
        <div className="py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-herb/10 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-ink">Đã nhập xong {scopeLabel}</p>
          <p className="text-sm text-ink/55">
            {done.dayCount} buổi tập · {done.added} dòng bài tập đã được ghi vào{' '}
            <span className="font-semibold text-ink/75">{phaseName}</span>
            {weekNumber != null && ' — các tuần khác giữ nguyên'}.
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
            <span className="font-semibold text-ink">Một tệp = tất cả buổi tập của {scopeLabel}.</span>{' '}
            Dùng cột <span className="font-semibold text-ink/75">Buổi tập</span> để chia các dòng thành
            từng buổi, hoặc để <span className="font-semibold text-ink/75">mỗi sheet là một buổi</span>{' '}
            (tên sheet = tên buổi). Chỉ {scopeLabel} của giáo án{' '}
            <span className="font-semibold text-ink">{phaseName}</span> bị ảnh hưởng.
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
            <p className="text-xs text-ink/35 mt-1">.xlsx, .xls — nhiều buổi trong một tuần</p>
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
                Chưa có file? Tải mẫu 3 buổi trong một tuần về rồi điền vào
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
                  { label: 'Tuần', value: weekNumber == null ? 'Gốc' : weekNumber },
                  { label: 'Buổi tập', value: parsed.days.length },
                  { label: 'Dòng bài tập', value: totalRows },
                ].map(tile => (
                  <div key={tile.label} className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-center">
                    <p className="text-xl font-bold text-ink tabular-nums leading-none">{tile.value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink/40 mt-1">{tile.label}</p>
                  </div>
                ))}
              </div>

              {/* Day slots resolved from the file */}
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
                    Tệp chỉ có một buổi. Thêm cột <span className="font-medium">Buổi tập</span>, hoặc tách
                    mỗi buổi thành một sheet riêng, để nhập nhiều buổi trong một lần.
                  </p>
                )}
              </div>

              {/* Per-session preview */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {parsed.days.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setPreviewDay(i)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                        i === previewDay
                          ? 'border-amber bg-amber/10 text-amber'
                          : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
                      )}
                    >
                      {d.label}
                      <span className="ml-1.5 font-normal text-ink/35">{d.rows.length}</span>
                    </button>
                  ))}
                </div>

                {activeDay && (
                  <div className="overflow-auto max-h-64 rounded-xl border border-ink/8 bg-white">
                    <table className="w-full text-xs min-w-[460px]">
                      <thead className="border-b border-ink/8 sticky top-0 bg-white z-10">
                        <tr className="text-ink/40 uppercase tracking-wide">
                          <th className="text-left px-3 py-2 w-10">STT</th>
                          <th className="text-left px-3 py-2">Bài tập</th>
                          <th className="text-left px-3 py-2 w-14">Hiệp</th>
                          <th className="text-left px-3 py-2 w-20">Reps</th>
                          <th className="text-left px-3 py-2 w-12">RIR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink/5">
                        {activeDay.rows.map((row, i) => {
                          const isNew = !!row.name.trim() && !libraryNames.has(row.name.trim().toLowerCase())
                          return (
                            <tr key={i} className="hover:bg-ink/2">
                              <td className="px-3 py-1.5 font-mono text-ink/45">
                                {row.orderLabel || String.fromCharCode(65 + (i % 26))}
                              </td>
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
                  Cách ghi vào {scopeLabel}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { value: 'replace' as const, title: `Thay thế ${scopeLabel}`, desc: `Xoá bài tập đang có của ${scopeLabel} rồi ghi mới theo tệp.` },
                    { value: 'append'  as const, title: 'Thêm vào',               desc: 'Giữ nguyên bài tập cũ, nối tiếp bài tập từ tệp.' },
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
              </div>

              {mode === 'replace' && untouchedDays.length > 0 && (
                <p className="text-[11px] text-danger/80 leading-relaxed">
                  ⚠ Tệp không có {untouchedDays.map(d => `“${d.label}”`).join(', ')} — buổi đó sẽ trống
                  ở {scopeLabel}. Chọn &ldquo;Thêm vào&rdquo; nếu muốn giữ nguyên.
                </p>
              )}

              {importError && <p className="text-sm text-danger">{importError}</p>}

              <div className="flex gap-2">
                <Button variant="herb" loading={importing} onClick={() => void handleImport()} className="flex-1">
                  Nhập {parsed.days.length} buổi vào {scopeLabel}
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
