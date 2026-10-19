import { describe, expect, it } from 'vitest'
import { parsePdfStatement } from '../src/core/pdf'
import { extractPdfText } from '../src/main/pdf'
import { makePdf, statementPage } from './helpers/makePdf'

// Layouts modelled on UK and Canadian statements (names, numbers and amounts are made up).
const rows = (s: ReturnType<typeof parsePdfStatement>): [string, number, string][] => s.transactions.map((t) => [t.date, t.amount, t.description])

describe('UK statements', () => {
  it('Amex UK foreign spend: the sterling amount is the charge, not the foreign one', () => {
    const s = parsePdfStatement(
      [
        'American Express',
        'Statement Period From 6 April to 5 May 2026',
        'Date Date Transaction Details Foreign Spend Amount £',
        'Apr 8 Apr 9 UBER TRIP HTTPS://HELP.UB 128.00 6.03',
        'SOUTH AFRICAN RAND',
        'Exchange Rate 21.8803 + Nonsterling Transaction Fee .18',
        'Apr 9 Apr 9 DELIVEROO PARIS 09 8,50 7.71',
        'EUROPEAN UNION EURO',
        'Apr 20 Apr 20 PERK* TRIP LOS ANGELES 456.79'
      ].join('\n'),
      {},
      { today: '2026-10-19' }
    )
    expect(rows(s)).toEqual([
      ['2026-04-08', -603, 'UBER TRIP HTTPS://HELP.UB'],
      ['2026-04-09', -771, 'DELIVEROO PARIS 09'],
      ['2026-04-20', -45679, 'PERK* TRIP LOS ANGELES']
    ])
  })

  it('Amex UK statement period without a year on the start date; small print mentions next year', () => {
    const s = parsePdfStatement(
      [
        'American Express',
        'Statement includes payments and charges received by 5 December 2025',
        'Statement Period From 6 November to 5 December 2025',
        'With effect from 6 February 2026, your Personal Rate is changing',
        'Nov 6 Nov 6 PAYMENT RECEIVED - THANK YOU 3,424.54',
        'Nov 5 Nov 5 DELIVEROO PARIS 09 8,50 7.71',
        'Nov 30 Nov 30 WAITROSE - FULHAM LONDON 4.00',
        'Earn a reward flight by spending £15,000 before your Card anniversary date of 07-11-2026'
      ].join('\n'),
      {},
      { filename: '6_Nov_2025_-_5_Dec_2025.pdf', today: '2026-10-19' }
    )
    expect(rows(s).map((r) => [r[0], r[1]])).toEqual([
      ['2025-11-06', 342454],
      ['2025-11-05', -771],
      ['2025-11-30', -400]
    ])
  })

  it('year-less dates never land in the future, even when the statement mentions a future statement date', () => {
    const s = parsePdfStatement(
      ['American Express', 'Your next statement date is 5 December 2026', 'Balance £15.00', 'Nov 12 TESCO STORES 10.00', 'Dec 03 BOOTS 5.00'].join('\n'),
      {},
      { today: '2026-10-19' }
    )
    expect(rows(s).map((r) => r[0])).toEqual(['2025-11-12', '2025-12-03'])
  })

  it('UK day-first dates are not flipped by amounts at the start of a line', () => {
    const s = parsePdfStatement(
      ['American Express', 'Statement Date 14/10/2026', 'Balance £434.10', '5.20', '05/10 TESCO STORES 45.67', '06/10 BOOTS 3.20'].join('\n')
    )
    expect(s.dateFormat).toBe('DMY')
    expect(rows(s).map((r) => r[0])).toEqual(['2026-10-05', '2026-10-06'])
  })

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

  it('Amex: payments printed without a sign, CR in its own column, card detected from the issuer name', async () => {
    const page = statementPage([
      [[40, 'American Express']],
      [[40, 'Statement Date 14 October 2026']],
      [[40, 'New Transactions']],
      [[40, 'Sep 18'], [100, 'PAYMENT RECEIVED - THANK YOU'], [480, '500.00']],
      [[40, 'Sep 19'], [100, 'DIRECT DEBIT PAYMENT'], [440, '250.00'], [500, 'CR']],
      [[40, 'Sep 20'], [100, 'REFUND JOHN LEWIS'], [480, '£30.00']],
      [[40, 'Sep 21'], [100, 'WAITROSE 123 LONDON'], [480, '£42.10']]
    ])
    const s = parsePdfStatement(await extractPdfText(makePdf([page])))
    expect(s.account?.type).toBe('credit_card')
    expect(rows(s).map(([, amount, description]) => [description, amount])).toEqual([
      ['PAYMENT RECEIVED - THANK YOU', 50000],
      ['DIRECT DEBIT PAYMENT', 25000],
      ['REFUND JOHN LEWIS', 3000],
      ['WAITROSE 123 LONDON', -4210]
    ])
  })

  it('Amex UK: purchases after a "Payments and Credits" heading stay charges when credits are marked CR', () => {
    const text = [
      'American Express',
      'Statement Date 14 October 2026',
      'Payments and Credits',
      'Sep 18 AUTOMATIC PAYMENT RECEIVED - THANK YOU 1,000.00 CR',
      'Card Member J SMITH',
      'Sep 16 TESCO STORES 2345 LONDON 45.67',
      'Sep 20 PRET A MANGER LONDON 4.50',
      'Sep 22 JOHN LEWIS REFUND 30.00 CR'
    ].join('\n')
    expect(parsePdfStatement(text).transactions.map((t) => t.amount)).toEqual([100000, -4567, -450, 3000])
  })

  it('Amex UK: unsigned statement, purchases after a Payments heading are still charges', () => {
    const text = [
      'American Express',
      'Statement Date 5 October 2026',
      'Payments',
      'Sep 11 THE NED HOTEL NICKEL BA LONDON 36.64',
      'Sep 14 APPLE STORE R329 LONDON 349.00',
      'Oct 02 ASDA STORES IPSWICH 15.00',
      'Sep 15 AUTOMATIC PAYMENT RECEIVED - THANK YOU 1,770.58'
    ].join('\n')
    expect(parsePdfStatement(text).transactions.map((t) => t.amount)).toEqual([-3664, -34900, -1500, 177058])
  })

  it('Yonder: "+" refunds are money in, whole-pound amounts and &amp; entities are read', () => {
    const s = parsePdfStatement(
      ['Yonder', 'Statement date 12/10/2026', 'Credit limit £3,000.00', 'Date Description Amount',
        '01/10/2026 Yonder Membership £15', '01/10/2026 Dishoom London £62.00', '03/10/2026 Dishoom London +£31.00',
        '03/10/2026 Wasabi Sushi &amp; Bento £2.95', '04/10/2026 Yonder reimbursement £10.00', '06/10/2026 Pret A Manger £4.50'
      ].join('\n'),
      {},
      { today: '2026-10-19' }
    )
    expect(rows(s)).toEqual([
      ['2026-10-01', -1500, 'Yonder Membership'],
      ['2026-10-01', -6200, 'Dishoom London'],
      ['2026-10-03', 3100, 'Dishoom London'],
      ['2026-10-03', -295, 'Wasabi Sushi & Bento'],
      ['2026-10-04', 1000, 'Yonder reimbursement'],
      ['2026-10-06', -450, 'Pret A Manger']
    ])
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
      ['Rogers Bank', 'Rogers World Elite Mastercard', 'Statement date: Jan 14, 2027', 'Credit limit $8,000.00', 'Dec 20 Dec 21 UBER CANADA/UBERTRIP TORONTO ON 23.45', 'Jan 3 Jan 4 PAYMENT, THANK YOU -200.00'].join('\n'),
      {},
      { today: '2027-02-01' }
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

describe('statement year', () => {
  it('uses the labelled statement date, not later years in the small print', () => {
    const text = [
      'American Express',
      'Statement Date 5 October 2025',
      'Important: changes to your terms from 1 February 2026',
      'Sep 14 APPLE STORE R329 LONDON 349.00',
      'Oct 02 ASDA STORES IPSWICH 15.00'
    ].join('\n')
    expect(parsePdfStatement(text, {}, { today: '2026-10-19' }).transactions.map((t) => t.date)).toEqual(['2025-09-14', '2025-10-02'])
  })

  it('uses the end of a date range, then the file name, when there is no statement date', () => {
    const range = ['Revolut', 'Statement 1 Sep 2025 to 30 Sep 2025', '12 Sep Tesco 12.34'].join('\n')
    expect(parsePdfStatement(range, {}, { today: '2026-10-19' }).transactions[0].date).toBe('2025-09-12')
    const bare = ['American Express', 'Sep 14 APPLE STORE 349.00'].join('\n')
    expect(parsePdfStatement(bare, {}, { filename: 'Statement Oct 2025.pdf', today: '2026-10-19' }).transactions[0].date).toBe('2025-09-14')
    expect(parsePdfStatement(bare, {}, { today: '2026-10-19' }).transactions[0].date).toBe('2026-09-14')
    expect(parsePdfStatement(['American Express', 'Dec 14 APPLE STORE 349.00'].join('\n'), {}, { today: '2026-10-19' }).transactions[0].date).toBe('2025-12-14')
  })
})
