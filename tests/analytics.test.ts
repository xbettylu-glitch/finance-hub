import { describe, expect, it } from 'vitest'
import { BalanceCalculator, cashFlow, detectRecurring, spendingByCategory } from '../src/core/analytics'
import { categorize, compileRule, findTransferPairs } from '../src/core/categorize'
import { fingerprintAll } from '../src/core/dedupe'
import type { Category, Transaction } from '../src/shared/types'

const cats: Category[] = [
  { id: 1, name: 'Salary', kind: 'income', color: '#0f0' },
  { id: 2, name: 'Dining', kind: 'expense', color: '#f00' },
  { id: 3, name: 'Transfer', kind: 'transfer', color: '#ccc' }
]
let nextId = 1
const t = (date: string, amount: number, categoryId: number | null = null, payee = 'X', accountId = 1): Transaction => ({
  id: nextId++,
  accountId,
  date,
  amount,
  description: payee,
  payee,
  categoryId,
  notes: ''
})

describe('BalanceCalculator', () => {
  const txns = [t('2026-01-05', -1000), t('2026-01-10', 5000), t('2026-02-01', -2000)]

  it('runs a cumulative sum when there is no snapshot', () => {
    const c = new BalanceCalculator(txns, [])
    expect(c.balanceAt('2026-01-04')).toBe(0)
    expect(c.balanceAt('2026-01-31')).toBe(4000)
    expect(c.balanceAt('2026-03-01')).toBe(2000)
  })

  it('anchors forwards and backwards on snapshots', () => {
    const c = new BalanceCalculator(txns, [{ id: 1, accountId: 1, date: '2026-01-10', balance: 100_000 }])
    expect(c.balanceAt('2026-01-10')).toBe(100_000)
    expect(c.balanceAt('2026-02-15')).toBe(98_000)
    expect(c.balanceAt('2026-01-07')).toBe(95_000)
    expect(c.balanceAt('2026-01-01')).toBe(96_000)
  })

  it('uses the latest snapshot on or before the date', () => {
    const c = new BalanceCalculator([], [
      { id: 1, accountId: 1, date: '2026-01-31', balance: 10 },
      { id: 2, accountId: 1, date: '2026-02-28', balance: 20 }
    ])
    expect(c.balanceAt('2026-02-27')).toBe(10)
    expect(c.balanceAt('2026-03-10')).toBe(20)
  })
})

describe('cash flow and spending', () => {
  const txns = [
    t('2026-03-01', 500_000, 1),
    t('2026-03-02', -4_000, 2),
    t('2026-03-03', 1_000, 2),
    t('2026-03-04', -100_000, 3),
    t('2026-03-05', -2_500, null)
  ]

  it('excludes transfers and nets refunds against spending', () => {
    const [p] = cashFlow(txns, cats, '2026-03', 1)
    expect(p).toEqual({ month: '2026-03', income: 500_000, expenses: 5_500, net: 494_500 })
  })

  it('groups spending by category including uncategorized', () => {
    expect(spendingByCategory(txns, cats, '2026-03').map((s) => [s.name, s.amount])).toEqual([
      ['Dining', 3_000],
      ['Uncategorized', 2_500]
    ])
  })
})

describe('detectRecurring', () => {
  it('finds monthly subscriptions and ignores irregular spending', () => {
    const txns = [
      t('2026-06-04', -1549, 2, 'Netflix'),
      t('2026-07-04', -1549, 2, 'Netflix'),
      t('2026-08-04', -1549, 2, 'Netflix'),
      t('2026-09-04', -1549, 2, 'Netflix'),
      t('2026-06-01', -500, 2, 'Cafe'),
      t('2026-06-03', -2500, 2, 'Cafe'),
      t('2026-08-20', -900, 2, 'Cafe')
    ]
    const r = detectRecurring(txns, cats, '2026-09-20')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ payee: 'Netflix', frequency: 'monthly', amount: 1549, nextDate: '2026-10-04', occurrences: 4 })
  })

  it('drops subscriptions that stopped', () => {
    const txns = ['2026-01-04', '2026-02-04', '2026-03-04'].map((d) => t(d, -999, 2, 'Old'))
    expect(detectRecurring(txns, cats, '2026-09-01')).toEqual([])
  })
})

describe('rules', () => {
  it('matches on word boundaries and respects order', () => {
    const rules = [compileRule('uber eats', 2)!, compileRule('uber', 9)!, compileRule('rent', 7)!]
    expect(categorize(rules, 'UBER EATS SF', '')).toBe(2)
    expect(categorize(rules, 'UBER *TRIP', '')).toBe(9)
    expect(categorize(rules, 'PARENTS GIFT', '')).toBeNull()
    expect(categorize(rules, 'RENT OCT', '')).toBe(7)
  })

  it('pairs transfers across accounts', () => {
    const a = t('2026-01-03', -80_000, null, 'to sav', 1)
    const b = t('2026-01-04', 80_000, null, 'from chk', 2)
    const c = t('2026-01-04', 80_000, null, 'same account', 1)
    expect(findTransferPairs([a, c, b])).toEqual([[a.id, b.id]])
  })
})

describe('fingerprintAll', () => {
  it('keeps identical same-day rows distinct but stable across re-imports', () => {
    const rows = [
      { date: '2026-01-01', amount: -500, description: 'Coffee' },
      { date: '2026-01-01', amount: -500, description: 'Coffee' }
    ]
    const a = fingerprintAll(1, rows)
    expect(new Set(a).size).toBe(2)
    expect(fingerprintAll(1, rows)).toEqual(a)
    expect(fingerprintAll(1, [{ ...rows[0], fitId: 'F1' }])).toEqual(['1|fit|F1'])
  })
})
