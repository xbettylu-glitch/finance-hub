import type { ParsedTransaction } from '../shared/types'

/**
 * Stable per-account fingerprints so re-importing the same or an overlapping statement does not
 * create duplicates. Identical rows on the same day (two $5 coffees) get an occurrence index.
 */
export function fingerprintAll(accountId: number, txns: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>()
  return txns.map((t) => {
    if (t.fitId) return `${accountId}|fit|${t.fitId}`
    const base = `${accountId}|${t.date}|${t.amount}|${t.description.toLowerCase().replace(/\s+/g, ' ').trim()}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}|${n}`
  })
}
