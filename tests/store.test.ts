import { readFileSync } from 'fs'
import { join } from 'path'
import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { FinanceStore } from '../src/main/store'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

let store: FinanceStore
beforeEach(async () => {
  const SQL = await initSqlJs()
  store = new FinanceStore(new SQL.Database())
})

describe('FinanceStore', () => {
  it('seeds default categories and rules', () => {
    expect(store.listCategories().length).toBeGreaterThan(15)
    expect(store.listRules().length).toBeGreaterThan(15)
  })

  it('imports a CSV, categorizes it, sets the balance and dedupes re-imports', () => {
    const text = fixture('chase-checking.csv')
    const first = store.commitImport({ filename: 'chase.csv', text, options: {}, newAccount: { name: 'Checking', type: 'checking' } })
    expect(first).toMatchObject({ added: 4, duplicates: 0, balanceUpdated: true })
    expect(first.categorized).toBeGreaterThanOrEqual(3)

    const again = store.commitImport({ filename: 'chase.csv', text, options: {}, accountId: first.accountId })
    expect(again).toMatchObject({ added: 0, duplicates: 4 })

    const [acct] = store.listAccounts(false, '2026-10-20')
    expect(acct.balance).toBe(241588)
    expect(acct.transactionCount).toBe(4)

    const cats = new Map(store.listCategories().map((c) => [c.id, c.name]))
    const rows = store.listTransactions({}).rows
    expect(rows.map((r) => (r.categoryId ? cats.get(r.categoryId) : null))).toEqual(['Groceries', 'Salary', 'Subscriptions', 'Subscriptions'])
  })

  it('matches OFX imports to the existing account by account number', () => {
    const text = fixture('bank.ofx')
    const first = store.commitImport({ filename: 'ally.qfx', text, options: {}, newAccount: { name: 'Savings', type: 'savings' } })
    const preview = store.previewImport('ally.qfx', text, {})
    expect(preview.matchedAccountId).toBe(first.accountId)
    expect(store.commitImport({ filename: 'ally.qfx', text, options: {}, accountId: first.accountId }).duplicates).toBe(2)
  })

  it('creates rules that recategorize existing rows and survive applyRules', () => {
    const acct = store.createAccount({ name: 'Cash', type: 'cash' })
    const t = store.addTransaction({ accountId: acct.id, date: '2026-10-01', amount: -1200, description: 'Joe Corner Shop' })
    expect(t.categoryId).toBeNull()
    const shopping = store.listCategories().find((c) => c.name === 'Shopping')!
    expect(store.createRule('corner shop', shopping.id, true).updated).toBe(1)
    expect(store.listTransactions({}).rows[0].categoryName).toBe('Shopping')

    const dining = store.listCategories().find((c) => c.name === 'Dining')!
    store.updateTransaction(t.id, { categoryId: dining.id })
    store.applyRules(false)
    expect(store.listTransactions({}).rows[0].categoryName).toBe('Dining')
  })

  it('builds a holistic dashboard from demo data', () => {
    store.loadDemoData('2026-10-19')
    const d = store.getDashboard(undefined, '2026-10-19')
    expect(d.accounts).toHaveLength(7)
    expect(d.assets).toBeGreaterThan(0)
    expect(d.liabilities).toBeLessThan(0)
    expect(d.netWorth).toBe(d.assets + d.liabilities)
    expect(d.netWorthSeries).toHaveLength(12)
    expect(d.netWorthSeries[11].netWorth).toBe(d.netWorth)
    expect(d.cashFlow).toHaveLength(12)
    const sept = store.getDashboard('2026-09', '2026-10-19')
    expect(sept.monthIncome).toBeGreaterThan(sept.monthExpenses)
    expect(sept.spending.map((s) => s.name)).toContain('Groceries')
    expect(sept.spending.map((s) => s.name)).not.toContain('Credit Card Payment')
    expect(d.recurring.map((r) => r.payee)).toEqual(expect.arrayContaining(['Netflix.com', 'Spotify USA']))
    expect(d.budgets.length).toBeGreaterThan(0)
    expect(d.uncategorizedCount).toBe(0)
  })

  it('reset wipes data but keeps defaults', () => {
    store.loadDemoData('2026-10-19')
    store.resetAll()
    expect(store.listAccounts()).toEqual([])
    expect(store.listCategories().length).toBeGreaterThan(15)
  })
})
