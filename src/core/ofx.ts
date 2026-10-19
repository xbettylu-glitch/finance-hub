import type { AccountType, ParsedStatement, ParsedTransaction } from '../shared/types'
import { parseDate } from './dates'
import { parseAmount } from './money'

export function looksLikeOfx(text: string): boolean {
  return /<OFX>/i.test(text) || /^\s*OFXHEADER/i.test(text)
}

function field(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block)
  const v = m?.[1].trim()
  return v ? decodeEntities(v) : undefined
}

function blocks(text: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
}

function accountType(text: string): AccountType | undefined {
  if (/<CCSTMTRS>/i.test(text)) return 'credit_card'
  if (/<INVSTMTRS>/i.test(text)) return 'investment'
  const t = field(text, 'ACCTTYPE')?.toUpperCase()
  if (t === 'CHECKING') return 'checking'
  if (t === 'SAVINGS' || t === 'MONEYMRKT' || t === 'CD') return 'savings'
  if (t === 'CREDITLINE') return 'credit_card'
  return undefined
}

/** Parses OFX 1.x (SGML) and 2.x (XML) bank, credit card and investment statements (QFX is OFX). */
export function parseOfx(text: string): ParsedStatement {
  const errors: string[] = []
  const transactions: ParsedTransaction[] = []
  let skippedRows = 0
  for (const b of blocks(text, 'STMTTRN')) {
    const date = parseDate(field(b, 'DTPOSTED') ?? field(b, 'DTUSER') ?? '', 'YMD')
    const amount = parseAmount(field(b, 'TRNAMT'))
    if (!date || amount == null) {
      skippedRows++
      continue
    }
    const name = field(b, 'NAME')
    const memo = field(b, 'MEMO')
    const description = name && memo && !name.includes(memo) && name.length < 12 ? `${name} ${memo}` : (name ?? memo ?? 'Unknown')
    transactions.push({ date, amount, description, fitId: field(b, 'FITID') })
  }
  if (transactions.length === 0 && skippedRows === 0) errors.push('No transactions found in this OFX/QFX file.')

  let ledgerBalance: ParsedStatement['ledgerBalance']
  const ledger = blocks(text, 'LEDGERBAL')[0]
  if (ledger) {
    const balance = parseAmount(field(ledger, 'BALAMT'))
    const date = parseDate(field(ledger, 'DTASOF') ?? '', 'YMD')
    if (balance != null && date) ledgerBalance = { date, balance }
  }
  const positions = blocks(text, 'INVPOSLIST')[0]
  if (!ledgerBalance && positions) {
    let total = 0
    for (const m of positions.matchAll(/<MKTVAL>([^<\r\n]*)/gi)) total += parseAmount(m[1]) ?? 0
    const invBal = blocks(text, 'INVBAL')[0]
    total += parseAmount(invBal ? field(invBal, 'AVAILCASH') : undefined) ?? 0
    const date = parseDate(field(text, 'DTASOF') ?? field(text, 'DTEND') ?? '', 'YMD')
    if (date) ledgerBalance = { date, balance: total }
  }

  return {
    format: 'ofx',
    transactions,
    account: {
      externalId: field(text, 'ACCTID'),
      type: accountType(text),
      institution: field(text, 'ORG')
    },
    ledgerBalance,
    skippedRows,
    errors
  }
}
