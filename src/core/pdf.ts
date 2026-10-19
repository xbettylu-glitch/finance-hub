import type { AccountType, DateFormat, ImportOptions, ParsedStatement, ParsedTransaction } from '../shared/types'
import { daysInMonth, parseDate, todayIso } from './dates'

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
    re: new RegExp(`^(\\d{1,2})[\\s-]+${MONTH_RE}(?:[\\s-]+(\\d{4}))?\\b`, 'i'),
    parse: (m) => ({ y: m[3] ? +m[3] : undefined, m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: +m[1] })
  }
]

const CURRENCY_CODE = String.raw`(?:GBP|EUR|USD|CAD)`
const CURRENCY_SIGN = String.raw`(?:CA\$|C\$|US\$|A\$|[$£€])`
const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}`
const AMOUNT_TOKEN = String.raw`(?:[-+−–]\s?)?\(?(?:${CURRENCY_CODE}\s?)?${CURRENCY_SIGN}?\s?[-−–]?${NUMBER}\)?(?:\s?${CURRENCY_CODE})?(?:\s*(?:CR|DR)|\s?-)?`
/** An amount at the end of a line, optionally followed by a footnote marker (Amex uses ⧫ / *). */
const TRAILING_AMOUNT = new RegExp(String.raw`(?:^|\s)(${AMOUNT_TOKEN})(?:\s*[*⧫◆♦†])?\s*$`, 'i')
const LEADING_MARKER = /^[*•·◆♦⧫]\s*/
const FULL_DATE = new RegExp(String.raw`\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|${MONTH_RE}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+${MONTH_RE}\s+\d{4})\b`, 'gi')

const OPENING = /^(beginning|opening|previous|starting|prior)\s+balance\b/i
const CLOSING = /^(ending|closing|new)\s+balance\b|^(statement|current)\s+balance\b|^balance\s+(on|as\s+of)\b/i
const SKIP_DESCRIPTION = /^(total|subtotal|sub-total)\b|^(daily|average)\s+(ending\s+)?balance/i

const CREDIT_SECTION =
  /^(deposits?|credits?(?!\s+(limit|line|card|available|interest|rating))|additions|other credits|refunds?|money\s+in$|payments?\s+(received|and\s+refunds)|your\s+payments|deposits?\s+(and|&)\s+(other\s+)?(additions|credits)|payments?(,|\s+and|\s+&)?\s+(other\s+)?credits|interest\s+(earned|paid))\b/i
const DEBIT_SECTION =
  /^(withdrawals?|debits?|checks?(\s+paid)?|electronic\s+(withdrawals|payments|debits)|atm\b|atm\s+(&|and)\s+debit|(debit\s+)?card\s+(purchases|transactions)|purchases?|fees?(\s+charged)?|interest\s+charged|other\s+(withdrawals|debits)|service\s+(charges|fees)|purchases?\s+(and|&)\s+(adjustments|other\s+charges|cash\s+advances)|new\s+(charges|transactions)|(other\s+)?charges$|money\s+out$|your\s+(new\s+)?transactions)\b/i
/** On card statements a bare "Payments" heading lists money paid to the card. */
const CARD_CREDIT_SECTION = /^payments?(\s+and\s+(other\s+)?credits)?$/i
/** Card lines that are money paid to the card or refunded, even when printed without a sign. */
const CARD_PAYMENT = /\bpayments?\b.*\b(received|thank\s*you|merci)\b|\bthank\s*you\b|\bpaiement\b|\bdirect\s+debit\b|\bautopay\b|\b(refund|cashback|reward\s+credit|statement\s+credit)\b/i
/** A table's column header row, e.g. "Date Description Amount" or "Trans. Date Post Date ...". */
const COLUMN_HEADER = /^(trans(action)?\.?\s+|posting\s+|completed\s+)?date\b/i
const COLUMN_WORDS = /\b(date|description|details|amount|balance|money\s+(in|out)|paid\s+(in|out)|incoming|outgoing|debits?|credits?)\b/gi
const isColumnHeader = (line: string): boolean => COLUMN_HEADER.test(line) || (!/\d/.test(line) && (line.match(COLUMN_WORDS)?.length ?? 0) >= 2)
const IGNORE_SECTION = /^(daily\s+(ending\s+)?balance|balance\s+summary|daily\s+balance\s+summary|interest\s+(charge\s+)?calculation)/i
const UK_HINT = /£|\bGBP\b|\bsort\s+code\b|\bpostcode\b|\bUnited\s+Kingdom\b|\bFCA\b|Financial\s+Conduct\s+Authority/i

/** [name shown in the app, extra spellings]. Longer names first so "Bank of America" wins over "America". */
const INSTITUTIONS: [string, string[]][] = [
  ['American Express', ['Amex']],
  ['Bank of America', []],
  ['Wells Fargo', []],
  ['Capital One', []],
  ['Charles Schwab', []],
  ['Goldman Sachs', []],
  ['Navy Federal', []],
  ['U.S. Bank', ['US Bank']],
  ['Rogers Bank', ['Rogers']],
  ['BMO', ['Bank of Montreal']],
  ['RBC', ['Royal Bank of Canada', 'Royal Bank']],
  ['TD', ['TD Canada Trust', 'TD Bank']],
  ['Scotiabank', []],
  ['CIBC', []],
  ['Tangerine', []],
  ['Simplii', []],
  ['Desjardins', []],
  ['EQ Bank', []],
  ['Wealthsimple', []],
  ['MBNA', []],
  ['PC Financial', []],
  ['Neo Financial', []],
  ['Canadian Tire', []],
  ['Yonder', []],
  ['Revolut', []],
  ['Wise', ['TransferWise']],
  ['Monzo', []],
  ['Starling', []],
  ['Barclaycard', []],
  ['Barclays', []],
  ['HSBC', []],
  ['Lloyds', []],
  ['NatWest', []],
  ['Santander', []],
  ['Nationwide', []],
  ['Halifax', []],
  ['First Direct', []],
  ['Citibank', ['Citi']],
  ['Chase', []],
  ['Discover', []],
  ['Ally', []],
  ['PNC', []],
  ['Truist', []],
  ['Fidelity', []],
  ['Vanguard', []],
  ['SoFi', []],
  ['Marcus', []],
  ['Synchrony', []],
  ['USAA', []]
]

interface Candidate {
  date: { y?: number; m: number; d: number }
  description: string
  amountToken: string
  balance: number | null
  section: number
}

function amountValue(token: string): { cents: number; explicitNegative: boolean; explicitCredit: boolean } {
  const t = token.replace(/\s+/g, '').replace(/[−–]/g, '-')
  const explicitCredit = /CR$/i.test(t)
  const core = t.replace(/(CR|DR)$/i, '').replace(/GBP|EUR|USD|CAD|CA\$|C\$|US\$|A\$|[$£€]/gi, '')
  const explicitNegative = /^-|^\(|\)$|-$/.test(core) || /DR$/i.test(t)
  const digits = t.replace(/[^\d.]/g, '')
  return { cents: Math.round(Number(digits) * 100), explicitNegative, explicitCredit }
}

function balanceValue(token: string): number {
  const v = amountValue(token)
  return v.explicitNegative ? -v.cents : v.cents
}

function leadingDate(input: string, dmy: boolean): { date: Candidate['date']; rest: string } | null {
  const line = input.replace(LEADING_MARKER, '')
  for (const { re, parse } of LEADING_DATE) {
    const m = re.exec(line)
    if (!m) continue
    const date = parse(m, dmy)
    if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31) return null
    return { date, rest: line.slice(m[0].length).trim() }
  }
  return null
}

/** Day-first when a numeric date proves it (e.g. 25/03), or when nothing proves otherwise and the statement is British. */
function detectDmy(lines: string[], format: DateFormat | undefined, british: boolean): boolean {
  if (format === 'DMY') return true
  if (format === 'MDY' || format === 'YMD') return false
  let dmy = british
  for (const line of lines) {
    const m = /^(\d{1,2})([/.-])(\d{1,2})([/.-]\d{2,4})?(?![\d/.-])/.exec(line)
    // "12.99" or "5.20" at the start of a line is an amount, not a date.
    if (!m || (m[2] === '.' && !m[4])) continue
    if (+m[3] > 12) return false
    if (+m[1] > 12) dmy = true
  }
  return dmy
}

/** The statement's closing date, used to give year-less dates (e.g. "01/05") a year. */
const STATEMENT_DATE =
  /statement\s+(closing\s+)?date|date\s+of\s+(this\s+)?statement|closing\s+date|opening\/closing\s+date|statement\s+(period|from)|billing\s+(period|cycle)|period\s+(ending|covered)|statement\s+ending/i

/**
 * The statement's closing date, used to give year-less dates (e.g. "01/05") a year. Prefers the date labelled as the
 * statement date, then the first date range (e.g. "1 Sep 2025 to 30 Sep 2025"), then the latest date on the statement.
 * Small print often mentions other years ("changes to your terms from 1 February 2026"), so those only count last.
 */
function referenceDate(lines: string[], format: DateFormat, today: string): string | null {
  let range: string | null = null
  let latest: string | null = null
  for (const line of lines) {
    const found = [...line.matchAll(FULL_DATE)].flatMap((m) => {
      const iso = parseDate(m[1], format)
      return iso ? [{ iso, index: m.index! }] : []
    })
    if (!found.length) continue
    const labelled = STATEMENT_DATE.exec(line)
    if (labelled) {
      const afterLabel = found.filter((f) => f.index > labelled.index)
      const pool = afterLabel.length ? afterLabel : found
      // "Opening/Closing Date 12/15/25 - 01/14/26": the end of the range is the closing date.
      if (pool.length > 1 && /\bto\b|through|\s[-–]\s/i.test(line)) return pool.map((f) => f.iso).sort().at(-1)!
      return pool[0].iso
    }
    const sorted = found.map((f) => f.iso).sort()
    if (!range && found.length > 1 && /\bto\b|through|\s[-–]\s/i.test(line)) range = sorted.at(-1)!
    for (const iso of sorted) if (iso <= today && (!latest || iso > latest)) latest = iso
  }
  return range ?? latest
}

/** Gives year-less dates the year of the statement date `ref` (or of today, when the statement shows no date at all). */
function resolveDate(date: Candidate['date'], ref: string): string | null {
  let year = date.y
  if (year === undefined) {
    const refYear = +ref.slice(0, 4)
    const refMonth = +ref.slice(5, 7)
    year = date.m > refMonth ? refYear - 1 : refYear
  } else if (year < 100) {
    year += year < 70 ? 2000 : 1900
  }
  const iso = `${year}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  return parseDate(iso)
}

