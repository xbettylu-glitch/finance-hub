import type { DateFormat } from '../shared/types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const pad = (n: number): string => String(n).padStart(2, '0')

function toIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900
  if (m < 1 || m > 12 || d < 1) return null
  if (d > daysInMonth(y, m)) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Parses common bank date formats into YYYY-MM-DD. Numeric D/M ambiguity is resolved by `format`. */
export function parseDate(raw: string, format: DateFormat = 'auto'): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s)
  if (m && !/^\d{4}[-/.]/.test(s)) return toIso(+m[1], +m[2], +m[3])
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return toIso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const y = +m[3]
    const dmy = format === 'DMY' || (format === 'auto' && a > 12)
    return dmy ? toIso(y, b, a) : toIso(y, a, b)
  }
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase())
    return mi < 0 ? null : toIso(+m[3], mi + 1, +m[2])
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{2,4})/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase())
    return mi < 0 ? null : toIso(+m[3], mi + 1, +m[1])
  }
  return null
}

/** Guesses MDY vs DMY from a sample of numeric dates. */
export function detectDateFormat(samples: string[]): DateFormat {
  let mdy = false
  let dmy = false
  for (const s of samples) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(s.trim())
    if (!m) continue
    if (+m[1] > 12) dmy = true
    if (+m[2] > 12) mdy = true
  }
  if (dmy && !mdy) return 'DMY'
  if (mdy) return 'MDY'
  return 'auto'
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export const monthOf = (iso: string): string => iso.slice(0, 7)

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${pad(daysInMonth(y, m))}`
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

/** The `count` months ending with `lastMonth`, oldest first. */
export function monthRange(lastMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(lastMonth, i - count + 1))
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`
}
