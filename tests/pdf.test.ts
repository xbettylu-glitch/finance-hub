import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { parsePdfStatement } from '../src/core/pdf'
import { extractPdfText, layoutLines } from '../src/main/pdf'
import { FinanceStore } from '../src/main/store'
import { makePdf, statementPage } from './helpers/makePdf'

const checkingWithBalances = statementPage([
  [[40, 'Chase']],
  [[40, 'Chase Total Checking']],
  [[40, 'January 1, 2026 through January 31, 2026']],
  [[40, 'Account Number: 000000123456789']],
  [[40, 'TRANSACTION DETAIL']],
  [[40, 'DATE'], [90, 'DESCRIPTION'], [420, 'AMOUNT'], [500, 'BALANCE']],
  [[90, 'Beginning Balance'], [500, '$2,000.00']],
  [[40, '01/03'], [90, 'Card Purchase 01/02 Whole Foods Market #123'], [420, '-84.12'], [500, '1,915.88']],
  [[40, '01/05'], [90, 'Payroll ACME Corp Direct Dep'], [420, '2,500.00'], [500, '4,415.88']],
  [[40, '01/15'], [90, 'Zelle Payment To Jane 4455'], [420, '150.00'], [500, '4,265.88']],
  [[40, '01/31'], [90, 'Monthly Service Fee'], [420, '12.00'], [500, '4,253.88']],
  [[90, 'Ending Balance'], [500, '$4,253.88']],
  [[40, 'Page 1 of 1']]
])

const sectionedChecking = statementPage([
  [[40, 'Bank of America Advantage Savings']],
  [[40, 'Account number: 9876 5432 1098']],
  [[40, 'for February 1, 2026 to February 28, 2026']],
  [[40, 'Deposits and other additions']],
  [[40, '02/01/26'], [110, 'Interest Earned'], [470, '3.21']],
  [[40, '02/14/26'], [110, 'Online Transfer from CHK 1234'], [470, '500.00']],
  [[40, 'Total deposits and other additions'], [470, '$503.21']],
  [[40, 'Withdrawals and other subtractions']],
  [[40, '02/20/26'], [110, 'Online Transfer to CHK 1234'], [470, '200.00']],
  [[40, 'Total withdrawals and other subtractions'], [470, '-$200.00']],
  [[40, 'Daily ledger balances']],
  [[40, 'Daily Balance Summary']],
  [[40, '02/01'], [110, '10,003.21']]
])

const creditCard = statementPage([
  [[40, 'Chase Sapphire Preferred']],
  [[40, 'Account number: XXXX XXXX XXXX 4321']],
  [[40, 'Opening/Closing Date 12/15/25 - 01/14/26']],
  [[40, 'Payment Due Date: 02/08/26'], [300, 'Minimum Payment Due: $40.00']],
  [[40, 'Credit Access Line $15,000']],
  [[40, 'New Balance'], [300, '$1,032.79']],
  [[40, 'ACCOUNT ACTIVITY']],
  [[40, 'Date of Transaction'], [140, 'Merchant Name or Transaction Description'], [480, '$ Amount']],
  [[40, 'PAYMENTS AND OTHER CREDITS']],
  [[40, '01/02'], [140, 'Payment Thank You - Web'], [480, '-500.00']],
  [[40, 'PURCHASE']],
  [[40, '12/20'], [140, 'AMAZON.COM*AB12CD SEATTLE WA'], [480, '45.67']],
  [[40, '12/28'], [140, 'BLUE BOTTLE COFFEE OAKLAND CA'], [480, '6.50']],
  [[40, '01/10'], [140, 'UNITED AIRLINES 0162 HOUSTON TX'], [480, '980.62']],
  [[40, 'Totals Year-to-Date']]
])

describe('PDF text extraction', () => {
  it('reconstructs lines and columns from positioned text', () => {
    expect(
      layoutLines([
        { str: '-84.12', x: 420, y: 700, width: 30, size: 10 },
        { str: '01/03', x: 40, y: 700.5, width: 25, size: 10 },
        { str: 'Whole Foods', x: 90, y: 700, width: 55, size: 10 },
        { str: 'Header', x: 40, y: 720, width: 30, size: 10 }
      ])
    ).toEqual(['Header', '01/03   Whole Foods   -84.12'])
  })

  it('reads a real PDF file', async () => {
    const text = await extractPdfText(makePdf([checkingWithBalances]))
    const lines = text.split('\n')
    expect(lines[0]).toBe('Chase')
    expect(lines).toContain('01/05   Payroll ACME Corp Direct Dep   2,500.00   4,415.88')
  })

  it('reports password-protected or broken files clearly', async () => {
    await expect(extractPdfText(new Uint8Array(Buffer.from('not a pdf')))).rejects.toThrow(/Could not read this PDF/)
  })
})

