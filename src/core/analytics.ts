import type {
  Account,
  BalanceSnapshot,
  Budget,
  BudgetProgress,
  CashFlowPoint,
  Category,
  CategorySpend,
  Insight,
  MerchantSeries,
  NetWorthPoint,
  RecurringFrequency,
  RecurringItem,
  SpendingSeries,
  Transaction
} from '../shared/types'
import { isLiability } from '../shared/types'
import { addDays, addMonths, daysBetween, daysInMonth, monthEnd, monthOf, monthRange } from './dates'

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

/** Spending per category, per merchant and fixed vs flexible for each of `months` months ending at `lastMonth`. */
export function spendingReport(
  txns: Transaction[],
  categories: Category[],
  lastMonth: string,
  months: number,
  fixedPayees: Set<string>,
  categoryId?: number | 'uncategorized'
): { months: string[]; averageMonths: number; totals: number[]; fixed: number[]; flexible: number[]; categories: SpendingSeries[]; merchants: MerchantSeries[] } {
  const kinds = kindMap(categories)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const range = monthRange(lastMonth, months)
  const idx = new Map(range.map((m, i) => [m, i]))
  const zeros = (): number[] => range.map(() => 0)
  const totals = zeros()
  const fixed = zeros()
  const flexible = zeros()
  const byCategory = new Map<number | null, number[]>()
  const byMerchant = new Map<string, { monthly: number[]; count: number }>()
  for (const t of txns) {
    const i = idx.get(monthOf(t.date))
    if (i === undefined || classify(t, kinds) !== 'expense') continue
    if (categoryId !== undefined && (categoryId === 'uncategorized' ? t.categoryId !== null : t.categoryId !== categoryId)) continue
    const spend = -t.amount
    totals[i] += spend
    ;(fixedPayees.has(t.payee) ? fixed : flexible)[i] += spend
    const c = byCategory.get(t.categoryId) ?? zeros()
    c[i] += spend
    byCategory.set(t.categoryId, c)
    if (t.amount < 0) {
      const m = byMerchant.get(t.payee) ?? { monthly: zeros(), count: 0 }
      m.monthly[i] += spend
      m.count++
      byMerchant.set(t.payee, m)
    }
  }
  const first = totals.findIndex((v) => v !== 0)
  const averageMonths = first < 0 ? 0 : range.length - first
  const sum = (xs: number[]): number => xs.reduce((s, v) => s + v, 0)
  return {
    months: range,
    averageMonths,
    totals,
    fixed,
    flexible,
    categories: [...byCategory.entries()]
      .map(([id, monthly]) => {
        const c = id != null ? byId.get(id) : undefined
        const total = sum(monthly)
        return { categoryId: id, name: c?.name ?? 'Uncategorized', color: c?.color ?? '#9ca3af', monthly, total, average: averageMonths ? Math.round(total / averageMonths) : 0 }
      })
      .filter((c) => c.total > 0)
      .sort((x, y) => y.total - x.total),
    merchants: [...byMerchant.entries()]
      .map(([payee, m]) => ({ payee, monthly: m.monthly, total: sum(m.monthly), count: m.count }))
      .sort((x, y) => y.total - x.total)
      .slice(0, 20)
  }
}

/**
 * Suggestions on where to cut back, biggest estimated monthly saving first: categories running above their usual level,
 * regular bills and price rises, merchants with growing spend, many small purchases, budgets heading over, and a low
 * savings rate. `lastMonthFlow` is income and spending for the last complete month.
 */
