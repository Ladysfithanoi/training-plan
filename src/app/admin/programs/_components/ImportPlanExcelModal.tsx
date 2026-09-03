'use client'

/**
 * ImportPlanExcelModal
 * ────────────────────
 * ONE importer for everything a coach can have in a spreadsheet: many buổi tập,
 * many tuần, or both at once. It replaces the two separate importers (one week
 * at a time / one whole program at a time) — the coach picks a file and the
 * modal works out what the file actually describes.
 *
 * How a file is read
 * ──────────────────
 *   • Weeks come from the sheet names ("Tuần 1", "Week 2", "W3"), or from a
 *     "Tuần" COLUMN, so a whole 4-week program can live in a single sheet.
 *   • Buổi tập come from a "Buổi tập" COLUMN, or from the sheet name when the
 *     sheet is one session ("Đẩy (Push)", "Tuần 2 - Đẩy").
 *   • Sheets that name the same week are merged, so one week can be spread over
 *     several sheets — one per buổi.
 *
 * What it writes
 * ──────────────
 *   • File covering SEVERAL weeks → the whole meso (POST /import-program):
 *     every week in the file becomes a week of the giáo án.
 *   • File covering ONE week → that week only (POST /import-week): the target
 *     week is the one named in the file, otherwise the week tab the coach is
 *     on, and it stays changeable in the modal. No other week is touched.
 *
 * When a multi-sheet file says nothing about weeks the shape is genuinely
 * ambiguous — 3 sheets could be 3 buổi of one week or 3 weeks of one buổi. The
 * modal then shows both readings and lets the coach flip between them, rather
 * than guessing silently.
 *
 * Session names are matched against the meso's existing buổi tập by label
 * (accent / case insensitive), so re-importing an updated file keeps every
 * exercise pinned where it already was. Unknown names become new day slots.
 *
 * Exercise names behave exactly like the per-buổi importer:
 *   • already in Kho bài tập → reused as-is, nothing about it is touched
 *   • not in the library     → created with ONLY its name, for the coach to
 *     complete in Thư viện afterwards
 */

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  COLUMN_ALIASES,
  buildPlan,
  cellText,
  dayLabelKey,
  normalizeHeader,
  parseBool,
  parseSheetScope,
  parseWeekCell,
  resolveColumn,
  splitRepRange,
} from '@/lib/excelImport'
import type { ParsedSheet, PlanRow, RawRow, Reading } from '@/lib/excelImport'
import { DAY_TYPE_LABELS } from '@/lib/trainingSplit'
import type { SplitDay, SplitType } from '@/lib/trainingSplit'
import { cn } from '@/lib/utils'
import type { Exercise, Phase, PhaseExercise } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Parsed {
  sheets: ParsedSheet[]
  /** Sheets that carried no usable rows, reported so nothing looks lost. */
  skipped: string[]
  /** True when a sheet name or a "Tuần" column stated a week. */
  hasWeekInfo: boolean
  /** True when a "Buổi tập" column stated a session. */
  hasDayColumn: boolean
  /** Multi-sheet file with no week info: could be weeks OR buổi — coach decides. */
  ambiguous: boolean
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface ProgramImportResult {
  added: number
  weeks: number[]
  /** Set when the DB lacks an optional column — the rows still landed. */
  droppedNote: string | null
  createdExercises: { id: string; name: string }[]
  phase: Phase | null
  exercises: (PhaseExercise & { exercise: Exercise })[]
  splitType: SplitType
  splitDays: SplitDay[]
}

export interface WeekImportResult {
  added: number
  week: number | null
  /** Set when the DB lacks an optional column — the rows still landed. */
  droppedNote: string | null
  createdExercises: { id: string; name: string }[]
  phase: Phase | null
  exercises: (PhaseExercise & { exercise: Exercise })[]
  splitType: SplitType
  splitDays: SplitDay[]
  /** How many buổi tập the file actually wrote into. */
  dayCount: number
}

/** Which of the two writes happened — the builder reacts differently to each. */
export type PlanImportResult =
  | ({ kind: 'program' } & ProgramImportResult)
  | ({ kind: 'week' }    & WeekImportResult)

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
  /** The meso's configured length — the week tabs the coach can target. */
  durationWeeks: number
  /** Week tab the coach is on: null = Gốc. Default target for a one-week file. */
  selectedWeek: number | null
  /** Buổi tập currently open — where rows land when the file names no session. */
  activeDayLabel: string | null
  onImported: (result: PlanImportResult) => void
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

export function ImportPlanExcelModal({
  open, onClose, exercises, phaseId, phaseName, splitDays, splitType,
  durationWeeks, selectedWeek, activeDayLabel, onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [parsed, setParsed]         = useState<Parsed | null>(null)
  const [fileName, setFileName]     = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewWeek, setPreviewWeek] = useState(0)

  /** Only meaningful for an ambiguous file; null = use the automatic reading. */
  const [readingOverride, setReadingOverride] = useState<Reading | null>(null)
  /** Target week for a one-week file; undefined = the automatic target. */
  const [targetOverride, setTargetOverride]   = useState<number | null | undefined>(undefined)

  const [mode, setMode]                   = useState<'replace' | 'append'>('replace')
  const [syncDuration, setSyncDuration]   = useState(true)
  const [syncFrequency, setSyncFrequency] = useState(true)

  const [importing, setImporting]     = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone]               = useState<PlanImportResult | null>(null)

  const fallbackDayLabel = activeDayLabel ?? splitDays[0]?.label ?? 'Buổi 1'

  const reading: Reading = readingOverride
    ?? (parsed?.hasWeekInfo ? 'weeks' : 'sessions')

  const plan = useMemo(
    () => parsed ? buildPlan(parsed.sheets, reading, splitDays, fallbackDayLabel) : null,
    [parsed, reading, splitDays, fallbackDayLabel],
  )

  /** More than one week in the file → the whole meso is rewritten. */
  const isProgram = (plan?.weeks.length ?? 0) > 1

  /** Where a ONE-week file lands: what the file said, else the open week tab. */
  const targetWeek: number | null = targetOverride !== undefined
    ? targetOverride
    : (plan?.weeks[0]?.week ?? selectedWeek)

  const scopeLabel = targetWeek == null ? 'bộ Gốc' : `Tuần ${targetWeek}`

  /** Lowercase library names — drives the "bài tập mới" count. */
  const libraryNames = useMemo(
    () => new Set(exercises.map(e => e.name.trim().toLowerCase())),
    [exercises],
  )

  const totalRows = plan?.weeks.reduce((n, w) => n + w.rows.length, 0) ?? 0

  const newNames = useMemo(() => {
    if (!plan) return [] as string[]
    const out = new Set<string>()
    for (const week of plan.weeks) {
      for (const row of week.rows) {
        const key = row.name.trim().toLowerCase()
        if (key && !libraryNames.has(key)) out.add(row.name.trim())
      }
    }
    return [...out]
  }, [plan, libraryNames])

  /** Sessions the meso has but a one-week file never mentions — emptied by "replace". */
  const untouchedDays = useMemo(() => {
    if (!plan || isProgram) return [] as SplitDay[]
    const keys = new Set(plan.days.map(d => d.key))
    return splitDays.filter(d => !keys.has(dayLabelKey(d.label)))
  }, [plan, isProgram, splitDays])

  function reset() {
    setParsed(null)
    setFileName(null)
    setParseError(null)
    setImportError(null)
    setDone(null)
    setPreviewWeek(0)
    setReadingOverride(null)
    setTargetOverride(undefined)
  }

  function handleClose() {
    reset()
    onClose()
  }

  /** Flipping the reading re-groups everything, so the picks derived from it go. */
  function changeReading(next: Reading) {
    setReadingOverride(next)
    setTargetOverride(undefined)
    setPreviewWeek(0)
  }

  // ── Template download ──────────────────────────────────────────────────────
  // One sheet per week, named "Tuần N", each with a "Buổi tập" column — the
  // shape that exercises both dimensions at once.
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
    xlsx.writeFile(book, 'mau-chuong-trinh-tuan-va-buoi.xlsx')
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  // Reading the file only collects rows + what each sheet NAME says; how those
  // rows group into weeks and buổi is decided later by buildPlan, so the coach
  // can flip an ambiguous file without re-picking it.
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

      const sheets: ParsedSheet[] = []
      const skipped: string[]     = []
      let hasWeekColumn = false
      let hasDayColumn  = false

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const raw   = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

        if (raw.length < 2) { skipped.push(sheetName); continue }

        const headers = (raw[0] ?? []).map(normalizeHeader)
        const nameIdx = resolveColumn(headers, COLUMN_ALIASES.name)
        if (nameIdx === -1) { skipped.push(sheetName); continue }

        const weekIdx   = resolveColumn(headers, COLUMN_ALIASES.week)
        const dayIdx    = resolveColumn(headers, COLUMN_ALIASES.day)
        const setsIdx   = resolveColumn(headers, COLUMN_ALIASES.sets)
        const repsIdx   = resolveColumn(headers, COLUMN_ALIASES.reps)
        const repMinIdx = resolveColumn(headers, COLUMN_ALIASES.repMin)
        const repMaxIdx = resolveColumn(headers, COLUMN_ALIASES.repMax)
        const rirIdx    = resolveColumn(headers, COLUMN_ALIASES.rir)
        const orderIdx  = resolveColumn(headers, COLUMN_ALIASES.order)
        const warmupIdx = resolveColumn(headers, COLUMN_ALIASES.warmup)
        const notesIdx  = resolveColumn(headers, COLUMN_ALIASES.notes)

        const scope = parseSheetScope(sheetName)
        const rows: RawRow[] = []

        /** Last non-empty cell — lets a sheet leave them blank on repeat rows. */
        let currentDay:  string | null = null
        let currentWeek: number | null = null

        for (let i = 1; i < raw.length; i++) {
          const row = raw[i] ?? []

          if (dayIdx !== -1) {
            const cell = cellText(row[dayIdx])
            if (cell) { currentDay = cell; hasDayColumn = true }
          }
          if (weekIdx !== -1) {
            const cell = parseWeekCell(row[weekIdx])
            if (cell != null) { currentWeek = cell; hasWeekColumn = true }
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
            dayCell:    currentDay,
            weekCell:   currentWeek,
          })
        }

        if (rows.length === 0) { skipped.push(sheetName); continue }

        sheets.push({
          name:          sheetName,
          sheetWeek:     scope.week,
          sheetDayLabel: scope.dayLabel,
          rows,
        })
      }

      if (sheets.length === 0) {
        setParseError(
          'Không sheet nào có cột "Tên bài tập" kèm dữ liệu. Hàng đầu tiên của mỗi sheet phải là tiêu đề cột — tải file mẫu để xem đúng định dạng.',
        )
        return
      }

      const hasWeekInfo = hasWeekColumn || sheets.some(s => s.sheetWeek != null)

      setParsed({
        sheets,
        skipped,
        hasWeekInfo,
        hasDayColumn,
        ambiguous: !hasWeekInfo && sheets.length > 1,
      })
      setPreviewWeek(0)
    } catch (err) {
      setParseError(`Lỗi đọc tệp: ${err instanceof Error ? err.message : 'Không xác định'}`)
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  function rowPayload(row: PlanRow, dayId: string) {
    return {
      day_id:         dayId,
      name:           row.name.trim(),
      target_sets:    row.sets   ? parseInt(row.sets, 10)   : 3,
      target_rep_min: row.repMin ? parseInt(row.repMin, 10) : 8,
      target_rep_max: row.repMax ? parseInt(row.repMax, 10) : 12,
      rir_target:     row.rir    ? parseInt(row.rir, 10)    : 2,
      order_label:    row.orderLabel || null,
      is_warmup:      row.isWarmup,
      notes:          row.notes || null,
    }
  }

  async function handleImport() {
    if (!plan) return
    setImporting(true)
    setImportError(null)

    const idByKey = new Map(plan.days.map(d => [d.key, d.id]))
    const resolvedSplitType = splitType ?? plan.splitType

    try {
      if (isProgram) {
        // ── Whole meso: every week of the file becomes a week of the giáo án ──
        const res = await fetch(`/api/phases/${phaseId}/import-program`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            split_type:    plan.splitType,
            split_days:    plan.days.map(d => ({ id: d.id, type: d.type, label: d.label })),
            base_week:     plan.weeks[0].week,
            set_duration:  syncDuration,
            set_frequency: syncFrequency,
            weeks: plan.weeks.map(w => ({
              week: w.week,
              rows: w.rows.map(r => rowPayload(r, idByKey.get(r.dayKey) ?? plan.days[0].id)),
            })),
          }),
        })

        const data = await res.json()
        if (!res.ok) { setImportError(data.error ?? 'Nhập thất bại'); return }

        const result: PlanImportResult = {
          kind:             'program',
          added:            data.added ?? 0,
          droppedNote:      data.dropped_note ?? null,
          weeks:            data.weeks ?? [],
          createdExercises: data.created_exercises ?? [],
          phase:            data.phase ?? null,
          exercises:        data.exercises ?? [],
          splitType:        plan.splitType,
          splitDays:        plan.days.map(d => ({ id: d.id, type: d.type, label: d.label })),
        }
        setDone(result)
        onImported(result)
        return
      }

      // ── One week: only that week's rows are rewritten ─────────────────────
      // The endpoint rewrites phases.split_days wholesale, so send the meso's
      // existing days FIRST and only append the ones the file introduces — a
      // buổi the file never mentions must keep its slot (and its exercises in
      // every other week).
      const existingIds = new Set(splitDays.map(d => d.id))
      const allDays: SplitDay[] = [
        ...splitDays,
        ...plan.days
          .filter(d => !existingIds.has(d.id))
          .map(d => ({ id: d.id, type: d.type, label: d.label })),
      ]

      const res = await fetch(`/api/phases/${phaseId}/import-week`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          week_number: targetWeek,
          split_type:  resolvedSplitType,
          split_days:  allDays.map(d => ({ id: d.id, type: d.type, label: d.label })),
          rows: (plan.weeks[0]?.rows ?? []).map(r => rowPayload(r, idByKey.get(r.dayKey) ?? allDays[0].id)),
        }),
      })

      const data = await res.json()
      if (!res.ok) { setImportError(data.error ?? 'Nhập thất bại'); return }

      const result: PlanImportResult = {
        kind:             'week',
        added:            data.added ?? 0,
        droppedNote:      data.dropped_note ?? null,
        week:             targetWeek,
        createdExercises: data.created_exercises ?? [],
        phase:            data.phase ?? null,
        exercises:        data.exercises ?? [],
        splitType:        resolvedSplitType,
        splitDays:        allDays,
        dayCount:         plan.days.length,
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
  const activeWeek = plan?.weeks[previewWeek] ?? null
  const weekOptions: (number | null)[] = [null, ...Array.from({ length: durationWeeks }, (_, i) => i + 1)]

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nhập giáo án từ Excel"
      size="lg"
    >
      {done ? (
        <div className="py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-herb/10 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-herb" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-ink">
            {done.kind === 'program' ? 'Đã tạo xong chương trình' : `Đã nhập xong ${scopeLabel}`}
          </p>
          <p className="text-sm text-ink/55">
            {done.kind === 'program'
              ? <>{done.weeks.length} tuần · {done.splitDays.length} buổi/tuần · {done.added} dòng bài tập</>
              : <>{done.dayCount} buổi tập · {done.added} dòng bài tập</>}
            {' '}đã được ghi vào <span className="font-semibold text-ink/75">{phaseName}</span>
            {done.kind === 'week' && done.week != null && ' — các tuần khác giữ nguyên'}.
          </p>
          {done.droppedNote && (
            <div className="mx-auto max-w-md rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-left">
              <p className="text-xs text-danger/90 leading-relaxed">⚠ {done.droppedNote}</p>
            </div>
          )}
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
            <span className="font-semibold text-ink">Một tệp cho cả tuần lẫn buổi.</span>{' '}
            Tuần lấy từ tên sheet (&ldquo;Tuần 1&rdquo;, &ldquo;Week 2&rdquo;) hoặc cột{' '}
            <span className="font-semibold text-ink/75">Tuần</span>; buổi lấy từ cột{' '}
            <span className="font-semibold text-ink/75">Buổi tập</span> hoặc từ tên sheet
            (&ldquo;Tuần 1 - Đẩy&rdquo;, &ldquo;Kéo (Pull)&rdquo;). Tệp nhiều tuần sẽ ghi cả giáo án{' '}
            <span className="font-semibold text-ink">{phaseName}</span>; tệp một tuần chỉ ghi vào đúng
            tuần đó.
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
            <p className="text-xs text-ink/35 mt-1">.xlsx, .xls — một tuần hay nhiều tuần đều được</p>
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
              <span className="font-medium text-ink/70">Tuần</span>,{' '}
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
          {parsed && plan && (
            <div className="space-y-4">

              {/* Ambiguous file: the coach says what the sheets mean */}
              {parsed.ambiguous && (
                <div className="rounded-xl border border-amber/30 bg-amber/6 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-amber">
                    Tệp có {parsed.sheets.length} sheet nhưng không ghi tuần — mỗi sheet là gì?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      { value: 'sessions' as const, title: 'Mỗi sheet là một BUỔI', desc: `Cả tệp là một tuần với ${parsed.sheets.length} buổi tập.` },
                      { value: 'weeks'    as const, title: 'Mỗi sheet là một TUẦN', desc: `Cả tệp là ${parsed.sheets.length} tuần tập.` },
                    ]).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => changeReading(opt.value)}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 text-left transition-all bg-white',
                          reading === opt.value ? 'border-amber bg-amber/8' : 'border-ink/12 hover:border-ink/30',
                        )}
                      >
                        <p className={cn('text-xs font-semibold', reading === opt.value ? 'text-amber' : 'text-ink')}>
                          {opt.title}
                        </p>
                        <p className="text-[11px] text-ink/50 leading-relaxed mt-0.5">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink/45 leading-relaxed">
                    Mẹo: đặt tên sheet kiểu &ldquo;Tuần 1&rdquo; / &ldquo;Tuần 1 - Đẩy&rdquo;, hoặc thêm
                    cột <span className="font-medium">Tuần</span>, thì lần sau app tự hiểu.
                  </p>
                </div>
              )}

              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Tuần', value: isProgram ? plan.weeks.length : (targetWeek == null ? 'Gốc' : targetWeek) },
                  { label: isProgram ? 'Buổi / tuần' : 'Buổi tập', value: plan.days.length },
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
                  {plan.days.map(d => (
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
                {plan.days.length === 1 && !parsed.hasDayColumn && (
                  <p className="text-[11px] text-ink/45 leading-relaxed">
                    Tệp chỉ có một buổi. Muốn nhiều buổi: thêm cột{' '}
                    <span className="font-medium">Buổi tập</span>, hoặc tách mỗi buổi thành một sheet
                    riêng đặt tên theo buổi.
                  </p>
                )}
              </div>

              {/* Week preview */}
              <div className="space-y-2">
                {plan.weeks.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {plan.weeks.map((w, i) => (
                      <button
                        key={w.week ?? 'auto'}
                        type="button"
                        onClick={() => setPreviewWeek(i)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                          i === previewWeek
                            ? 'border-amber bg-amber/10 text-amber'
                            : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
                        )}
                        title={`Sheet “${w.sheets.join(', ')}”`}
                      >
                        Tuần {w.week}
                        <span className="ml-1.5 font-normal text-ink/35">{w.rows.length}</span>
                      </button>
                    ))}
                  </div>
                )}

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
                          const day   = plan.days.find(d => d.key === row.dayKey)
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
                  {isProgram ? 'Cách ghi vào giáo án' : `Cách ghi vào ${scopeLabel}`}
                </p>

                {/* One-week file → the coach picks which week it fills. */}
                {!isProgram && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-ink/55">Ghi vào tuần</p>
                    <div className="flex flex-wrap gap-1.5">
                      {weekOptions.map(w => (
                        <button
                          key={w ?? 'base'}
                          type="button"
                          onClick={() => setTargetOverride(w)}
                          className={cn(
                            'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                            targetWeek === w
                              ? 'border-amber bg-amber/10 text-amber'
                              : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink',
                          )}
                        >
                          {w == null ? 'Gốc' : `Tuần ${w}`}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-ink/40 leading-relaxed">
                      {targetWeek == null
                        ? 'Bộ Gốc áp dụng cho mọi tuần chưa có bản riêng.'
                        : `Chỉ Tuần ${targetWeek} thay đổi — các tuần khác giữ nguyên.`}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    {
                      value: 'replace' as const,
                      title: isProgram ? 'Thay thế toàn bộ' : `Thay thế ${scopeLabel}`,
                      desc:  isProgram
                        ? 'Xoá hết bài tập đang có trong Meso rồi ghi mới theo tệp.'
                        : `Xoá bài tập đang có của ${scopeLabel} rồi ghi mới theo tệp.`,
                    },
                    { value: 'append' as const, title: 'Thêm vào', desc: 'Giữ nguyên bài tập cũ, nối tiếp bài tập từ tệp.' },
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

                {/* Meso-level parameters only make sense for a multi-week file. */}
                {isProgram && (
                  <>
                    <label className="flex items-start gap-2 text-xs text-ink/65 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncDuration}
                        onChange={e => setSyncDuration(e.target.checked)}
                        className="accent-amber mt-0.5"
                      />
                      <span>
                        Đặt độ dài Meso = {plan.weeks[plan.weeks.length - 1].week} tuần
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
                      <span>Đặt số buổi/tuần = {plan.days.length}</span>
                    </label>
                  </>
                )}
              </div>

              {mode === 'replace' && isProgram && (
                <p className="text-[11px] text-danger/80 leading-relaxed">
                  ⚠ &ldquo;Thay thế toàn bộ&rdquo; sẽ xoá mọi bài tập hiện có của Meso{' '}
                  <span className="font-semibold">{phaseName}</span> — kể cả các tuần đã tùy chỉnh riêng.
                </p>
              )}
              {mode === 'replace' && !isProgram && untouchedDays.length > 0 && (
                <p className="text-[11px] text-danger/80 leading-relaxed">
                  ⚠ Tệp không có {untouchedDays.map(d => `“${d.label}”`).join(', ')} — buổi đó sẽ trống
                  ở {scopeLabel}. Chọn &ldquo;Thêm vào&rdquo; nếu muốn giữ nguyên.
                </p>
              )}

              {importError && <p className="text-sm text-danger">{importError}</p>}

              <div className="flex gap-2">
                <Button variant="herb" loading={importing} onClick={() => void handleImport()} className="flex-1">
                  {isProgram
                    ? `Tạo ${plan.weeks.length} tuần tập`
                    : `Nhập ${plan.days.length} buổi vào ${scopeLabel}`}
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
