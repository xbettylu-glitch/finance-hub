import { monthLabel } from '../../core/dates'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

export function money(cents: number, opts: { whole?: boolean; sign?: boolean; compact?: boolean } = {}): string {
  const fmt = opts.compact ? usdCompact : opts.whole ? usdWhole : usd
  const s = fmt.format(cents / 100)
  return opts.sign && cents > 0 ? `+${s}` : s
}

export const pct = (x: number): string => `${(x * 100).toFixed(0)}%`

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const shortMonth = (month: string): string => {
  const [m, y] = monthLabel(month).split(' ')
  return `${m} '${y.slice(2)}`
}

export { monthLabel }

/** "1,234.56" -> cents; returns null if invalid. */
export function centsFromInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return null
  return Math.round(Number(cleaned) * 100)
}

export const inputFromCents = (cents: number): string => (cents / 100).toFixed(2)