describe('parsePdfStatement', () => {
  it('uses the running balance for signs and reads account details', async () => {
    const s = parsePdfStatement(await extractPdfText(makePdf([checkingWithBalances])))
    expect(s.format).toBe('pdf')
    expect(s.account).toEqual({ externalId: '000000123456789', type: 'checking', institution: 'Chase' })
    expect(s.transactions).toEqual([
      { date: '2026-01-03', amount: -8412, description: 'Card Purchase 01/02 Whole Foods Market #123' },
      { date: '2026-01-05', amount: 250000, description: 'Payroll ACME Corp Direct Dep' },
      { date: '2026-01-15', amount: -15000, description: 'Zelle Payment To Jane 4455' },
      { date: '2026-01-31', amount: -1200, description: 'Monthly Service Fee' }
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-01-31', balance: 425388 })
    expect(s.errors).toEqual([])
  })

  it('uses section headings for signs, skips totals and daily balances', async () => {
    const s = parsePdfStatement(await extractPdfText(makePdf([sectionedChecking])))
    expect(s.account?.type).toBe('savings')
    expect(s.account?.institution).toBe('Bank of America')
    expect(s.account?.externalId).toBe('987654321098')
    expect(s.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2026-02-01', 321],
      ['2026-02-14', 50000],
      ['2026-02-20', -20000]
    ])
  })

  it('handles card statements: charges negative, payments positive, year rollover, balance owed', async () => {
    const s = parsePdfStatement(await extractPdfText(makePdf([creditCard])))
    expect(s.account).toEqual({ externalId: '****4321', type: 'credit_card', institution: 'Chase' })
    expect(s.transactions.map((t) => [t.date, t.amount, t.description])).toEqual([
      ['2026-01-02', 50000, 'Payment Thank You - Web'],
      ['2025-12-20', -4567, 'AMAZON.COM*AB12CD SEATTLE WA'],
      ['2025-12-28', -650, 'BLUE BOTTLE COFFEE OAKLAND CA'],
      ['2026-01-10', -98062, 'UNITED AIRLINES 0162 HOUSTON TX']
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-01-14', balance: -103279 })
  })

  it('handles day-first dates, month names and CR/DR markers', () => {
    const text = ['Statement period 1 March 2026 to 31 March 2026', '15/03/2026 TESCO STORES 3012 23.40 DR', '20/03/2026 SALARY ACME LTD 2,100.00 CR', '3 Mar Coffee House 3.10'].join('\n')
    const s = parsePdfStatement(text)
    expect(s.dateFormat).toBe('DMY')
    expect(s.transactions).toEqual([
      { date: '2026-03-15', amount: -2340, description: 'TESCO STORES 3012' },
      { date: '2026-03-20', amount: 210000, description: 'SALARY ACME LTD' },
      { date: '2026-03-03', amount: -310, description: 'Coffee House' }
    ])
  })

  it('explains when there is no text (scanned PDF)', () => {
    const s = parsePdfStatement('')
    expect(s.transactions).toEqual([])
    expect(s.errors[0]).toMatch(/scanned/)
  })

  it('imports through the store with exclusions, edits and dedupe', async () => {
    const SQL = await initSqlJs()
    const store = new FinanceStore(new SQL.Database())
    const text = await extractPdfText(makePdf([creditCard]))
    const preview = store.previewImport('statement.pdf', text, {})
    expect(preview.transactions).toHaveLength(4)
    const res = store.commitImport({
      filename: 'statement.pdf',
      text,
      options: {},
      newAccount: { name: 'Sapphire', type: 'credit_card' },
      excluded: [2],
      edits: { 1: { description: 'Amazon order' } }
    })
    expect(res).toMatchObject({ added: 3, balanceUpdated: true })
    const rows = store.listTransactions({ accountId: res.accountId }).rows
    expect(rows.map((r) => r.description).sort()).toEqual(['Amazon order', 'Payment Thank You - Web', 'UNITED AIRLINES 0162 HOUSTON TX'])
    expect(store.previewImport('statement.pdf', text, {}).matchedAccountId).toBe(res.accountId)
    const again = store.commitImport({ filename: 'statement.pdf', text, options: {}, accountId: res.accountId })
    expect(again.added).toBe(1)
    expect(again.duplicates).toBe(3)
    expect(() =>
      store.commitImport({ filename: 'statement.pdf', text, options: {}, accountId: res.accountId, edits: { 0: { date: 'nope' } } })
    ).toThrow(/Row 1/)
  })
})
