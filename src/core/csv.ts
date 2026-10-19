import Papa from 'papaparse'
import type { ColumnMapping, DateFormat, ImportOptions, ParsedStatement, ParsedTransaction } from '../shared/types'
import { detectDateFormat, parseDate } from './dates'
import { parseAmount } from './money'

const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const DATE_HEADERS = ['transaction date', 'trans date', 'date', 'posted date', 'posting date', 'post date', 'settlement date', 'trade date', 'run date', 'value date']
const DESC_HEADERS = ['description', 'payee', 'merchant', 'merchant name', 'name', 'transaction description', 'original description', 'details', 'narrative', 'memo', 'reference', 'action']
const AMOUNT_HEADERS = ['amount', 'transaction amount', 'amount usd', 'net amount', 'value', 'amount cad', 'amount eur', 'amount gbp']
const DEBIT_HEADERS = ['debit', 'debits', 'withdrawal', 'withdrawals', 'debit amount', 'money out', 'paid out', 'outflow', 'charges']
const CREDIT_HEADERS = ['credit', 'credits', 'deposit', 'deposits', 'credit amount', 'money in', 'paid in', 'inflow', 'payments']
const BALANCE_HEADERS = ['balance', 'running balance', 'running bal', 'account balance', 'ledger balance']
const TYPE_HEADERS = ['type', 'transaction type', 'credit debit indicator', 'debit credit', 'dr cr']

function findHeader(headers: string[], candidates: string[], taken: Set<number>): number | undefined {
  const normalized = headers.map(norm)
  for (const c of candidates) {
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h === c)
    if (i >= 0) return i
  }
  for (const c of candidates) {
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h.includes(c))
    if (i >= 0) return i
  }
  return undefined
}

export function detectMapping(headers: string[]): ColumnMapping | null {
  const taken = new Set<number>()
  const pick = (c: string[]): number | undefined => {
    const i = findHeader(headers, c, taken)
    if (i !== undefined) taken.add(i)
    return i
  }
  const date = pick(DATE_HEADERS)
  const amount = pick(AMOUNT_HEADERS)
  const debit = amount === undefined ? pick(DEBIT_HEADERS) : undefined
  const credit = amount === undefined ? pick(CREDIT_HEADERS) : undefined
  const balance = pick(BALANCE_HEADERS)
  const type = pick(TYPE_HEADERS)
  const description = pick(DESC_HEADERS)
  if (date === undefined || description === undefined) return null
  if (amount === undefined && debit === undefined && credit === undefined) return null
  return { date, description, amount, debit, credit, balance, type }
}

/** For header-less exports: infer columns from cell contents. */
function inferMappingFromContent(rows: string[][]): ColumnMapping | null {
  const width = Math.max(...rows.map((r) => r.length))
  const sample = rows.slice(0, 50)
  const share = (col: number, test: (v: string) => boolean): number =>
    sample.filter((r) => r[col] !== undefined && r[col].trim() !== '' && test(r[col])).length / sample.length
  let date: number | undefined
  let amount: number | undefined
  let description: number | undefined
  let bestLen = 0
  for (let c = 0; c < width; c++) {
    if (date === undefined && share(c, (v) => parseDate(v) !== null) > 0.8) {
      date = c
      continue
    }
    if (amount === undefined && share(c, (v) => /^[\s$€£(+-]*[\d,]+(\.\d+)?\)?\s*$/.test(v)) > 0.8) {
      amount = c
      continue
    }
    const avgLen = sample.reduce((s, r) => s + (r[c]?.length ?? 0), 0) / sample.length
    if (avgLen > bestLen && share(c, (v) => /[a-z]/i.test(v)) > 0.5) {
      bestLen = avgLen
      description = c
    }
  }
  if (date === undefined || amount === undefined || description === undefined) return null
  return { date, amount, description }
}

function isHeaderRow(row: string[]): boolean {
  return detectMapping(row) !== null
}

