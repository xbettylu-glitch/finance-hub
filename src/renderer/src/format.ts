import { monthLabel } from '../../core/dates'

let displayCurrency = 'USD'
/** The home currency, used when `money` isn't given one. */
export const setDisplayCurrency = (code: string): void => {
  displayCurrency = code
}
export const getDisplayCurrency = (): string => displayCurrency

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(currency: string, style: 'full' | 'whole' | 'compact'): Intl.NumberFormat {
  const key = `${currency}|${style}`
  let f = formatters.get(key)
  if (!f) {
    const opts: Intl.NumberFormatOptions = { style: 'currency', currency }
    if (style === 'whole') Object.assign(opts, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    if (style === 'compact') Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1 })
    f = new Intl.NumberFormat(undefined, opts)
    formatters.set(key, f)
  }
  return f
}

export function money(cents: number, opts: { whole?: boolean; sign?: boolean; compact?: boolean; currency?: string } = {}): string {
  const fmt = formatter(opts.currency ?? displayCurrency, opts.compact ? 'compact' : opts.whole ? 'whole' : 'full')
  const s = fmt.format(cents / 100)
  return opts.sign && cents > 0 ? `+${s}` : s
}

export const pct = (x: number): string => `${(x * 100).toFixed(0)}%`

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export const shortMonth = (month: string): string => {
  const [m, y] = monthLabel(month).split(' ')
  return `${m} '${y.slice(2)}`
}

export { monthLabel }

/** "1,234.56" -> cents; returns null if invalid. */
export function centsFromInput(raw: string): number | null {
  const cleaned = raw.replace(/[$£€,\s]/g, '')
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return null
  return Math.round(Number(cleaned) * 100)
}

export const inputFromCents = (cents: number): string => (cents / 100).toFixed(2)
