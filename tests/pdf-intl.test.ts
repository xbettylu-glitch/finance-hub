import { describe, expect, it } from 'vitest'
import { parsePdfStatement } from '../src/core/pdf'
import { extractPdfText } from '../src/main/pdf'
import { makePdf, statementPage } from './helpers/makePdf'

// Layouts modelled on UK and Canadian statements (names, numbers and amounts are made up).
const rows = (s: ReturnType<typeof parsePdfStatement>): [string, number, string][] => s.transactions.map((t) => [t.date, t.amount, t.description])

describe('UK statements', () => {
  it('Amex UK: £ amounts, CR payments, wrapped descriptions, footnote markers', async () => {
    const page = statementPage([
      [[40, 'American Express']],
      [[40, 'Platinum Cashback Everyday Credit Card']],
      [[40, 'Membership Number'], [200, 'xxxx-xxxxxx-71009']],
      [[40, 'Statement Date'], [200, '14 October 2026']],
      [[40, 'Credit Limit'], [200, '£5,000.00']],
      [[40, 'Minimum Payment'], [200, '£25.00']],
      [[40, 'Previous Balance'], [200, '£1,000.00']],
      [[40, 'New Balance'], [200, '£434.10']],
      [[40, 'Payments']],
      [[40, 'Date'], [100, 'Transaction Details'], [480, 'Amount £']],
      [[40, 'Sep 18'], [100, 'PAYMENT RECEIVED - THANK YOU'], [480, '1,000.00 CR']],
      [[40, 'New Transactions for Card Member'], [300, 'J SMITH']],
      [[40, 'Sep 16'], [100, 'TESCO STORES 2345'], [300, 'LONDON'], [480, '45.67']],
      [[40, 'Sep 20'], [100, 'TFL TRAVEL CH'], [300, 'TFL.GOV.UK/CP'], [480, '6.80 *']],
      [[40, 'Oct 02'], [100, 'AMAZON.CO.UK*AB1CD']],
      [[100, 'AMAZON.CO.UK LUXEMBOURG'], [480, '19.99']],
      [[40, 'Oct 05'], [100, 'REFUND DISHOOM'], [300, 'LONDON'], [480, '-12.50']]
    ])
    const s = parsePdfStatement(await extractPdfText(makePdf([page])))
    expect(s.account).toEqual({ externalId: '****1009', type: 'credit_card', institution: 'American Express' })
    expect(rows(s)).toEqual([
      ['2026-09-18', 100000, 'PAYMENT RECEIVED - THANK YOU'],
      ['2026-09-16', -4567, 'TESCO STORES 2345 LONDON'],
      ['2026-09-20', -680, 'TFL TRAVEL CH TFL.GOV.UK/CP'],
      ['2026-10-02', -1999, 'AMAZON.CO.UK*AB1CD AMAZON.CO.UK LUXEMBOURG'],
      ['2026-10-05', 1250, 'REFUND DISHOOM LONDON']
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-10-14', balance: -43410 })
  })

  it('Yonder: day-first numeric dates on a British statement, £ signs', () => {
    const text = [
      'Yonder',
      'Statement date 12/10/2026',
      'Credit limit £3,000.00',
      'Minimum payment £25.00',
      'Date Description Amount',
      '01/10/2026 Pret A Manger £4.50',
      '05/10/2026 Payment received -£500.00',
      '09/10/2026 Dishoom London £62.00'
    ].join('\n')
    const s = parsePdfStatement(text)
    expect(s.dateFormat).toBe('DMY')
    expect(s.account?.institution).toBe('Yonder')
    expect(rows(s)).toEqual([
      ['2026-10-01', -450, 'Pret A Manger'],
      ['2026-10-05', 50000, 'Payment received'],
      ['2026-10-09', -6200, 'Dishoom London']
    ])
  })

  it('Revolut: newest first, money out/in columns read from the running balance, sub-lines ignored', () => {
    const text = [
      'Revolut',
      'GBP Statement',
      'Personal account',
      'Balance summary',
      'Account (Current Account) £1,000.00 £2,500.00 £3,000.00 £1,500.00',
      'Account transactions from 1 October 2026 to 31 October 2026',
      'Date Description Money out Money in Balance',
      '12 Oct 2026 Tesco £12.34 £1,487.66',
      'To: Tesco Stores, London',
      'Card: 5355**1234',
      '3 Oct 2026 Salary from ACME LTD £2,000.00 £1,500.00',
      'Reference: SALARY',
      '1 Oct 2026 To JANE DOE £500.00 −£500.00'
    ].join('\n')
    const s = parsePdfStatement(text)
    expect(s.account?.type).toBe('checking')
    expect(s.account?.institution).toBe('Revolut')
    expect(rows(s)).toEqual([
      ['2026-10-12', -1234, 'Tesco'],
      ['2026-10-03', 200000, 'Salary from ACME LTD'],
      ['2026-10-01', -50000, 'To JANE DOE']
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-10-12', balance: 148766 })
  })

  it('Wise: date printed under the description', () => {
    const text = [
      'Wise',
      'GBP statement',
      '1 October 2026 - 31 October 2026',
      'Description Incoming Outgoing Amount Balance',
      'Card transaction of 4.50 GBP issued by Pret A Manger London -4.50 2,245.67',
      '12 October 2026 Card ending in 1234 Transaction: CARD-123456789',
      'Received money from ACME LTD with reference SALARY 2,000.00 2,250.17',
      '10 October 2026 Transaction: TRANSFER-987654'
    ].join('\n')
    const s = parsePdfStatement(text)
    expect(s.account?.institution).toBe('Wise')
    expect(rows(s)).toEqual([
      ['2026-10-12', -450, 'Card transaction of 4.50 GBP issued by Pret A Manger London'],
      ['2026-10-10', 200000, 'Received money from ACME LTD with reference SALARY']
    ])
  })

  it('reads € and currency-code amounts', () => {
    const s = parsePdfStatement(['Revolut', 'EUR Statement', '2 Oct 2026 Cafe de Flore €8.40 €91.60', '4 Oct 2026 Hotel Lisboa 120.00 EUR'].join('\n'))
    expect(s.transactions.map((t) => t.amount)).toEqual([-840, -12000])
  })
})

describe('Canadian statements', () => {
  it('RBC Visa: two month-name dates, reference lines, payments with minus', async () => {
    const page = statementPage([
      [[40, 'RBC Royal Bank']],
      [[40, 'RBC Visa Infinite Avion']],
      [[40, 'STATEMENT FROM SEP 15 TO OCT 14, 2026']],
      [[40, 'Credit Limit $10,000.00'], [300, 'Minimum Payment $10.00']],
      [[40, 'TRANSACTION'], [110, 'POSTING'], [180, 'ACTIVITY DESCRIPTION'], [480, 'AMOUNT ($)']],
      [[40, 'DATE'], [110, 'DATE']],
      [[40, 'SEP 16'], [110, 'SEP 17'], [180, 'TIM HORTONS #1234 TORONTO ON'], [480, '$2.45']],
      [[180, '74500016259000123456789']],
      [[40, 'SEP 30'], [110, 'OCT 01'], [180, 'PAYMENT - THANK YOU / PAIEMENT - MERCI'], [480, '-$500.00']],
      [[40, 'OCT 05'], [110, 'OCT 06'], [180, 'AMAZON.CA AMAZON.CA ON'], [480, '$89.99']],
      [[180, 'Foreign Currency-USD 65.00 Exchange rate-1.384615']],
      [[40, 'NEW BALANCE'], [480, '$592.44']]
    ])
    const s = parsePdfStatement(await extractPdfText(makePdf([page])))
    expect(s.account?.institution).toBe('RBC')
    expect(s.account?.type).toBe('credit_card')
    expect(rows(s)).toEqual([
      ['2026-09-16', -245, 'TIM HORTONS #1234 TORONTO ON'],
      ['2026-09-30', 50000, 'PAYMENT - THANK YOU / PAIEMENT - MERCI'],
      ['2026-10-05', -8999, 'AMAZON.CA AMAZON.CA ON']
    ])
    expect(s.ledgerBalance).toEqual({ date: '2026-10-14', balance: -59244 })
  })

  it('BMO Mastercard: "Sep. 16" dates and CR payments, card number masked to last 4', () => {
    const text = [
      'BMO Bank of Montreal',
      'BMO CashBack Mastercard',
      'Statement date Oct. 14, 2026',
      'Card number 5191 2300 1111 4321',
      'Credit limit $5,000.00',
      'Trans date Post date Description Amount ($)',
      'Sep. 16 Sep. 17 LOBLAWS 1234 TORONTO ON 54.21',
      'Sep. 25 Sep. 26 PAYMENT RECEIVED - THANK YOU 300.00 CR',
      'Oct. 2 Oct. 3 NETFLIX.COM 866-579-7172 ON 16.49'
    ].join('\n')
    const s = parsePdfStatement(text)
    expect(s.account).toEqual({ externalId: '****4321', type: 'credit_card', institution: 'BMO' })
    expect(rows(s)).toEqual([
      ['2026-09-16', -5421, 'LOBLAWS 1234 TORONTO ON'],
      ['2026-09-25', 30000, 'PAYMENT RECEIVED - THANK YOU'],
      ['2026-10-02', -1649, 'NETFLIX.COM 866-579-7172 ON']
    ])
  })

  it('Rogers and Amex Canada: wrapped merchant names and year rollover', () => {
    const rogers = parsePdfStatement(
      ['Rogers Bank', 'Rogers World Elite Mastercard', 'Statement date: Jan 14, 2027', 'Credit limit $8,000.00', 'Dec 20 Dec 21 UBER CANADA/UBERTRIP TORONTO ON 23.45', 'Jan 3 Jan 4 PAYMENT, THANK YOU -200.00'].join('\n')
    )
    expect(rogers.account?.institution).toBe('Rogers Bank')
    expect(rows(rogers)).toEqual([
      ['2026-12-20', -2345, 'UBER CANADA/UBERTRIP TORONTO ON'],
      ['2027-01-03', 20000, 'PAYMENT, THANK YOU']
    ])
    const amex = parsePdfStatement(
      ['American Express Cobalt Card', 'Closing Date Oct 14, 2026', 'Minimum Payment Due $10.00', 'Oct 3 Oct 4 UBER EATS', 'TORONTO 32.10', 'Oct 1 Oct 1 PAYMENT RECEIVED - THANK YOU -250.00'].join('\n')
    )
    expect(rows(amex)).toEqual([
      ['2026-10-03', -3210, 'UBER EATS TORONTO'],
      ['2026-10-01', 25000, 'PAYMENT RECEIVED - THANK YOU']
    ])
  })
})