export function spendingInsights(input: {
  txns: Transaction[]
  categories: Category[]
  recurring: RecurringItem[]
  budgets: BudgetProgress[]
  lastMonthFlow: CashFlowPoint
  asOf: string
  currency: string
}): Insight[] {
  const { txns, categories, recurring, budgets, lastMonthFlow, asOf, currency } = input
  const whole = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const exact = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const fmt = (c: number): string => whole.format(c / 100)
  const fmt2 = (c: number): string => exact.format(c / 100)
  const kinds = kindMap(categories)
  const month = monthOf(asOf)
  const day = +asOf.slice(8, 10)
  const pace = daysInMonth(+asOf.slice(0, 4), +asOf.slice(5, 7)) / Math.max(day, 1)
  const expenses = txns.filter((t) => classify(t, kinds) === 'expense' && t.amount < 0)
  const recurringPayees = new Set(recurring.map((r) => r.payee))
  const out: Insight[] = []

  // Early in the month there's too little to project, so look at last month instead.
  const current = day >= 10
  const target = current ? month : addMonths(month, -1)
  const scale = current ? pace : 1
  const when = current ? 'this month' : 'last month'
  for (const c of spendingReport(txns, categories, target, 7, new Set()).categories) {
    const history = c.monthly.slice(0, 6).filter((v) => v > 0)
    if (history.length < 2) continue
    const avg = history.reduce((s, v) => s + v, 0) / history.length
    const projected = c.monthly[6] * scale
    const over = Math.round(projected - avg)
    if (projected > avg * 1.2 && over >= 2000)
      out.push({
        id: `category-${c.categoryId}`,
        kind: 'category',
        title: `${c.name} is above your usual`,
        detail: `${current ? 'On track for' : 'You spent'} ${fmt(projected)} ${when}, against a ${fmt(avg)} monthly average.`,
        monthlySaving: over,
        categoryId: c.categoryId
      })
  }

  if (recurring.length) {
    const total = recurring.reduce((s, r) => s + r.monthlyCost, 0)
    const biggest = recurring
      .slice(0, 3)
      .map((r) => `${r.payee} (${fmt(r.monthlyCost)})`)
      .join(', ')
    out.push({
      id: 'subscriptions',
      kind: 'subscription',
      title: `${fmt(total)} a month on ${recurring.length} regular bill${recurring.length === 1 ? '' : 's'} and subscription${recurring.length === 1 ? '' : 's'}`,
      detail: `The biggest are ${biggest}. Cancel any you no longer use, and check whether a cheaper plan exists.`,
      monthlySaving: null
    })
  }
  for (const r of recurring) {
    const list = expenses.filter((t) => t.payee === r.payee).sort((x, y) => x.date.localeCompare(y.date))
    if (list.length < 2) continue
    const before = -list[list.length - 2].amount
    const latest = -list[list.length - 1].amount
    if (latest > before * 1.05 && latest - before >= 100)
      out.push({
        id: `price-${r.payee}`,
        kind: 'price_rise',
        title: `${r.payee} has gone up`,
        detail: `The latest charge was ${fmt2(latest)}, up from ${fmt2(before)}. Worth checking for a cheaper plan or a retention offer.`,
        monthlySaving: Math.round(((latest - before) * r.monthlyCost) / Math.max(r.amount, 1)),
        payee: r.payee
      })
  }

  const merchants = spendingReport(txns, categories, addMonths(month, -1), 6, new Set()).merchants
  for (const m of merchants) {
    if (recurringPayees.has(m.payee)) continue
    const before = (m.monthly[0] + m.monthly[1] + m.monthly[2]) / 3
    const recent = (m.monthly[3] + m.monthly[4] + m.monthly[5]) / 3
    if (before > 0 && recent > before * 1.5 && recent - before >= 3000)
      out.push({
        id: `merchant-${m.payee}`,
        kind: 'merchant',
        title: `More spending at ${m.payee}`,
        detail: `${fmt(recent)} a month over the last 3 months, up from ${fmt(before)} in the 3 months before.`,
        monthlySaving: Math.round(recent - before),
        payee: m.payee
      })
  }

  const since = addDays(asOf, -30)
  const small = expenses.filter((t) => t.date > since && t.date <= asOf && -t.amount < 1000 && !recurringPayees.has(t.payee))
  if (small.length >= 10) {
    const total = small.reduce((s, t) => s - t.amount, 0)
    out.push({
      id: 'small-purchases',
      kind: 'small',
      title: `${small.length} small purchases under ${fmt(1000)} in the last 30 days`,
      detail: `Coffees, snacks and the like added up to ${fmt(total)}. Cutting half of them would save about ${fmt(total / 2)} a month.`,
      monthlySaving: Math.round(total / 2)
    })
  }

  if (day >= 5)
    for (const b of budgets) {
      const projected = b.spent * pace
      if (projected > b.budget * 1.05)
        out.push({
          id: `budget-${b.categoryId}`,
          kind: 'budget',
          title: `${b.name} is heading over budget`,
          detail: `${fmt(b.spent)} spent of ${fmt(b.budget)} so far; at this pace about ${fmt(projected)} by the end of the month.`,
          monthlySaving: Math.round(projected - b.budget),
          categoryId: b.categoryId
        })
    }

  const { income, expenses: spent } = lastMonthFlow
  if (income > 0) {
    const kept = income - spent
    const rate = kept / income
    if (rate < 0.2)
      out.push({
        id: 'savings-rate',
        kind: 'savings',
        title: kept < 0 ? `You spent ${fmt(-kept)} more than you earned last month` : `You kept ${Math.round(rate * 100)}% of your income last month`,
        detail: `A common target is to save 20% of income. Spending ${fmt(0.2 * income - kept)} less a month would get you there.`,
        monthlySaving: Math.round(0.2 * income - kept)
      })
  }

  return out.sort((x, y) => (y.monthlySaving ?? 0) - (x.monthlySaving ?? 0))
}
