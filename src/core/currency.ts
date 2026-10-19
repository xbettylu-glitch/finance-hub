export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'GBP', name: 'British pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' }
]

export const isCurrency = (code: string): boolean => CURRENCIES.some((c) => c.code === code)

const CANADIAN = /\b(Canada|Canadian|RBC|BMO|CIBC|Scotiabank|Tangerine|Simplii|Desjardins|Rogers\s+Bank|TD\s+Canada|Wealthsimple|EQ\s+Bank|Interac|[A-Z]\d[A-Z]\s?\d[A-Z]\d)\b/

/** Guesses a statement's currency from what is printed on it; null when nothing hints at one. */
export function detectCurrency(text: string): string | null {
  const declared = /<CURDEF>\s*([A-Z]{3})|\b([A-Z]{3})\s+(?:statement|account)\b|\bcurrency\s*:?\s*([A-Z]{3})\b/.exec(text)
  const code = declared?.[1] ?? declared?.[2] ?? declared?.[3]
  if (code && isCurrency(code)) return code
  const count = (re: RegExp): number => text.match(re)?.length ?? 0
  const scores: [string, number][] = [
    ['GBP', count(/£|\bGBP\b/g)],
    ['EUR', count(/€|\bEUR\b/g)],
    ['CAD', count(/C\$|CA\$|\bCAD\b/g)],
    ['USD', count(/US\$|\bUSD\b/g)]
  ]
  const dollars = count(/(?<![A-Z])\$/g)
  if (dollars) scores.push([CANADIAN.test(text) ? 'CAD' : 'USD', dollars])
  const best = scores.sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : null
}

/** The currency for a locale such as "en-GB"; USD when the region is unknown. */
export function currencyForLocale(locale: string): string {
  const region = locale.split(/[-_]/)[1]?.toUpperCase()
  const map: Record<string, string> = { GB: 'GBP', UK: 'GBP', CA: 'CAD', US: 'USD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', HK: 'HKD', SG: 'SGD' }
  const euro = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']
  if (region && map[region]) return map[region]
  if (region && euro.includes(region)) return 'EUR'
  return 'USD'
}

/** Units of `to` per one unit of `from`, from European Central Bank reference rates (units per 1 EUR). */
export function crossRate(perEur: Record<string, number>, from: string, to: string): number | null {
  if (from === to) return 1
  const f = from === 'EUR' ? 1 : perEur[from]
  const t = to === 'EUR' ? 1 : perEur[to]
  return f && t ? t / f : null
}
