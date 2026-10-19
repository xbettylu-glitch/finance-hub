export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'investment'
  | 'retirement'
  | 'crypto'
  | 'cash'
  | 'property'
  | 'vehicle'
  | 'loan'
  | 'mortgage'
  | 'other_asset'
  | 'other_liability'

export const ACCOUNT_TYPES: { type: AccountType; label: string; liability: boolean; group: string }[] = [
  { type: 'checking', label: 'Checking', liability: false, group: 'Cash' },
  { type: 'savings', label: 'Savings', liability: false, group: 'Cash' },
  { type: 'cash', label: 'Cash / Wallet', liability: false, group: 'Cash' },
  { type: 'investment', label: 'Brokerage', liability: false, group: 'Investments' },
  { type: 'retirement', label: 'Retirement (401k/IRA)', liability: false, group: 'Investments' },
  { type: 'crypto', label: 'Crypto', liability: false, group: 'Investments' },
  { type: 'property', label: 'Real estate', liability: false, group: 'Property' },
  { type: 'vehicle', label: 'Vehicle', liability: false, group: 'Property' },
  { type: 'other_asset', label: 'Other asset', liability: false, group: 'Property' },
  { type: 'credit_card', label: 'Credit card', liability: true, group: 'Credit cards' },
  { type: 'loan', label: 'Loan', liability: true, group: 'Loans' },
  { type: 'mortgage', label: 'Mortgage', liability: true, group: 'Loans' },
  { type: 'other_liability', label: 'Other liability', liability: true, group: 'Loans' }
]

export function isLiability(type: AccountType): boolean {
  return ACCOUNT_TYPES.find((t) => t.type === type)?.liability ?? false
}

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPES.find((t) => t.type === type)?.label ?? type
}

export function accountGroup(type: AccountType): string {
  return ACCOUNT_TYPES.find((t) => t.type === type)?.group ?? 'Other'
}

/** All money values are integer cents. Asset balances are positive, liability balances negative. */
export interface Account {
  id: number
  name: string
  institution: string
  type: AccountType
  /** ISO 4217 code; the account's amounts are in this currency. */
  currency: string
  externalId: string | null
  archived: boolean
  createdAt: string
}

export interface AccountWithBalance extends Account {
  balance: number
  /** `balance` converted to the home currency. */
  balanceHome: number
  lastActivity: string | null
  transactionCount: number
}

export interface NewAccount {
  name: string
  institution?: string
  type: AccountType
  currency?: string
  externalId?: string | null
  openingBalance?: number
  openingBalanceDate?: string
}

export type CategoryKind = 'income' | 'expense' | 'transfer'

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  color: string
}

export interface Transaction {
  id: number
  accountId: number
  date: string
  amount: number
  description: string
  payee: string
  categoryId: number | null
  notes: string
}

export interface TransactionRow extends Transaction {
  accountName: string
  currency: string
  categoryName: string | null
  categoryColor: string | null
}

export interface NewTransaction {
  accountId: number
  date: string
  amount: number
  description: string
  categoryId?: number | null
  notes?: string
}

export interface BalanceSnapshot {
  id: number
  accountId: number
  date: string
  balance: number
}

export interface Rule {
  id: number
  pattern: string
  categoryId: number
  priority: number
}

export interface Budget {
  categoryId: number
  amount: number
}

