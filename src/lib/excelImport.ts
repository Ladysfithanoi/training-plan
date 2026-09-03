/**
 * Shared spreadsheet-reading helpers for the Excel importers.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no React, no Supabase. `xlsx` itself is loaded
 * lazily by the callers so it never lands in the initial bundle.
 *
 *   • ImportScheduleExcelModal — one sheet → one training day of one week
 *   • ImportPlanExcelModal     — one workbook → weeks × buổi tập, whatever the
 *     file happens to describe (one week of many buổi, or a whole meso)
 *
 * Both accept the same messy real-world input: Vietnamese or English headers,
 * with or without accents, any capitalisation, "8-12" rep ranges or separate
 * min/max columns.
 */

import type { DayType, SplitType } from './trainingSplit'

// ─── Header normalisation ─────────────────────────────────────────────────────

/** Strip accents + collapse whitespace so "Tên bài tập" ≈ "ten bai tap". */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export const COLUMN_ALIASES = {
  name:     ['ten bai tap', 'bai tap', 'ten', 'name', 'exercise', 'exercise name'],
  sets:     ['so hiep', 'hiep', 'set', 'sets', 'so set'],
  reps:     ['reps', 'rep', 'so rep', 'vung rep', 'reps muc tieu'],
  repMin:   ['rep min', 'reps min', 'rep toi thieu', 'min reps', 'rep tu'],
  repMax:   ['rep max', 'reps max', 'rep toi da', 'max reps', 'rep den'],
  rir:      ['rir', 'rir muc tieu', 'rir target'],
  order:    ['stt', 'thu tu', 'order', 'order label', 'ma stt'],
  warmup:   ['khoi dong', 'bai khoi dong', 'warmup', 'warm up'],
  notes:    ['ghi chu', 'notes', 'note', 'luu y'],
  /** Groups a sheet's rows into training days (buổi tập). */
  day:      ['buoi', 'buoi tap', 'ten buoi', 'ngay', 'ngay tap', 'day', 'session', 'workout'],
  /** Groups rows into weeks — lets ONE sheet carry a whole multi-week program. */
  week:     ['tuan', 'tuan tap', 'tuan so', 'so tuan', 'week', 'week number', 'wk'],
} as const

/** Index of the first header matching any alias, or -1. */
export function resolveColumn(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias)
    if (idx !== -1) return idx
  }
  return -1
}

// ─── Cell coercion ────────────────────────────────────────────────────────────

/** "8-12", "8 – 12", "8 to 12" → { min: '8', max: '12' }; "10" → both 10. */
export function splitRepRange(raw: unknown): { min: string; max: string } | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const parts = text.split(/[-–—~]|\bto\b|\bđến\b/i).map(p => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const a = parseInt(parts[0], 10)
    const b = parseInt(parts[1], 10)
    if (Number.isFinite(a) && Number.isFinite(b)) return { min: String(a), max: String(b) }
  }
  const single = parseInt(text, 10)
  if (Number.isFinite(single)) return { min: String(single), max: String(single) }
  return null
}

const TRUTHY = ['x', 'v', 'co', 'yes', 'y', 'true', '1', 'warmup', 'khoi dong']

export function parseBool(raw: unknown): boolean {
  return TRUTHY.includes(normalizeHeader(raw))
}

/** Cells come back as numbers or strings depending on the sheet — normalise. */
export function cellText(raw: unknown): string {
  if (raw == null) return ''
  return String(raw).trim()
}

// ─── Week / day inference (whole-program import) ───────────────────────────────

/**
 * Week number carried by a sheet name: "Tuần 3", "Week 3", "W3", "T3", "3".
 * Returns null when the name says nothing about a week — the caller then falls
 * back to the sheet's position in the workbook.
 */
export function parseWeekFromSheetName(name: string): number | null {
  const text = normalizeHeader(name)
  const explicit = text.match(/(?:tuan|week|wk|w|t)\s*[-._]?\s*(\d{1,2})\b/)
  if (explicit) {
    const n = parseInt(explicit[1], 10)
    if (n >= 1 && n <= 52) return n
  }
  const bare = text.match(/^(\d{1,2})$/)
  if (bare) {
    const n = parseInt(bare[1], 10)
    if (n >= 1 && n <= 52) return n
  }
  return null
}

/**
 * Week number carried by a CELL of a "Tuần" column: 2, "2", "Tuần 2", "W2".
 * Same grammar as a sheet name, so both spellings of a week agree.
 */
export function parseWeekCell(raw: unknown): number | null {
  const text = cellText(raw)
  if (!text) return null
  return parseWeekFromSheetName(text)
}

/**
 * Accent-folded copy of a string with the SAME length as the original, so a
 * regex match on the folded text can slice the original by index. (normalize()
 * alone shifts indices: "ầ" decomposes into two code points.)
 */