function cell(row: string[], idx: number | undefined): string {
  return idx === undefined ? '' : (row[idx] ?? '').trim()
}

export function parseCsv(text: string, options: ImportOptions = {}): ParsedStatement {
  const errors: string[] = []
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' })
  const all = parsed.data.filter((r) => r.some((c) => c.trim() !== ''))
  if (all.length === 0) return { format: 'csv', transactions: [], skippedRows: 0, errors: ['The file is empty.'] }

  const headerIdx = all.slice(0, 30).findIndex(isHeaderRow)
  let headers: string[]
  let rows: string[][]
  if (headerIdx >= 0) {
    headers = all[headerIdx].map((h) => h.trim())
    rows = all.slice(headerIdx + 1)
  } else {
    const width = Math.max(...all.map((r) => r.length))
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
    rows = all
  }

  const mapping = options.mapping ?? (headerIdx >= 0 ? detectMapping(headers) : inferMappingFromContent(rows))
  if (!mapping) {
    return {
      format: 'csv',
      transactions: [],
      headers,
      skippedRows: rows.length,
      errors: ['Could not detect the date, description and amount columns. Please map them manually.']
    }
  }

  const dateFormat: DateFormat =
    options.dateFormat && options.dateFormat !== 'auto' ? options.dateFormat : resolveDateFormat(detectDateFormat(rows.map((r) => cell(r, mapping.date))), options.dayFirst)

  const amounts = rows.map((r) => {
    if (mapping.amount !== undefined) return parseAmount(cell(r, mapping.amount))
    const debit = parseAmount(cell(r, mapping.debit))
    const credit = parseAmount(cell(r, mapping.credit))
    if (debit == null && credit == null) return null
    return (credit ?? 0) - Math.abs(debit ?? 0)
  })
  const unsigned = mapping.amount !== undefined && amounts.every((a) => a == null || a >= 0)
  const useTypeColumn =
    unsigned && mapping.type !== undefined && rows.some((r) => /debit|withdraw|^dr$/i.test(cell(r, mapping.type)))

  const transactions: ParsedTransaction[] = []
  const balances: { date: string; balance: number; order: number }[] = []
  let skippedRows = 0
  rows.forEach((r, i) => {
    const date = parseDate(cell(r, mapping.date), dateFormat)
    let amount = amounts[i]
    if (!date || amount == null) {
      skippedRows++
      return
    }
    if (useTypeColumn && /debit|withdraw|^dr$/i.test(cell(r, mapping.type))) amount = -Math.abs(amount)
    if (options.invertAmounts) amount = -amount
    const description = cell(r, mapping.description) || 'Unknown'
    transactions.push({ date, amount, description })
    const bal = parseAmount(cell(r, mapping.balance))
    if (mapping.balance !== undefined && bal != null) balances.push({ date, balance: bal, order: i })
  })
  if (skippedRows > 0) errors.push(`${skippedRows} row(s) skipped because the date or amount could not be read.`)

  let ledgerBalance: ParsedStatement['ledgerBalance']
  if (balances.length > 0) {
    const descending = transactions.length > 1 && transactions[0].date > transactions[transactions.length - 1].date
    const maxDate = balances.reduce((m, b) => (b.date > m ? b.date : m), balances[0].date)
    const onMax = balances.filter((b) => b.date === maxDate)
    const pick = descending ? onMax[0] : onMax[onMax.length - 1]
    ledgerBalance = { date: pick.date, balance: options.invertAmounts ? -pick.balance : pick.balance }
  }

  return { format: 'csv', transactions, headers, mapping, dateFormat, ledgerBalance, skippedRows, errors }
}

/** Ambiguous files get one consistent order, so 05/10 and 13/10 aren't read in different orders. */
function resolveDateFormat(detected: DateFormat, dayFirst: boolean | undefined): DateFormat {
  if (detected !== 'auto') return detected
  return dayFirst ? 'DMY' : 'MDY'
}
