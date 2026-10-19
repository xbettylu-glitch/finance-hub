import { describe, expect, it } from 'vitest'
import { spendingInsights, spendingReport } from '../src/core/analytics'
import type { Category, Transaction } from '../src/shared/types'

const cats: Category[] = [
  { id: 1, name: 'Salary', kind: 'income', color: '#0f0' },
  { id: 2, name: 'Dining', kind: 'expense', color: '#f00' },
  { id: 3, name: 'Groceries', kind: 'expense', color: '#00f' },
  { id: 4, name: 'Transfer', kind: 'transfer', color: '#ccc' }
]
let id = 1
const t = (date: string, amount: number, categoryId: number | null, payee: string): Transaction => ({ id: id++, accountId: 1, date, amount, description: payee, payee, categoryId, notes: '' })

describe('spendingReport', () => {
  const txns = [
    t('2026-08-03', -5000, 2, 'Dishoom'),
    t('2026-09-03', -3000, 2, 'Dishoom'),
    t('2026-09-04', -8000, 3, 'Tesco'),
    t('2026-09-05', 1000, 3, 'Tesco'),
    t('2026-09-06', -50000, 4, 'To savings'),
    t('2026-09-07', 200000, 1, 'ACME')
  ]
  it('sums spending by month, category and merchant, excluding transfers and income', () => {
    const r = spendingReport(txns, cats, '2026-09', 3, new Set(['Tesco']))
    expect(r.months).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(r.totals).toEqual([0, 5000, 10000])
    expect(r.averageMonths).toBe(2)
    expect(r.fixed).toEqual([0, 0, 7000])
    expect(r.categories.map((c) => [c.name, c.total, c.average])).toEqual([
      ['Dining', 8000, 4000],
      ['Groceries', 7000, 3500]
    ])
    expect(r.merchants.find((m) => m.payee === 'Tesco')).toMatchObject({ total: 8000, count: 1 })
    expect(spendingReport(txns, cats, '2026-09', 3, new Set(), 2).totals).toEqual([0, 5000, 3000])
  })
})

describe('spendingInsights', () => {
  it('flags a category above its average, many small purchases and a low savings rate', () => {
    const txns: Transaction[] = []
    for (const m of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) txns.push(t(`${m}-02`, -10000, 2, 'Dishoom'))
    txns.push(t('2026-10-03', -30000, 2, 'Hawksmoor'))
    for (let d = 1; d <= 12; d++) txns.push(t(`2026-10-${String(d).padStart(2, '0')}`, -450, 3, 'Pret'))
    const out = spendingInsights({
      txns,
      categories: cats,
      recurring: [],
      budgets: [],
      lastMonthFlow: { month: '2026-09', income: 200000, expenses: 190000, net: 10000 },
      asOf: '2026-10-15',
      currency: 'GBP'
    })
    const kinds = out.map((i) => i.kind)
    expect(kinds).toContain('category')
    expect(kinds).toContain('small')
    expect(kinds).toContain('savings')
    const dining = out.find((i) => i.kind === 'category')!
    expect(dining).toMatchObject({ categoryId: 2 })
    expect(dining.monthlySaving).toBeGreaterThan(40000)
    expect(out.find((i) => i.kind === 'savings')!.monthlySaving).toBe(30000)
    expect(out.map((i) => i.monthlySaving ?? 0)).toEqual([...out.map((i) => i.monthlySaving ?? 0)].sort((a, b) => b - a))
  })

  it('reports subscription totals and price rises', () => {
    const txns = [t('2026-08-05', -1099, null, 'Netflix'), t('2026-09-05', -1099, null, 'Netflix'), t('2026-10-05', -1299, null, 'Netflix')]
    const out = spendingInsights({
      txns,
      categories: cats,
      recurring: [{ payee: 'Netflix', frequency: 'monthly', amount: 1299, monthlyCost: 1299, lastDate: '2026-10-05', nextDate: '2026-11-05', occurrences: 3, categoryName: null }],
      budgets: [],
      lastMonthFlow: { month: '2026-09', income: 0, expenses: 0, net: 0 },
      asOf: '2026-10-15',
      currency: 'GBP'
    })
    expect(out.find((i) => i.kind === 'price_rise')).toMatchObject({ payee: 'Netflix', monthlySaving: 200 })
    expect(out.find((i) => i.kind === 'subscription')?.title).toMatch(/1 regular bill and subscription/)
  })
})
