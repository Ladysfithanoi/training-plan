/**
 * Shared spreadsheet-reading helpers for the Excel importers.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no React, no Supabase. `xlsx` itself is loaded
 * lazily by the callers so it never lands in the initial bundle.
 *
 *   • ImportScheduleExcelModal — one sheet → one training day of one week
 *   • ImportWeekExcelModal     — one workbook → every buổi tập of ONE week
 *   • ImportProgramExcelModal  → the whole meso (many weeks × many buổi)
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
  /** Groups a week sheet's rows into training days (whole-program import). */
  day:      ['buoi', 'buoi tap', 'ten buoi', 'ngay', 'ngay tap', 'day', 'session', 'workout'],
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

  return { week: null, dayLabel: GENERIC_SHEET.test(foldChars(raw)) ? null : raw }
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
