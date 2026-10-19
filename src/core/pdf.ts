import type { AccountType, DateFormat, ImportOptions, ParsedStatement, ParsedTransaction } from '../shared/types'
import { parseDate } from './dates'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?'

const LEADING_DATE: { re: RegExp; parse: (m: RegExpExecArray, dmy: boolean) => { y?: number; m: number; d: number } }[] = [
  { re: /^(\d{4})-(\d{2})-(\d{2})\b/, parse: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  {
    re: /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?![\d/.-])/,
    parse: (m, dmy) => ({ y: m[3] ? +m[3] : undefined, m: dmy ? +m[2] : +m[1], d: dmy ? +m[1] : +m[2] })
  },
  {
    re: new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    parse: (m) => ({ y: m[3] ? +m[3] : undefined, m: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, d: +m[2] })
  },
  {
    re: new RegExp(`^(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, 'i'),
    parse: (m) => ({ y: m[3] ? +m[3] : undefined, m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: +m[1] })
  }
]

const AMOUNT_TOKEN = String.raw`(?:[-+]\s?)?\(?\$?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:\s?(?:CR|DR|-))?`
const TRAILING_AMOUNT = new RegExp(String.raw`(?:^|\s)(${AMOUNT_TOKEN})\s*$`, 'i')
const FULL_DATE = new RegExp(String.raw`\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|${MONTH_RE}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+${MONTH_RE}\s+\d{4})\b`, 'gi')

const OPENING = /^(beginning|opening|previous|starting|prior)\s+balance\b/i
const CLOSING = /^(ending|closing|new)\s+balance\b|^(statement|current)\s+balance\b|^balance\s+(on|as\s+of)\b/i
const SKIP_DESCRIPTION = /^(total|subtotal|sub-total)\b|^(daily|average)\s+(ending\s+)?balance/i

const CREDIT_SECTION =
  /^(deposits?|credits?|additions|other credits|deposits?\s+(and|&)\s+(other\s+)?(additions|credits)|payments?(,|\s+and|\s+&)?\s+(other\s+)?credits|interest\s+(earned|paid))\b/i
const DEBIT_SECTION =
  /^(withdrawals?|debits?|checks?(\s+paid)?|electronic\s+(withdrawals|payments|debits)|atm\b|atm\s+(&|and)\s+debit|(debit\s+)?card\s+(purchases|transactions)|purchases?|fees?(\s+charged)?|interest\s+charged|other\s+(withdrawals|debits)|service\s+(charges|fees)|purchases?\s+(and|&)\s+adjustments)\b/i
const IGNORE_SECTION = /^(daily\s+(ending\s+)?balance|balance\s+summary|daily\s+balance\s+summary)/i

const INSTITUTIONS = [
  'American Express',
  'Bank of America',
  'Wells Fargo',
  'Capital One',
  'Charles Schwab',
  'Goldman Sachs',
  'Navy Federal',
  'U.S. Bank',
  'US Bank',
  'Citibank',
  'Citi',
  'Chase',
  'Discover',
  'Ally',
  'PNC',
  'TD Bank',
  'Truist',
  'Fidelity',
  'Vanguard',
  'SoFi',
  'Marcus',
  'Barclays',
  'Synchrony',
  'HSBC',
  'USAA'
]

interface Candidate {
  date: { y?: number; m: number; d: number }
  description: string
  amountToken: string
  balance: number | null
  section: number
}

function amountValue(token: string): { cents: number; explicitNegative: boolean; explicitCredit: boolean } {
  const t = token.replace(/\s+/g, '')
  const explicitCredit = /CR$/i.test(t)
  const explicitNegative = /^-|^\(|\)$|-$|DR$|^\$?-/i.test(t.replace(/CR$/i, ''))
  const digits = t.replace(/[^\d.]/g, '')
  return { cents: Math.round(Number(digits) * 100), explicitNegative, explicitCredit }
}

function balanceValue(token: string): number {
  const v = amountValue(token)
  return v.explicitNegative ? -v.cents : v.cents
}

function leadingDate(line: string, dmy: boolean): { date: Candidate['date']; rest: string } | null {
  for (const { re, parse } of LEADING_DATE) {
    const m = re.exec(line)
    if (!m) continue
    const date = parse(m, dmy)
    if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31) return null
    return { date, rest: line.slice(m[0].length).trim() }
  }
  return null
}

function detectDmy(lines: string[], format: DateFormat | undefined): boolean {
  if (format === 'DMY') return true
  if (format === 'MDY' || format === 'YMD') return false
  let dmy = false
  for (const line of lines) {
    const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?(?![\d/.-])/.exec(line)
    if (!m) continue
    if (+m[2] > 12) return false
    if (+m[1] > 12) dmy = true
  }
  return dmy
}

/** The statement's closing date, used to give year-less dates (e.g. "01/05") a year. */
function referenceDate(lines: string[], format: DateFormat): string | null {
  let best: string | null = null
  let fallback: string | null = null
  for (const line of lines) {
    const dates = [...line.matchAll(FULL_DATE)].map((m) => parseDate(m[1], format)).filter((d): d is string => d !== null)
    if (!dates.length) continue
    const max = dates.sort().at(-1)!
    if (/clos|period|through|statement\s+date|ending|\bto\b|\s-\s/i.test(line) && (!best || max > best)) best = max
    if (!fallback || max > fallback) fallback = max
  }
  return best ?? fallback
}

function resolveDate(date: Candidate['date'], ref: string | null): string | null {
  let year = date.y
  if (year === undefined) {
    const refYear = ref ? +ref.slice(0, 4) : new Date().getFullYear()
    const refMonth = ref ? +ref.slice(5, 7) : 12
    year = date.m > refMonth ? refYear - 1 : refYear
  } else if (year < 100) {
    year += year < 70 ? 2000 : 1900
  }
  const iso = `${year}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  return parseDate(iso)
}

function detectAccount(text: string): { externalId?: string; type?: AccountType; institution?: string; isCard: boolean } {
  const head = text.split('\n').slice(0, 80).join('\n')
  const isCard = /minimum\s+payment|credit\s+(limit|line)|available\s+credit|card\s*member|credit\s+card/i.test(text)
  let type: AccountType | undefined
  if (isCard) type = 'credit_card'
  else if (/savings/i.test(head)) type = 'savings'
  else if (/checking/i.test(head)) type = 'checking'
  let externalId: string | undefined
  const acct = /\b(?:account|acct|card)(?:\s+(?:number|no\.?|#|ending(?:\s+in)?))*\s*[:#]?\s*((?:[X*•x]+[\s-]?)*\d[\d\s-]{2,}\d)/i.exec(text)
  if (acct) {
    const raw = acct[1].trim()
    const digits = raw.replace(/\D/g, '')
    if (digits.length >= 4) externalId = /[X*•x]/.test(raw) || digits.length <= 4 ? `****${digits.slice(-4)}` : digits
  }
  const institution = INSTITUTIONS.find((name) => new RegExp(`\\b${name.replace(/[.]/g, '\\.')}\\b`, 'i').test(head))
  return { externalId, type, institution, isCard }
}

/**
 * Parses the text of a bank or card PDF statement (one visual line per text line, as produced by `extractPdfText`).
 * Transaction lines start with a date and end with an amount, optionally followed by a running balance. Signs come
 * from, in order: running-balance changes, explicit signs, the section heading (Deposits / Withdrawals / Payments...),
 * then the default for the account type (money out).
 */
export function parsePdfStatement(text: string, options: ImportOptions = {}): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const errors: string[] = []
  if (lines.length === 0) {
    return {
      format: 'pdf',
      transactions: [],
      skippedRows: 0,
      errors: ['This PDF has no readable text. It is probably a scanned image; download a PDF, CSV or OFX statement from your bank’s website instead.']
    }
  }

  const dmy = detectDmy(lines, options.dateFormat)
  const dateFormat: DateFormat = dmy ? 'DMY' : 'MDY'
  const ref = referenceDate(lines, dateFormat)
  const account = detectAccount(lines.join('\n'))
  const cardSign = account.isCard ? -1 : 1

  const candidates: Candidate[] = []
  let section = 0
  let ignoring = false
  let opening: number | null = null
  let closing: number | null = null
  let skippedRows = 0

  for (const line of lines) {
    const dated = leadingDate(line, dmy)
    const body = dated ? dated.rest : line
    const balanceLine = OPENING.test(body) ? 'open' : CLOSING.test(body) ? 'close' : null
    if (balanceLine) {
      const m = TRAILING_AMOUNT.exec(body)
      if (m) {
        const value = balanceValue(m[1])
        if (balanceLine === 'open' && opening === null) opening = value
        if (balanceLine === 'close' && closing === null) closing = value
      }
      continue
    }
    if (!dated) {
      const heading = line.replace(/^[^A-Za-z]+/, '')
      if (IGNORE_SECTION.test(heading)) {
        ignoring = true
        section = 0
      } else if (CREDIT_SECTION.test(heading)) {
        ignoring = false
        section = 1
      } else if (DEBIT_SECTION.test(heading)) {
        ignoring = false
        section = -1
      } else if (/^(transaction|account)\s+(detail|activity|history)|^transactions\b/i.test(heading)) {
        ignoring = false
        section = 0
      }
      continue
    }
    if (ignoring) continue

    const amounts: string[] = []
    let rest = body
    for (let i = 0; i < 2; i++) {
      const m = TRAILING_AMOUNT.exec(rest)
      if (!m) break
      amounts.unshift(m[1])
      rest = rest.slice(0, m.index).trim()
    }
    // A second leading date (posting date) is common on card statements.
    const posted = leadingDate(rest, dmy)
    if (posted) rest = posted.rest
    const description = rest.replace(/^[-–—:·\s]+|[-–—:·\s$]+$/g, '').trim()
    if (amounts.length === 0 || !/[A-Za-z]/.test(description) || SKIP_DESCRIPTION.test(description)) {
      skippedRows++
      continue
    }
    candidates.push({
      date: dated.date,
      description,
      amountToken: amounts[0],
      balance: amounts.length > 1 ? balanceValue(amounts[1]) : null,
      section
    })
  }

  const transactions: ParsedTransaction[] = []
  candidates.forEach((c, i) => {
    const date = resolveDate(c.date, ref)
    if (!date) {
      skippedRows++
      return
    }
    const { cents, explicitNegative, explicitCredit } = amountValue(c.amountToken)
    let sign: number | null = null
    if (c.balance !== null) {
      const prev = i > 0 ? candidates[i - 1].balance : opening
      const next = i < candidates.length - 1 ? candidates[i + 1].balance : null
      if (prev !== null && Math.abs(c.balance - prev) === cents) sign = Math.sign(c.balance - prev) * cardSign
      else if (next !== null && Math.abs(c.balance - next) === cents) sign = Math.sign(c.balance - next) * cardSign
    }
    if (sign === null || sign === 0) {
      if (explicitCredit) sign = 1
      else if (explicitNegative) sign = account.isCard ? 1 : -1
      else if (c.section !== 0) sign = c.section
      else sign = -1
    }
    let amount = sign * cents
    if (options.invertAmounts) amount = -amount
    transactions.push({ date, amount, description: c.description })
  })

  if (transactions.length === 0) {
    errors.push('No transactions found in this PDF. If it is a scanned image or an unusual layout, try the CSV or OFX download from your bank instead.')
  }

  let ledgerBalance: ParsedStatement['ledgerBalance']
  const lastDate = transactions.map((t) => t.date).sort().at(-1)
  const balanceDate = ref && (!lastDate || ref >= lastDate) ? ref : lastDate
  if (closing !== null && balanceDate) {
    ledgerBalance = { date: balanceDate, balance: account.isCard ? -closing : closing }
  } else if (balanceDate && candidates.length && candidates.at(-1)!.balance !== null && !account.isCard) {
    ledgerBalance = { date: lastDate!, balance: candidates.at(-1)!.balance! }
  }

  return {
    format: 'pdf',
    transactions,
    dateFormat,
    account: { externalId: account.externalId, type: account.type, institution: account.institution },
    ledgerBalance,
    skippedRows,
    errors
  }
}
