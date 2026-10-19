import type {
  Account,
  BalanceSnapshot,
  Budget,
  BudgetProgress,
  CashFlowPoint,
  Category,
  CategorySpend,
  NetWorthPoint,
  RecurringFrequency,
  RecurringItem,
  Transaction
} from '../shared/types'
import { isLiability } from '../shared/types'
import { addDays, daysBetween, monthEnd, monthOf, monthRange } from './dates'

/**
 * Balance history for one account. Balance on a date = anchor snapshot + transactions between
 * the anchor and that date. Snapshots are end-of-day balances. Without snapshots, the account
 * starts at 0 and the balance is the running sum of transactions.
 */
export class BalanceCalculator {
  private dates: string[] = []
  private cumulative: number[] = []
  private snapshots: BalanceSnapshot[]

  constructor(txns: Pick<Transaction, 'date' | 'amount'>[], snapshots: BalanceSnapshot[]) {
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date))
    let sum = 0
    for (const t of sorted) {
      sum += t.amount
      if (this.dates.length && this.dates[this.dates.length - 1] === t.date) {
        this.cumulative[this.cumulative.length - 1] = sum
      } else {
        this.dates.push(t.date)
        this.cumulative.push(sum)
      }
    }
    this.snapshots = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  }

  /** Sum of all transactions dated on or before `date`. */
  private sumThrough(date: string): number {
    let lo = 0
    let hi = this.dates.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.dates[mid] <= date) {
        idx = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return idx < 0 ? 0 : this.cumulative[idx]
  }

  balanceAt(date: string): number {
    let anchor: BalanceSnapshot | undefined
    for (const s of this.snapshots) {
      if (s.date <= date) anchor = s
      else break
    }
    anchor ??= this.snapshots[0]
    if (!anchor) return this.sumThrough(date)
    return anchor.balance + this.sumThrough(date) - this.sumThrough(anchor.date)
  }

  firstDate(): string | null {
    const candidates = [this.dates[0], this.snapshots[0]?.date].filter(Boolean) as string[]
    return candidates.length ? candidates.sort()[0] : null
  }
}

export function buildCalculators(
  accounts: Account[],
  txns: Transaction[],
  snapshots: BalanceSnapshot[]
): Map<number, BalanceCalculator> {
  const byAcct = new Map<number, Transaction[]>()
  for (const t of txns) {
    const l = byAcct.get(t.accountId)
    if (l) l.push(t)
    else byAcct.set(t.accountId, [t])
  }
  const snapByAcct = new Map<number, BalanceSnapshot[]>()
  for (const s of snapshots) {
    const l = snapByAcct.get(s.accountId)
    if (l) l.push(s)
    else snapByAcct.set(s.accountId, [s])
  }
  return new Map(accounts.map((a) => [a.id, new BalanceCalculator(byAcct.get(a.id) ?? [], snapByAcct.get(a.id) ?? [])]))
}

export function netWorthAt(accounts: Account[], calcs: Map<number, BalanceCalculator>, date: string): NetWorthPoint {
  let assets = 0
  let liabilities = 0
  for (const a of accounts) {
    const calc = calcs.get(a.id)
    if (!calc) continue
    const first = calc.firstDate()
    if (!first || first > date) continue
    const b = calc.balanceAt(date)
    if (isLiability(a.type) || b < 0) liabilities += b
    else assets += b
  }
  return { date, assets, liabilities, netWorth: assets + liabilities }
}

/** Month-end net worth for the last `months` months; the final point is `asOf`. */
export function netWorthSeries(
  accounts: Account[],
  calcs: Map<number, BalanceCalculator>,
  asOf: string,
  months = 12
): NetWorthPoint[] {
  return monthRange(monthOf(asOf), months).map((m) => {
    const end = monthEnd(m)
    return netWorthAt(accounts, calcs, end < asOf ? end : asOf)
  })
}

type Kind = 'income' | 'expense' | 'transfer'

export function classify(t: Pick<Transaction, 'amount' | 'categoryId'>, kinds: Map<number, Kind>): Kind {
  const kind = t.categoryId != null ? kinds.get(t.categoryId) : undefined
  if (kind) return kind
  return t.amount >= 0 ? 'income' : 'expense'
}

export function kindMap(categories: Category[]): Map<number, Kind> {
  return new Map(categories.map((c) => [c.id, c.kind]))
}

/** Income and spending per month. Transfers are excluded; refunds in expense categories reduce spending. */
export function cashFlow(txns: Transaction[], categories: Category[], lastMonth: string, months = 12): CashFlowPoint[] {
  const kinds = kindMap(categories)
  const range = monthRange(lastMonth, months)
  const idx = new Map(range.map((m, i) => [m, i]))
  const out = range.map((month) => ({ month, income: 0, expenses: 0, net: 0 }))
  for (const t of txns) {
    const i = idx.get(monthOf(t.date))
    if (i === undefined) continue
    const k = classify(t, kinds)
    if (k === 'income') out[i].income += t.amount
    else if (k === 'expense') out[i].expenses -= t.amount
  }
  for (const p of out) p.net = p.income - p.expenses
  return out
}

