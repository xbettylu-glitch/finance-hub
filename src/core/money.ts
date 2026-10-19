/** Parses a bank-formatted amount ("$1,234.56", "(12.00)", "-5", "12.30 CR", "1.234,56") into cents. */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  const suffix = /\s*(CR|DR|-)$/i.exec(s)
  if (suffix) {
    if (suffix[1].toUpperCase() !== 'CR') negative = !negative
    s = s.slice(0, suffix.index)
  }
  s = s.replace(/[^\d.,+-]/g, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (/,\d{1,2}$/.test(s) && (!s.includes('.') || s.lastIndexOf('.') < s.lastIndexOf(','))) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null
  const cents = Math.round(Number(s) * 100)
  if (!Number.isFinite(cents)) return null
  return negative ? -cents : cents
}
