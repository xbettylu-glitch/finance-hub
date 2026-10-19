const RATES_URL = 'https://api.frankfurter.dev/v1/latest'

/** Downloads the European Central Bank's daily reference rates (units per 1 EUR). Only the request itself is sent. */
export async function fetchEcbRates(): Promise<{ date: string; perEur: Record<string, number> }> {
  const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Exchange rate service returned ${res.status}`)
  const body = (await res.json()) as { base?: string; date?: string; rates?: Record<string, number> }
  if (body.base !== 'EUR' || !body.date || !body.rates) throw new Error('Unexpected response from the exchange rate service')
  return { date: body.date, perEur: body.rates }
}