export function spendingByCategory(txns: Transaction[], categories: Category[], month: string): CategorySpend[] {
  const kinds = kindMap(categories)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<number | null, number>()
  for (const t of txns) {
    if (monthOf(t.date) !== month || classify(t, kinds) !== 'expense') continue
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) - t.amount)
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([categoryId, amount]) => {
      const c = categoryId != null ? byId.get(categoryId) : undefined
      return { categoryId, name: c?.name ?? 'Uncategorized', color: c?.color ?? '#9ca3af', amount }
    })
    .sort((a, b) => b.amount - a.amount)
}

export function topMerchants(txns: Transaction[], categories: Category[], month: string, limit = 8): { payee: string; amount: number; count: number }[] {
  const kinds = kindMap(categories)
  const totals = new Map<string, { amount: number; count: number }>()
  for (const t of txns) {
    if (monthOf(t.date) !== month || classify(t, kinds) !== 'expense' || t.amount >= 0) continue
    const cur = totals.get(t.payee) ?? { amount: 0, count: 0 }
    cur.amount -= t.amount
    cur.count++
    totals.set(t.payee, cur)
  }
  return [...totals.entries()]
    .map(([payee, v]) => ({ payee, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

export function budgetProgress(budgets: Budget[], spending: CategorySpend[], categories: Category[]): BudgetProgress[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const spent = new Map(spending.map((s) => [s.categoryId, s.amount]))
  return budgets
    .filter((b) => b.amount > 0 && byId.has(b.categoryId))
    .map((b) => {
      const c = byId.get(b.categoryId)!
      return { categoryId: b.categoryId, name: c.name, color: c.color, budget: b.amount, spent: spent.get(b.categoryId) ?? 0 }
    })
    .sort((a, b) => b.spent / b.budget - a.spent / a.budget)
}

const FREQUENCIES: { frequency: RecurringFrequency; days: number; tolerance: number; perMonth: number }[] = [
  { frequency: 'weekly', days: 7, tolerance: 2, perMonth: 52 / 12 },
  { frequency: 'biweekly', days: 14, tolerance: 3, perMonth: 26 / 12 },
  { frequency: 'monthly', days: 30.4, tolerance: 5, perMonth: 1 },
  { frequency: 'quarterly', days: 91, tolerance: 10, perMonth: 1 / 3 },
  { frequency: 'yearly', days: 365, tolerance: 15, perMonth: 1 / 12 }
]

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Detects subscriptions and bills: same payee, regular interval, similar amount, still active. */
export function detectRecurring(txns: Transaction[], categories: Category[], asOf: string): RecurringItem[] {
  const kinds = kindMap(categories)
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const groups = new Map<string, Transaction[]>()
  for (const t of txns) {
    if (t.amount >= 0 || classify(t, kinds) !== 'expense') continue
    const l = groups.get(t.payee)
    if (l) l.push(t)
    else groups.set(t.payee, [t])
  }
  const out: RecurringItem[] = []
  for (const [payee, list] of groups) {
    if (list.length < 2) continue
    list.sort((a, b) => a.date.localeCompare(b.date))
    const intervals = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date))
    const med = median(intervals)
    const freq = FREQUENCIES.find((f) => Math.abs(med - f.days) <= f.tolerance)
    if (!freq) continue
    if (list.length < (freq.frequency === 'yearly' ? 2 : 3)) continue
    const regular = intervals.filter((d) => Math.abs(d - freq.days) <= freq.tolerance * 1.5).length
    if (regular / intervals.length < 0.75) continue
    const amounts = list.map((t) => -t.amount)
    const medAmt = median(amounts)
    const similar = amounts.filter((a) => Math.abs(a - medAmt) <= Math.max(medAmt * 0.25, 100)).length
    if (similar / amounts.length < 0.75) continue
    const last = list[list.length - 1]
    if (daysBetween(last.date, asOf) > freq.days * 2 + freq.tolerance) continue
    let nextDate = addDays(last.date, Math.round(freq.days))
    while (nextDate < asOf) nextDate = addDays(nextDate, Math.round(freq.days))
    const recentAmount = -last.amount
    out.push({
      payee,
      frequency: freq.frequency,
      amount: recentAmount,
      monthlyCost: Math.round(recentAmount * freq.perMonth),
      lastDate: last.date,
      nextDate,
      occurrences: list.length,
      categoryName: last.categoryId != null ? (names.get(last.categoryId) ?? null) : null
    })
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost)
}