function foldChars(text: string): string {
  return [...text]
    .map(ch => ch.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .map(ch => (ch === 'đ' || ch === 'Đ' ? 'd' : ch))
    .join('')
    .toLowerCase()
}

/** Sheet names that carry no meaning — "Sheet1", "Trang 2", "Tab3". */
const GENERIC_SHEET = /^(sheet|trang|tab|worksheet)\s*\d*$/

/** "Tuần 2 - Đẩy" → week 2 + label "Đẩy"; the week token may be absent. */
const WEEK_PREFIX = /^\s*(?:tuan|week|wk|w|t)?\s*[-._#]?\s*(\d{1,2})\s*(?:[-–—:._|/]+\s*)?/

/**
 * Everything a sheet NAME says about where its rows belong: which week, and —
 * when the name carries one — which session ("Tuần 2 - Đẩy", "W2 Pull",
 * "Chân (Legs)"). Lets one workbook hold a sheet per session of a week
 * instead of being forced into one sheet per week.
 *
 * dayLabel is null when the name is only a week ("Tuần 2") or is a generic
 * spreadsheet name ("Sheet1") — the caller then picks its own fallback.
 */
export function parseSheetScope(name: string): { week: number | null; dayLabel: string | null } {
  const raw = String(name ?? '').trim()
  if (!raw) return { week: null, dayLabel: null }

  // A default spreadsheet name states nothing at all. It must be caught first:
  // "Sheet1" would otherwise read as week 1 (the "t1" inside it), and a stray
  // week would drag the import onto a week the coach never asked for.
  if (GENERIC_SHEET.test(foldChars(raw))) return { week: null, dayLabel: null }

  const match = foldChars(raw).match(WEEK_PREFIX)
  if (match) {
    const n = parseInt(match[1], 10)
    if (n >= 1 && n <= 52) {
      const rest = raw.slice(match[0].length).trim()
      return { week: n, dayLabel: rest || null }
    }
  }

  // No leading week token — the week may still hide inside the name ("Push W1"),
  // in which case the name is about the week, not about a session.
  const week = parseWeekFromSheetName(raw)
  if (week != null) return { week, dayLabel: null }

  return { week: null, dayLabel: raw }
}

/**
 * Guess a DayType from a session label so an imported day lands in the right
 * movement-pattern filter ("Đẩy A" → push). Unknown labels become 'other',
 * which shows every pattern — never wrong, just unfiltered.
 */
export function inferDayType(label: string): DayType {
  const t = normalizeHeader(label)
  // "Day 1" / "Ngày 2" / "Buổi 3" are pure numbering, not a movement category.
  // They must be caught first because "day" is also how "Đẩy" normalises.
  if (/^(day|ngay|buoi|session)\s*\d*$/.test(t)) return 'other'
  if (/\b(toan than|fullbody|full body)\b/.test(t)) return 'fullbody'
  if (/\b(than tren|upper|tren)\b/.test(t))        return 'upper'
  if (/\b(than duoi|lower|duoi)\b/.test(t))        return 'lower'
  if (/\b(day|push|nguc|chest)\b/.test(t))         return 'push'
  if (/\b(keo|pull|lung|back)\b/.test(t))          return 'pull'
  if (/\b(chan|leg|legs|mong|glute|quad)\b/.test(t)) return 'legs'
  return 'other'
}

/**
 * Pick the split type that matches a set of day types. Anything that isn't a
 * clean PPL or Upper/Lower rotation is treated as fullbody, whose day list is
 * fully coach-editable anyway.
 */
export function inferSplitType(dayTypes: DayType[]): SplitType {
  const set = new Set(dayTypes)
  if (set.size === 0) return 'fullbody'
  const isPpl = [...set].every(t => t === 'push' || t === 'pull' || t === 'legs')
  if (isPpl) return 'ppl'
  const isUL = [...set].every(t => t === 'upper' || t === 'lower')
  if (isUL) return 'upper_lower'
  return 'fullbody'
}

/** Match key for a session label — accent/case/space insensitive. */
export function dayLabelKey(label: string): string {
  return normalizeHeader(label)
}

// ─── Plan building (tuần × buổi) ──────────────────────────────────────────────

/** A spreadsheet row, before weeks/buổi are resolved against the file's shape. */
export interface RawRow {
  name: string
  sets: string
  repMin: string
  repMax: string
  rir: string
  orderLabel: string
  isWarmup: boolean
  notes: string
  /** Value of the "Buổi tập" column (carried forward on blank cells). */
  dayCell: string | null
  /** Value of the "Tuần" column (carried forward on blank cells). */
  weekCell: number | null
}

export interface ParsedSheet {
  name: string
  /** Week the sheet NAME states, if any. */
  sheetWeek: number | null
  /** Session the sheet NAME states, if any. */
  sheetDayLabel: string | null
  rows: RawRow[]
}

export interface PlanRow extends RawRow {
  /** Session name this row ended up in. */
  dayLabel: string
  dayKey: string
}

export interface PlanWeek {
  /** null = the file never said which week — the caller picks the target. */
  week: number | null
  /** Sheets that fed this week, for the preview tooltip. */
  sheets: string[]
  rows: PlanRow[]
}

export interface PlanDay {
  key: string
  /** Label as written in the file (or the meso's own label when matched). */
  label: string
  type: DayType
  /** Existing SplitDay.id when matched, otherwise a fresh UUID. */
  id: string
  /** True when this session does not exist in the meso yet. */
  isNew: boolean
}

export interface Plan {
  weeks: PlanWeek[]
  days: PlanDay[]
  splitType: SplitType
}

/** How a file that says nothing about weeks should be read. */
export type Reading = 'weeks' | 'sessions'

/**
 * Turn the sheets of a workbook into weeks × buổi tập under one reading of the
 * file. A multi-sheet file with no week information is genuinely ambiguous —
 * 3 sheets could be 3 buổi of one week or 3 weeks of one buổi — so the reading
 * is an argument, not a guess made in here.
 *
 * Cheap and pure, so the UI can rebuild the whole plan the instant a coach
 * flips that reading.
 */
export function buildPlan(
  sheets: ParsedSheet[],
  reading: Reading,
  existingDays: { id: string; type: DayType; label: string }[],
  fallbackDayLabel: string,
): Plan {
  // Week numbers already spoken for, so a sheet that names none never steals one.
  const usedWeeks = new Set<number>()
  if (reading === 'weeks') {
    for (const sheet of sheets) {
      if (sheet.sheetWeek != null) usedWeeks.add(sheet.sheetWeek)
      for (const row of sheet.rows) if (row.weekCell != null) usedWeeks.add(row.weekCell)
    }
  }
  let nextFreeWeek = 1
  function claimWeek(): number {
    while (usedWeeks.has(nextFreeWeek)) nextFreeWeek++
    usedWeeks.add(nextFreeWeek)
    return nextFreeWeek
  }

  const weeks: PlanWeek[] = []
  const weekByNumber = new Map<number, PlanWeek>()
  /** The "file never said which week" bucket — at most one. */
  let unscoped: PlanWeek | null = null

  sheets.forEach((sheet, sheetIdx) => {
    // Under the "sessions" reading the whole file is one week, so a sheet is a
    // buổi tập and never claims a week number.
    const sheetWeek = reading === 'weeks' ? (sheet.sheetWeek ?? claimWeek()) : null

    // Where this sheet's rows land when no "Buổi tập" cell says otherwise: the
    // sheet's own name, else its position (several sheets = several buổi), else
    // the buổi the coach has open — so a plain one-session file merges into it.
    const sheetDayFallback = sheet.sheetDayLabel
      ?? (reading === 'sessions' && sheets.length > 1 ? `Buổi ${sheetIdx + 1}` : fallbackDayLabel)

    for (const row of sheet.rows) {
      const week  = reading === 'weeks' ? (row.weekCell ?? sheetWeek) : null
      const label = row.dayCell ?? sheetDayFallback

      let bucket: PlanWeek
      if (week == null) {
        if (!unscoped) {
          unscoped = { week: null, sheets: [], rows: [] }
          weeks.push(unscoped)
        }
        bucket = unscoped
      } else {
        const found = weekByNumber.get(week)
        if (found) {
          bucket = found
        } else {
          bucket = { week, sheets: [], rows: [] }
          weekByNumber.set(week, bucket)
          weeks.push(bucket)
        }
      }

      if (!bucket.sheets.includes(sheet.name)) bucket.sheets.push(sheet.name)
      bucket.rows.push({ ...row, dayLabel: label, dayKey: dayLabelKey(label) })
    }
  })

  weeks.sort((a, b) => (a.week ?? 0) - (b.week ?? 0))

  // ── Resolve the day slots ──────────────────────────────────────────────────
  // Order of first appearance across the weeks, so the split reads in the same
  // order the coach wrote the file. A label the meso already has keeps that
  // day's id — which is what pins the other weeks' exercises where they are.
  const existingByKey = new Map(existingDays.map(d => [dayLabelKey(d.label), d]))
  const days: PlanDay[] = []
  const seenKeys = new Set<string>()

  for (const week of weeks) {
    for (const row of week.rows) {
      if (seenKeys.has(row.dayKey)) continue
      seenKeys.add(row.dayKey)
      const existing = existingByKey.get(row.dayKey)
      days.push(existing
        ? { key: row.dayKey, label: existing.label, type: existing.type, id: existing.id, isNew: false }
        : { key: row.dayKey, label: row.dayLabel, type: inferDayType(row.dayLabel), id: crypto.randomUUID(), isNew: true },
      )
    }
  }

  return { weeks, days, splitType: inferSplitType(days.map(d => d.type)) }
}