export interface TxnQuery {
  accountId?: number
  categoryId?: number | 'uncategorized'
  search?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface ColumnMapping {
  date: number
  description: number
  amount?: number
  debit?: number
  credit?: number
  balance?: number
  type?: number
}

export type DateFormat = 'auto' | 'YMD' | 'MDY' | 'DMY'

export interface ImportOptions {
  mapping?: ColumnMapping
  dateFormat?: DateFormat
  invertAmounts?: boolean
}

export interface ParsedTransaction {
  date: string
  amount: number
  description: string
  fitId?: string
}

export interface StatementAccountInfo {
  externalId?: string
  type?: AccountType
  institution?: string
}

export interface ParsedStatement {
  format: 'csv' | 'ofx' | 'pdf'
  transactions: ParsedTransaction[]
  headers?: string[]
  mapping?: ColumnMapping
  dateFormat?: DateFormat
  account?: StatementAccountInfo
  ledgerBalance?: { date: string; balance: number }
  skippedRows: number
  errors: string[]
}

export interface ImportPreview extends ParsedStatement {
  matchedAccountId: number | null
  /** Currency printed on the statement, if any. */
  currency: string | null
  positiveShare: number
}

export interface ImportRequest {
  filename: string
  text: string
  options: ImportOptions
  accountId?: number
  newAccount?: NewAccount
  /** Indexes (into the parsed transactions) the user unticked in the preview. */
  excluded?: number[]
  /** Per-row corrections made in the preview, keyed by index into the parsed transactions. */
  edits?: Record<number, Partial<Pick<ParsedTransaction, 'date' | 'amount' | 'description'>>>
}

export interface ImportResult {
  accountId: number
  added: number
  duplicates: number
  categorized: number
  transfersMatched: number
  balanceUpdated: boolean
}

export interface NetWorthPoint {
  date: string
  assets: number
  liabilities: number
  netWorth: number
}

export interface CashFlowPoint {
  month: string
  income: number
  expenses: number
  net: number
}

export interface CategorySpend {
  categoryId: number | null
  name: string
  color: string
  amount: number
}

export interface BudgetProgress {
  categoryId: number
  name: string
  color: string
  budget: number
  spent: number
}

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurringItem {
  payee: string
  frequency: RecurringFrequency
  amount: number
  monthlyCost: number
  lastDate: string
  nextDate: string
  occurrences: number
  categoryName: string | null
}

export interface BudgetOverviewRow {
  category: Category
  budget: number
  spent: number
  average: number
}

export interface SpendingQuery {
  /** How many months to show, ending at `endMonth` (default 12). */
  months?: number
  endMonth?: string
  accountId?: number
  categoryId?: number | 'uncategorized'
}

export interface SpendingSeries {
  categoryId: number | null
  name: string
  color: string
  /** Spending per month, aligned with `SpendingReport.months`. */
  monthly: number[]
  total: number
  average: number
}

export interface MerchantSeries {
  payee: string
  monthly: number[]
  total: number
  count: number
}

export type InsightKind = 'category' | 'subscription' | 'price_rise' | 'merchant' | 'small' | 'budget' | 'savings'

/** A suggestion on where to spend less, worked out from the user's own transactions. */
export interface Insight {
  id: string
  kind: InsightKind
  title: string
  detail: string
  /** Rough monthly saving in the home currency, when one can be estimated. */
  monthlySaving: number | null
  categoryId?: number | null
  payee?: string
}

export interface SpendingReport {
  homeCurrency: string
  availableMonths: string[]
  months: string[]
  /** Months from the first one with any spending; used for averages. */
  averageMonths: number
  totals: number[]
  /** Spending at recurring bills and subscriptions vs everything else, per month. */
  fixed: number[]
  flexible: number[]
  categories: SpendingSeries[]
  merchants: MerchantSeries[]
  insights: Insight[]
}

export interface DashboardData {
  asOf: string
  /** The top suggestions on where to cut back. */
  insights: Insight[]
  /** Every total below is in this currency; account balances and transactions stay in their own currency. */
  homeCurrency: string
  /** Account currencies with no exchange rate yet; their amounts are counted 1:1. */
  missingRates: string[]
  month: string
  availableMonths: string[]
  accounts: AccountWithBalance[]
  assets: number
  liabilities: number
  netWorth: number
  netWorthChange30d: number
  netWorthSeries: NetWorthPoint[]
  cashFlow: CashFlowPoint[]
  monthIncome: number
  monthExpenses: number
  savingsRate: number | null
  avgMonthlyExpenses: number
  emergencyFundMonths: number | null
  spending: CategorySpend[]
  topMerchants: { payee: string; amount: number; count: number }[]
  budgets: BudgetProgress[]
  recurring: RecurringItem[]
  uncategorizedCount: number
  recentTransactions: TransactionRow[]
}

export interface ExchangeRate {
  currency: string
  /** Home-currency units per one unit of `currency`, or null when unknown. */
  homePerUnit: number | null
  manual: boolean
}

export interface CurrencySettings {
  homeCurrency: string
  /** When the European Central Bank rates were last downloaded. */
  ratesFetchedAt: string | null
  ratesDate: string | null
  /** Accounts per currency. */
  accountCounts: Record<string, number>
  /** Currencies used by accounts, other than the home currency. */
  rates: ExchangeRate[]
}

export interface FinanceApi {
  getDashboard(month?: string): Promise<DashboardData>
  listAccounts(includeArchived?: boolean): Promise<AccountWithBalance[]>
  createAccount(input: NewAccount): Promise<Account>
  updateAccount(id: number, patch: Partial<Pick<Account, 'name' | 'institution' | 'type' | 'currency' | 'archived'>>): Promise<void>
  deleteAccount(id: number): Promise<void>
  listBalances(accountId: number): Promise<BalanceSnapshot[]>
  setBalance(accountId: number, date: string, balance: number): Promise<void>
  deleteBalance(id: number): Promise<void>
  listTransactions(query: TxnQuery): Promise<{ rows: TransactionRow[]; total: number }>
  addTransaction(input: NewTransaction): Promise<Transaction>
  updateTransaction(id: number, patch: Partial<Pick<Transaction, 'categoryId' | 'notes' | 'description' | 'date' | 'amount'>>): Promise<void>
  deleteTransaction(id: number): Promise<void>
  listCategories(): Promise<Category[]>
  createCategory(input: Omit<Category, 'id'>): Promise<Category>
  updateCategory(id: number, patch: Partial<Omit<Category, 'id'>>): Promise<void>
  deleteCategory(id: number): Promise<void>
  listRules(): Promise<Rule[]>
  createRule(pattern: string, categoryId: number, applyToExisting?: boolean): Promise<{ rule: Rule; updated: number }>
  deleteRule(id: number): Promise<void>
  applyRules(onlyUncategorized: boolean): Promise<number>
  listBudgets(): Promise<Budget[]>
  setBudget(categoryId: number, amount: number): Promise<void>
  getBudgetOverview(month?: string): Promise<{ month: string; rows: BudgetOverviewRow[] }>
  getSpendingReport(query?: SpendingQuery): Promise<SpendingReport>
  /** Returns the text of a PDF statement, one visual line per line, for `previewImport`/`commitImport`. */
  extractPdfText(data: Uint8Array, password?: string): Promise<string>
  previewImport(filename: string, text: string, options: ImportOptions): Promise<ImportPreview>
  commitImport(request: ImportRequest): Promise<ImportResult>
  loadDemoData(): Promise<void>
  resetAll(): Promise<void>
  exportBackup(): Promise<string | null>
  exportTransactionsCsv(): Promise<string | null>
  getDataPath(): Promise<string>
  getCurrencySettings(): Promise<CurrencySettings>
  /** With `moveAccounts`, accounts in the old main currency are relabelled to the new one (amounts unchanged). */
  setHomeCurrency(code: string, moveAccounts?: boolean): Promise<void>
  /** Sets a manual rate (home-currency units per unit), or clears it with null to use the downloaded rate. */
  setExchangeRate(currency: string, homePerUnit: number | null): Promise<void>
  /** Downloads European Central Bank rates when they are stale (or always with `force`). Returns an error message on failure. */
  refreshRates(force?: boolean): Promise<{ updated: boolean; error?: string }>
}
