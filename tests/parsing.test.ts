import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { normalizePayee } from '../src/core/categorize'
import { parseCsv } from '../src/core/csv'
import { parseDate } from '../src/core/dates'
import { parseAmount } from '../src/core/money'
import { parseOfx } from '../src/core/ofx'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseAmount', () => {
  it.each([
    ['$1,234.56', 123456],
    ['-12.30', -1230],
    ['(45.00)', -4500],
    ['12.30 CR', 1230],
    ['12.30 DR', -1230],
    ['1.234,56', 123456],
    ['0.29', 29],
    ['+7', 700],
    ['', null],
    ['abc', null]
  ])('%s -> %s', (raw, cents) => expect(parseAmount(raw)).toBe(cents))
})

describe('parseDate', () => {
  it.each([
    ['2026-10-14', 'auto', '2026-10-14'],
    ['20261014120000[0:GMT]', 'YMD', '2026-10-14'],
    ['10/14/2026', 'auto', '2026-10-14'],
    ['14/10/2026', 'auto', '2026-10-14'],
    ['03/04/2026', 'DMY', '2026-04-03'],
    ['3/4/26', 'MDY', '2026-03-04'],
    ['Oct 14, 2026', 'auto', '2026-10-14'],
    ['14-Oct-2026', 'auto', '2026-10-14'],
    ['02/30/2026', 'auto', null]
  ] as const)('%s (%s) -> %s', (raw, fmt, iso) => expect(parseDate(raw, fmt)).toBe(iso))
})

describe('parseCsv', () => {
  it('reads a Chase-style export with a running balance (newest first)', () => {
    const s = parseCsv(fixture('chase-checking.csv'))
    expect(s.errors).toEqual([])
    expect(s.transactions).toHaveLength(4)
    expect(s.transactions[0]).toEqual({ date: '2026-10-14', amount: -8412, description: 'WHOLE FOODS MARKET #10234 SAN FRANCISCO CA' })
    expect(s.ledgerBalance).toEqual({ date: '2026-10-14', balance: 241588 })
  })

  it('can invert card exports where purchases are positive', () => {
    const s = parseCsv(fixture('amex.csv'), { invertAmounts: true })
    expect(s.transactions.map((t) => t.amount)).toEqual([-2345, -41200, 50000])
  })

  it('skips preamble lines and combines withdrawal/deposit columns', () => {
    const s = parseCsv(fixture('preamble-debit-credit.csv'))
    expect(s.transactions).toEqual([
      { date: '2026-09-02', amount: -525, description: 'STARBUCKS STORE 08812' },
      { date: '2026-09-03', amount: 110, description: 'INTEREST PAID' }
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-09-03', balance: 99585 })
  })

  it('infers columns for header-less exports', () => {
    const s = parseCsv(fixture('headerless.csv'))
    expect(s.transactions).toEqual([
      { date: '2026-09-28', amount: -4210, description: 'SHELL OIL 57442' },
      { date: '2026-09-29', amount: 150000, description: 'ONLINE TRANSFER FROM SAVINGS' }
    ])
  })

  it('applies unsigned amounts with a debit/credit type column', () => {
    const s = parseCsv('Date,Description,Amount,Type\n2026-01-02,Coffee,4.50,Debit\n2026-01-03,Refund,10.00,Credit\n')
    expect(s.transactions.map((t) => t.amount)).toEqual([-450, 1000])
  })

  it('honours a manual mapping', () => {
    const s = parseCsv('a,b,c\nfoo,2026-01-05,-3.00\n', { mapping: { description: 0, date: 1, amount: 2 } })
    expect(s.transactions).toEqual([{ date: '2026-01-05', amount: -300, description: 'foo' }])
  })
})

describe('parseOfx', () => {
  it('reads an SGML OFX bank statement', () => {
    const s = parseOfx(fixture('bank.ofx'))
    expect(s.account).toEqual({ externalId: '9876543210', type: 'savings', institution: 'Ally Bank' })
    expect(s.transactions).toEqual([
      { date: '2026-09-30', amount: 5432, description: 'INTEREST PAID', fitId: '202609301' },
      { date: '2026-10-03', amount: 80000, description: 'ONLINE TRANSFER FROM CHECKING & CO', fitId: '202610031' }
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-10-15', balance: 1585432 })
  })

  it('detects credit card statements and XML-style closing tags', () => {
    const s = parseOfx(
      '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>XXXX1234</ACCTID></CCACCTFROM>' +
        '<STMTTRN><DTPOSTED>20261001</DTPOSTED><TRNAMT>-9.99</TRNAMT><FITID>A1</FITID><NAME>SPOTIFY</NAME></STMTTRN>' +
        '</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>'
    )
    expect(s.account?.type).toBe('credit_card')
    expect(s.transactions).toEqual([{ date: '2026-10-01', amount: -999, description: 'SPOTIFY', fitId: 'A1' }])
  })
})

describe('normalizePayee', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee'],
    ['WHOLE FOODS MARKET #10234 SAN FRANCISCO CA', 'Whole Foods Market San Francisco'],
    ['STARBUCKS STORE 08812', 'Starbucks Store'],
    ['NETFLIX.COM', 'Netflix.com'],
    ['POS DEBIT CHIPOTLE 1734', 'Chipotle']
  ])('%s -> %s', (raw, payee) => expect(normalizePayee(raw)).toBe(payee))
})
