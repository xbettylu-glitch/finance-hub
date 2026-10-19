import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { crossRate, currencyForLocale, detectCurrency } from '../src/core/currency'
import { FinanceStore } from '../src/main/store'

describe('currency helpers', () => {
  it('detects a statement currency', () => {
    expect(detectCurrency('Tesco £12.34\nPret £4.50')).toBe('GBP')
    expect(detectCurrency('GBP statement\nCard transaction of 4.50 EUR 4.50\nHotel 120.00 EUR')).toBe('GBP')
    expect(detectCurrency('<OFX><CURDEF>CAD<BANKACCTFROM>')).toBe('CAD')
    expect(detectCurrency('RBC Royal Bank\nTIM HORTONS $2.45\nNEW BALANCE $592.44')).toBe('CAD')
    expect(detectCurrency('Chase\nAMAZON $45.67')).toBe('USD')
    expect(detectCurrency('Cafe €8.40')).toBe('EUR')
    expect(detectCurrency('no money here')).toBeNull()
  })

  it('picks a home currency from the locale', () => {
    expect(currencyForLocale('en-GB')).toBe('GBP')
    expect(currencyForLocale('en_CA')).toBe('CAD')
    expect(currencyForLocale('fr-FR')).toBe('EUR')
    expect(currencyForLocale('en')).toBe('USD')
  })

  it('computes cross rates through EUR', () => {
    expect(crossRate({ GBP: 0.85, CAD: 1.6 }, 'CAD', 'GBP')).toBeCloseTo(0.53125)
    expect(crossRate({ GBP: 0.85 }, 'EUR', 'GBP')).toBe(0.85)
    expect(crossRate({ GBP: 0.85 }, 'CAD', 'GBP')).toBeNull()
  })
})