function detectAccount(text: string): { externalId?: string; type?: AccountType; institution?: string; isCard: boolean } {
  const head = text.split('\n').slice(0, 80).join('\n')
  const isCard = /minimum\s+payment|credit\s+(limit|line)|available\s+credit|card\s*member|credit\s+card|american\s+express|\bamex\b|membership\s+number|payment\s+due\s+date/i.test(text)
  let type: AccountType | undefined
  if (isCard) type = 'credit_card'
  else if (/savings|\bISA\b/i.test(head)) type = 'savings'
  else if (/checking|chequing|current\s+account|personal\s+account/i.test(head)) type = 'checking'
  let externalId: string | undefined
  const acct = /\b(?:account|acct|card|membership)(?:\s+(?:number|no\.?|#|ending(?:\s+in)?))*\s*[:#]?\s*([X*•x\d](?:[X*•x\d-]|\s(?=[X*•x\d]))*\d)/i.exec(text)
  if (acct) {
    const raw = acct[1].trim()
    const digits = raw.replace(/\D/g, '')
    if (digits.length >= 4) externalId = isCard || /[X*•x]/.test(raw) || digits.length <= 4 ? `****${digits.slice(-4)}` : digits
  }
  const institution = INSTITUTIONS.find(([name, aliases]) =>
    [name, ...aliases].some((n) => new RegExp(`\\b${n.replace(/[.]/g, '\\.')}\\b`, /^[A-Z]+$/.test(n) ? '' : 'i').test(head))
  )?.[0]
  return { externalId, type, institution, isCard }
}

/**
 * Parses the text of a bank or card PDF statement (one visual line per text line, as produced by `extractPdfText`).
 * Transaction lines start with a date and end with an amount, optionally followed by a running balance. Signs come
 * from, in order: running-balance changes, explicit signs, the section heading (Deposits / Withdrawals / Payments...),
 * then the default for the account type (money out).
 */
/** The year (and month, if present) in a file name like "Statement_Oct_2025.pdf", as the last day of that period. */
function dateFromFilename(filename: string): string | null {
  const year = /(?:^|\D)(20\d{2})(?!\d)/.exec(filename)?.[1]
  if (!year) return null
  const month = new RegExp(MONTH_RE, 'i').exec(filename.replace(/\d+/g, ' '))
  const m = month ? MONTHS.indexOf(month[1].slice(0, 3).toLowerCase()) + 1 : 12
  return `${year}-${String(m).padStart(2, '0')}-${String(daysInMonth(+year, m)).padStart(2, '0')}`
}

export function parsePdfStatement(text: string, options: ImportOptions = {}, context: { filename?: string; today?: string } = {}): ParsedStatement {
  const today = context.today ?? todayIso()
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

  const dmy = detectDmy(lines, options.dateFormat, UK_HINT.test(text) || options.dayFirst === true)
  const dateFormat: DateFormat = dmy ? 'DMY' : 'MDY'
  const found = referenceDate(lines, dateFormat, today)
  const fromName = context.filename ? dateFromFilename(context.filename) : null
  // With no date anywhere, year-less dates are assumed to be from the last 12 months.
  const ref = found ?? (fromName && fromName < today ? fromName : today)
  const account = detectAccount(lines.join('\n'))
  const cardSign = account.isCard ? -1 : 1
  const hasReferenceColumn = /reference\s+(number|no\b|#)/i.test(text)

  /**
   * Reads candidate transactions. With `useOrphans`, a dated line without an amount takes the description and amount from
   * the line above it (Wise prints the date underneath); otherwise it takes them from the lines below (wrapped descriptions).
   */
  const collect = (useOrphans: boolean): { candidates: Candidate[]; opening: number | null; closing: number | null; skippedRows: number } => {
    const candidates: Candidate[] = []
    let section = 0
    let ignoring = false
    let opening: number | null = null
    let closing: number | null = null
    let skippedRows = 0
    /** A dated line without an amount; its description may continue on the next lines until the amount appears. */
    let pending: { date: Candidate['date']; parts: string[]; section: number } | null = null
    /** The previous line, when it had a description and amount but no date (Wise prints the date underneath). */
    let orphan: { text: string; amounts: string[]; section: number } | null = null

    const splitAmounts = (text: string): { rest: string; amounts: string[] } => {
      const amounts: string[] = []
      let rest = text
      for (let i = 0; i < 2; i++) {
        const m = TRAILING_AMOUNT.exec(rest)
        if (!m) break
        amounts.unshift(m[1])
        rest = rest.slice(0, m.index).trim()
      }
      // Card cashback columns, e.g. "2% $0.50 $25.00": the last amount is the transaction.
      if (amounts.length === 2 && /\d+(\.\d+)?\s?%$/.test(rest)) {
        amounts.shift()
        rest = rest.replace(/\s*\d+(\.\d+)?\s?%$/, '')
      }
      return { rest, amounts }
    }

    const cleanDescription = (text: string): string => {
      let d = text.replace(/^[-–—:·*\s]+|[-–—:·*\s$£€]+$/g, '').trim()
      if (hasReferenceColumn) {
        const words = d.split(' ')
        while (words.length > 1 && /^(?=.*\d)[A-Z0-9]{8,}$/.test(words.at(-1)!)) words.pop()
        d = words.join(' ')
      }
      return d
    }

    const add = (date: Candidate['date'], text: string, amounts: string[], sec: number): void => {
      const posted = leadingDate(text, dmy)
      const description = cleanDescription(posted ? posted.rest : text)
      if (!/[A-Za-z]/.test(description) || SKIP_DESCRIPTION.test(description)) {
        skippedRows++
        return
      }
      candidates.push({
        date,
        description,
        amountToken: amounts[0],
        balance: amounts.length > 1 ? balanceValue(amounts[1]) : null,
        section: sec
      })
    }

    const dropPending = (): void => {
      if (pending) skippedRows++
      pending = null
    }

    for (const line of lines) {
      const dated = leadingDate(line, dmy)
      const body = dated ? dated.rest : line
      const previousOrphan = orphan
      orphan = null
      const balanceLine = OPENING.test(body) ? 'open' : CLOSING.test(body) ? 'close' : null
      if (balanceLine) {
        dropPending()
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
        // Summary lines such as "Credit limit £3,000.00" or "Payments, Credits -$500.00" are not section headings.
        const isHeading = !TRAILING_AMOUNT.test(line)
        if (isHeading && IGNORE_SECTION.test(heading)) {
          dropPending()
          ignoring = true
          section = 0
          continue
        }
        if (isHeading && (CREDIT_SECTION.test(heading) || (account.isCard && CARD_CREDIT_SECTION.test(heading)))) {
          dropPending()
          ignoring = false
          section = 1
          continue
        }
        if (isHeading && DEBIT_SECTION.test(heading)) {
          dropPending()
          ignoring = false
          section = -1
          continue
        }
        if (isHeading && /^(transaction|account)\s+(detail|activity|history)|^transactions\b/i.test(heading)) {
          dropPending()
          ignoring = false
          section = 0
          continue
        }
        if (isColumnHeader(heading)) {
          dropPending()
          ignoring = false
          continue
        }
        if (ignoring) continue
        const { rest, amounts } = splitAmounts(line)
        if (pending) {
          if (rest) pending.parts.push(rest)
          if (amounts.length) {
            add(pending.date, pending.parts.join(' '), amounts, pending.section)
            pending = null
          } else if (pending.parts.length > 3) dropPending()
          continue
        }
        if (useOrphans && amounts.length && /[A-Za-z]/.test(rest)) orphan = { text: rest, amounts, section }
        continue
      }
      if (ignoring) continue
      dropPending()
      const { rest, amounts } = splitAmounts(body)
      if (amounts.length) {
        add(dated.date, rest, amounts, section)
      } else if (previousOrphan) {
        add(dated.date, previousOrphan.text, previousOrphan.amounts, previousOrphan.section)
      } else if (/[A-Za-z]/.test(rest.replace(FULL_DATE, '').replace(/\b(to|through|until)\b/gi, ''))) {
        pending = { date: dated.date, parts: [rest], section }
      } else {
        skippedRows++
      }
    }
    dropPending()
    return { candidates, opening, closing, skippedRows }
  }
  const strict = collect(false)
  const loose = collect(true)
  const { candidates, opening, closing, ...counts } = loose.candidates.length > strict.candidates.length ? loose : strict
  let skippedRows = counts.skippedRows

  const transactions: ParsedTransaction[] = []
  const dates = candidates.map((c) => resolveDate(c.date, ref))
  const known = dates.filter((d): d is string => d !== null)
  // Revolut and Wise list the newest transaction first, so the balance before a row is on the row below it.
  const newestFirst = known.length > 1 && known[0] > known.at(-1)!
  // Statements that print money out with a minus sign (Wise, many UK banks) show money in unsigned.
  const signedAmounts =
    !account.isCard &&
    !candidates.some((c) => /(CR|DR)$/i.test(c.amountToken.trim())) &&
    candidates.some((c) => amountValue(c.amountToken).explicitNegative)
  candidates.forEach((c, i) => {
    const date = dates[i]
    if (!date) {
      skippedRows++
      return
    }
    const { cents, explicitNegative, explicitCredit } = amountValue(c.amountToken)
    let sign: number | null = null
    if (c.balance !== null) {
      const earlier = newestFirst ? i + 1 : i - 1
      const before = earlier >= 0 && earlier < candidates.length ? candidates[earlier].balance : opening
      if (before !== null && Math.abs(c.balance - before) === cents) sign = Math.sign(c.balance - before) * cardSign
    }
    if (sign === null || sign === 0) {
      if (explicitCredit) sign = 1
      else if (explicitNegative) sign = account.isCard ? 1 : -1
      else if (account.isCard && CARD_PAYMENT.test(c.description)) sign = 1
      // On cards, a "Payments/Credits" heading can be a summary box or page header that never gets closed, so it doesn't make
      // later lines money in; card credits come from CR / minus markers or payment and refund wording instead.
      else if (c.section === -1 || (c.section === 1 && !account.isCard)) sign = c.section
      else sign = signedAmounts ? 1 : -1
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
  const latest = newestFirst ? candidates[0] : candidates.at(-1)
  const balanceDate = ref && (!lastDate || ref >= lastDate) ? ref : lastDate
  if (closing !== null && balanceDate) {
    ledgerBalance = { date: balanceDate, balance: account.isCard ? -closing : closing }
  } else if (balanceDate && latest && latest.balance !== null && !account.isCard) {
    ledgerBalance = { date: lastDate!, balance: latest.balance }
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