describe('multi-currency store', () => {
  let store: FinanceStore
  let SQL: Awaited<ReturnType<typeof initSqlJs>>
  beforeEach(async () => {
    SQL = await initSqlJs()
    store = new FinanceStore(new SQL.Database(), () => {}, 'GBP')
  })

  it('converts totals to the home currency and flags missing rates', () => {
    const gbp = store.createAccount({ name: 'Current', type: 'checking', openingBalance: 100_000, openingBalanceDate: '2026-10-01' })
    const cad = store.createAccount({ name: 'RBC', type: 'checking', currency: 'CAD', openingBalance: 160_000, openingBalanceDate: '2026-10-01' })
    expect(gbp.currency).toBe('GBP')
    expect(cad.currency).toBe('CAD')

    let d = store.getDashboard(undefined, '2026-10-19')
    expect(d.homeCurrency).toBe('GBP')
    expect(d.missingRates).toEqual(['CAD'])
    expect(store.ratesStale()).toBe(true)

    store.saveRates('2026-10-16', { GBP: 0.85, CAD: 1.6, USD: 1.1 })
    expect(store.ratesStale()).toBe(false)
    d = store.getDashboard(undefined, '2026-10-19')
    expect(d.missingRates).toEqual([])
    expect(d.netWorth).toBe(100_000 + 85_000)
    const rbc = d.accounts.find((a) => a.id === cad.id)!
    expect(rbc).toMatchObject({ balance: 160_000, balanceHome: 85_000 })

    store.setExchangeRate('CAD', 0.5)
    expect(store.getDashboard(undefined, '2026-10-19').netWorth).toBe(180_000)
    expect(store.getCurrencySettings().rates).toEqual([{ currency: 'CAD', homePerUnit: 0.5, manual: true }])

    store.setHomeCurrency('CAD')
    expect(store.getCurrencySettings()).toMatchObject({ homeCurrency: 'CAD', rates: [{ currency: 'GBP', manual: false }] })
    expect(store.getDashboard(undefined, '2026-10-19').netWorth).toBe(160_000 + Math.round(100_000 * (1.6 / 0.85)))
  })

  it('converts spending and budgets, and keeps transactions in their own currency', () => {
    store.saveRates('2026-10-16', { GBP: 0.85, CAD: 1.7 })
    const cad = store.createAccount({ name: 'RBC', type: 'checking', currency: 'CAD' })
    store.addTransaction({ accountId: cad.id, date: '2026-10-05', amount: -10_000, description: 'LOBLAWS 1234' })
    const row = store.listTransactions({}).rows[0]
    expect(row).toMatchObject({ amount: -10_000, currency: 'CAD' })
    expect(store.getDashboard('2026-10', '2026-10-19').monthExpenses).toBe(5_000)
    expect(store.transactionsCsv().split('\n')[0]).toBe('Date,Account,Description,Payee,Category,Amount,Currency,Notes')
  })

  it('only matches transfers between accounts in the same currency', () => {
    const a = store.createAccount({ name: 'A', type: 'checking' })
    const b = store.createAccount({ name: 'B', type: 'savings' })
    const c = store.createAccount({ name: 'C', type: 'checking', currency: 'CAD' })
    store.addTransaction({ accountId: a.id, date: '2026-10-05', amount: -5_000, description: 'QQQ MOVE 1' })
    store.addTransaction({ accountId: c.id, date: '2026-10-05', amount: 5_000, description: 'QQQ MOVE 2' })
    expect(store.applyRules(true)).toBe(0)
    store.addTransaction({ accountId: b.id, date: '2026-10-06', amount: 5_000, description: 'QQQ MOVE 3' })
    expect(store.applyRules(true)).toBe(2)
    const cats = new Map(store.listCategories().map((x) => [x.id, x.name]))
    const byAccount = new Map(store.listTransactions({}).rows.map((r) => [r.accountId, r.categoryId ? cats.get(r.categoryId) : null]))
    expect(byAccount.get(c.id)).toBeNull()
    expect(byAccount.get(b.id)).toBe('Transfer')
  })

  it('can relabel accounts when the main currency was guessed wrong', () => {
    const fresh = new FinanceStore(new SQL.Database(), () => {}, 'USD')
    fresh.createAccount({ name: 'Current', type: 'checking', openingBalance: 1_000 })
    fresh.createAccount({ name: 'RBC', type: 'checking', currency: 'CAD' })
    fresh.setHomeCurrency('GBP', true)
    expect(fresh.listAccounts().map((a) => [a.name, a.currency])).toEqual([
      ['Current', 'GBP'],
      ['RBC', 'CAD']
    ])
    expect(fresh.getCurrencySettings().accountCounts).toEqual({ GBP: 1, CAD: 1 })
  })

  it('gives a currency to accounts added by an older app version after the upgrade', () => {
    const db = new SQL.Database()
    const first = new FinanceStore(db, () => {}, 'GBP')
    first.createAccount({ name: 'Old', type: 'credit_card' })
    db.run("UPDATE accounts SET currency = ''")
    expect(new FinanceStore(db, () => {}, 'USD').listAccounts()[0].currency).toBe('GBP')
  })

  it('upgrades an existing database: accounts get the home currency', () => {
    const db = new SQL.Database()
    const old = new FinanceStore(db)
    old.createAccount({ name: 'Old', type: 'checking' })
    db.exec('ALTER TABLE accounts DROP COLUMN currency; DROP TABLE settings; DROP TABLE fx_rates; DROP TABLE fx_manual; PRAGMA user_version = 1')
    const upgraded = new FinanceStore(db, () => {}, 'GBP')
    expect(upgraded.homeCurrency()).toBe('GBP')
    expect(upgraded.listAccounts()[0].currency).toBe('GBP')
  })

  it('suggests the statement currency in the import preview', () => {
    expect(store.previewImport('s.csv', 'Date,Description,Amount\n2026-10-01,Tesco £,-12.34\n', {}).currency).toBe('GBP')
  })
})
