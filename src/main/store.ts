import { randomUUID } from 'crypto'
import type { Database, SqlValue } from 'sql.js'
import {
  buildCalculators,
  budgetProgress,
  cashFlow,
  detectRecurring,
  netWorthAt,
  netWorthSeries,
  spendingByCategory,
  spendingInsights,
  spendingReport,
  topMerchants
} from '../core/analytics'
import { categorize, compileRule, DEFAULT_CATEGORIES, DEFAULT_RULES, findTransferPairs, normalizePayee, type CompiledRule } from '../core/categorize'
import { crossRate, detectCurrency, isCurrency } from '../core/currency'
import { parseCsv } from '../core/csv'
import { addDays, addMonths, monthOf, parseDate, todayIso } from '../core/dates'
import { fingerprintAll } from '../core/dedupe'
import { generateDemoData } from '../core/demo'
import { looksLikeOfx, parseOfx } from '../core/ofx'
import { parsePdfStatement } from '../core/pdf'
import type {
  Account,
  AccountWithBalance,
  BalanceSnapshot,
  Budget,
  BudgetOverviewRow,
  Category,
  DashboardData,
  ImportOptions,
  ImportPreview,
  ImportRequest,
  ImportResult,
  NewAccount,
  NewTransaction,
  ParsedStatement,
  Rule,
  Transaction,
  TransactionRow,
  TxnQuery,
  CurrencySettings,
  Insight,
  RecurringItem,
  SpendingQuery,
  SpendingReport
} from '../shared/types'

const SCHEMA = `
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  external_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  color TEXT NOT NULL
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  payee TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category_locked INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL UNIQUE,
  import_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_txn_account_date ON transactions(account_id, date);
CREATE INDEX idx_txn_date ON transactions(date);
CREATE INDEX idx_txn_category ON transactions(category_id);
CREATE TABLE balances (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance INTEGER NOT NULL,
  UNIQUE (account_id, date)
);
CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE budgets (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL
);
CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  format TEXT NOT NULL,
  added INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
`

const USER_RULE_PRIORITY = 100

const TXN_COLUMNS = `t.id, t.account_id AS accountId, t.date, t.amount, t.description, t.payee, t.category_id AS categoryId, t.notes`

export function parseStatement(filename: string, text: string, options: ImportOptions = {}): ParsedStatement {
  if (/\.pdf$/i.test(filename)) return parsePdfStatement(text, options)
  if (/\.(ofx|qfx|qbo)$/i.test(filename) || looksLikeOfx(text)) return parseOfx(text)
  return parseCsv(text, options)
}

export class FinanceStore {
  private compiledRules: CompiledRule[] | null = null

  constructor(
    private db: Database,
    private onChange: () => void = () => {},
    /** Home currency for a new database, usually from the computer's region. */
    private defaultHomeCurrency = 'USD'
  ) {
    this.db.run('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  // ---------- SQL helpers ----------

  private all<T>(sql: string, params: SqlValue[] = []): T[] {
    const st = this.db.prepare(sql)
    try {
      st.bind(params)
      const out: T[] = []
      while (st.step()) out.push(st.getAsObject() as T)
      return out
    } finally {
      st.free()
    }
  }

  private get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  private run(sql: string, params: SqlValue[] = []): { changes: number; lastId: number } {
    this.db.run(sql, params)
    const changes = this.db.getRowsModified()
    const lastId = Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0)
    return { changes, lastId }
  }

  private tx<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const r = fn()
      this.db.run('COMMIT')
      return r
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  private changed(): void {
    this.compiledRules = null
    this.onChange()
  }

  private migrate(): void {
    const version = Number(this.db.exec('PRAGMA user_version')[0].values[0][0])
    if (version < 1) {
      this.tx(() => {
        this.db.exec(SCHEMA)
        this.seedDefaults()
        this.db.run('PRAGMA user_version = 1')
      })
    }
    if (version < 2) {
      this.tx(() => {
        this.db.exec(`
          ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT '';
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE fx_rates (currency TEXT PRIMARY KEY, per_eur REAL NOT NULL);
          CREATE TABLE fx_manual (currency TEXT PRIMARY KEY, home_per_unit REAL NOT NULL);
        `)
        const home = isCurrency(this.defaultHomeCurrency) ? this.defaultHomeCurrency : 'USD'
        this.setSetting('home_currency', home)
        this.run("UPDATE accounts SET currency = ? WHERE currency = ''", [home])
        this.db.run('PRAGMA user_version = 2')
      })
    }
  }

  private getSetting(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null
  }

  private setSetting(key: string, value: string): void {
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
  }

  private seedDefaults(): void {
    for (const c of DEFAULT_CATEGORIES) this.run('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)', [c.name, c.kind, c.color])
    const ids = new Map(this.listCategories().map((c) => [c.name, c.id]))
    for (const r of DEFAULT_RULES) this.run('INSERT INTO rules (pattern, category_id, priority) VALUES (?, ?, 0)', [r.pattern, ids.get(r.category)!])
  }

  // ---------- accounts & balances ----------

  private rawAccounts(includeArchived = true): Account[] {
    return this.all<Omit<Account, 'archived'> & { archived: number }>(
      `SELECT id, name, institution, type, currency, external_id AS externalId, archived, created_at AS createdAt FROM accounts
       ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`
    ).map((a) => ({ ...a, archived: Boolean(a.archived) }))
  }

  private allTransactions(): Transaction[] {
    return this.all<Transaction>(`SELECT ${TXN_COLUMNS} FROM transactions t`)
  }

  private allSnapshots(): BalanceSnapshot[] {
    return this.all<BalanceSnapshot>('SELECT id, account_id AS accountId, date, balance FROM balances')
  }

  listAccounts(includeArchived = false, asOf = todayIso()): AccountWithBalance[] {
    const accounts = this.rawAccounts(includeArchived)
    const calcs = buildCalculators(accounts, this.allTransactions(), this.allSnapshots())
    const stats = new Map(
      this.all<{ accountId: number; n: number; last: string | null }>(
        `SELECT account_id AS accountId, COUNT(*) AS n, MAX(date) AS last FROM transactions GROUP BY account_id`
      ).map((s) => [s.accountId, s])
    )
    const lastSnap = new Map(
      this.all<{ accountId: number; last: string }>('SELECT account_id AS accountId, MAX(date) AS last FROM balances GROUP BY account_id').map((s) => [s.accountId, s.last])
    )
    const { toHome } = this.converter()
    return accounts.map((a) => {
      const s = stats.get(a.id)
      const dates = [s?.last, lastSnap.get(a.id)].filter(Boolean) as string[]
      const balance = calcs.get(a.id)!.balanceAt(asOf)
      return {
        ...a,
        balance,
        balanceHome: toHome(balance, a.currency),
        lastActivity: dates.length ? dates.sort()[dates.length - 1] : null,
        transactionCount: s?.n ?? 0
      }
    })
  }

  createAccount(input: NewAccount): Account {
    const name = input.name.trim()
    if (!name) throw new Error('Account name is required')
    if (input.currency && !isCurrency(input.currency)) throw new Error(`Unsupported currency ${input.currency}`)
    const { lastId } = this.run('INSERT INTO accounts (name, institution, type, currency, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      name,
      input.institution?.trim() ?? '',
      input.type,
      input.currency || this.homeCurrency(),
      input.externalId ?? null,
      new Date().toISOString()
    ])
    if (input.openingBalance != null) this.setBalance(lastId, input.openingBalanceDate ?? todayIso(), input.openingBalance)
    this.changed()
    return this.rawAccounts().find((a) => a.id === lastId)!
  }

  updateAccount(id: number, patch: Partial<Pick<Account, 'name' | 'institution' | 'type' | 'currency' | 'archived'>>): void {
    const sets: string[] = []
    const params: SqlValue[] = []
    if (patch.name !== undefined) sets.push('name = ?') && params.push(patch.name.trim())
    if (patch.institution !== undefined) sets.push('institution = ?') && params.push(patch.institution.trim())
    if (patch.type !== undefined) sets.push('type = ?') && params.push(patch.type)
    if (patch.currency !== undefined) {
      if (!isCurrency(patch.currency)) throw new Error(`Unsupported currency ${patch.currency}`)
      sets.push('currency = ?') && params.push(patch.currency)
    }
    if (patch.archived !== undefined) sets.push('archived = ?') && params.push(patch.archived ? 1 : 0)
    if (!sets.length) return
    this.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    this.changed()
  }

  deleteAccount(id: number): void {
    this.run('DELETE FROM accounts WHERE id = ?', [id])
    this.changed()
  }

  listBalances(accountId: number): BalanceSnapshot[] {
    return this.all<BalanceSnapshot>('SELECT id, account_id AS accountId, date, balance FROM balances WHERE account_id = ? ORDER BY date DESC', [accountId])
  }

  setBalance(accountId: number, date: string, balance: number): void {
    this.run(
      'INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?) ON CONFLICT (account_id, date) DO UPDATE SET balance = excluded.balance',
      [accountId, date, Math.round(balance)]
    )
    this.changed()
  }

  deleteBalance(id: number): void {
    this.run('DELETE FROM balances WHERE id = ?', [id])
    this.changed()
  }

  // ---------- transactions ----------

  listTransactions(q: TxnQuery = {}): { rows: TransactionRow[]; total: number } {
    const where: string[] = []
    const params: SqlValue[] = []
    if (q.accountId != null) where.push('t.account_id = ?') && params.push(q.accountId)
    if (q.categoryId === 'uncategorized') where.push('t.category_id IS NULL')
    else if (q.categoryId != null) where.push('t.category_id = ?') && params.push(q.categoryId)
    if (q.from) where.push('t.date >= ?') && params.push(q.from)
    if (q.to) where.push('t.date <= ?') && params.push(q.to)
    if (q.search?.trim()) {
      const like = `%${q.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`
      where.push("(t.description LIKE ? ESCAPE '\\' OR t.payee LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')")
      params.push(like, like, like)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions t ${clause}`, params)?.n ?? 0)
    const rows = this.all<TransactionRow>(
      `SELECT ${TXN_COLUMNS}, a.name AS accountName, a.currency, c.name AS categoryName, c.color AS categoryColor
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       ${clause} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...params, q.limit ?? 100, q.offset ?? 0]
    )
    return { rows, total }
  }

  addTransaction(input: NewTransaction): Transaction {
    const description = input.description.trim() || 'Manual entry'
    const payee = normalizePayee(description)
    const categoryId = input.categoryId !== undefined ? input.categoryId : categorize(this.rules(), description, payee)
    const { lastId } = this.run(
      `INSERT INTO transactions (account_id, date, amount, description, payee, category_id, category_locked, notes, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.accountId, input.date, Math.round(input.amount), description, payee, categoryId, input.categoryId !== undefined ? 1 : 0, input.notes ?? '', `manual|${randomUUID()}`, new Date().toISOString()]
    )
    this.changed()
    return this.get<Transaction>(`SELECT ${TXN_COLUMNS} FROM transactions t WHERE id = ?`, [lastId])!
  }

  updateTransaction(id: number, patch: Partial<Pick<Transaction, 'categoryId' | 'notes' | 'description' | 'date' | 'amount'>>): void {
    const sets: string[] = []
    const params: SqlValue[] = []
    if (patch.categoryId !== undefined) sets.push('category_id = ?, category_locked = 1') && params.push(patch.categoryId)
    if (patch.notes !== undefined) sets.push('notes = ?') && params.push(patch.notes)
    if (patch.description !== undefined) sets.push('description = ?, payee = ?') && params.push(patch.description, normalizePayee(patch.description))
    if (patch.date !== undefined) sets.push('date = ?') && params.push(patch.date)
    if (patch.amount !== undefined) sets.push('amount = ?') && params.push(Math.round(patch.amount))
    if (!sets.length) return
    this.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    this.changed()
  }

  deleteTransaction(id: number): void {
    this.run('DELETE FROM transactions WHERE id = ?', [id])
    this.changed()
  }

  transactionsCsv(): string {
    const rows = this.listTransactions({ limit: 1_000_000 }).rows
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = ['Date,Account,Description,Payee,Category,Amount,Currency,Notes']
    for (const r of rows)
      lines.push([r.date, r.accountName, r.description, r.payee, r.categoryName ?? '', (r.amount / 100).toFixed(2), r.currency, r.notes].map(esc).join(','))
    return lines.join('\n') + '\n'
  }

  // ---------- categories, rules, budgets ----------

  listCategories(): Category[] {
    return this.all<Category>(
      "SELECT id, name, kind, color FROM categories ORDER BY CASE kind WHEN 'income' THEN 0 WHEN 'expense' THEN 1 ELSE 2 END, name"
    )
  }

  createCategory(input: Omit<Category, 'id'>): Category {
    const { lastId } = this.run('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)', [input.name.trim(), input.kind, input.color])
    this.changed()
    return { id: lastId, ...input, name: input.name.trim() }
  }

  updateCategory(id: number, patch: Partial<Omit<Category, 'id'>>): void {
    const sets: string[] = []
    const params: SqlValue[] = []
    if (patch.name !== undefined) sets.push('name = ?') && params.push(patch.name.trim())
    if (patch.kind !== undefined) sets.push('kind = ?') && params.push(patch.kind)
    if (patch.color !== undefined) sets.push('color = ?') && params.push(patch.color)
    if (!sets.length) return
    this.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    this.changed()
  }

  deleteCategory(id: number): void {
    this.run('DELETE FROM categories WHERE id = ?', [id])
    this.changed()
  }

  listRules(): Rule[] {
    return this.all<Rule>('SELECT id, pattern, category_id AS categoryId, priority FROM rules ORDER BY priority DESC, id ASC')
  }

  private rules(): CompiledRule[] {
    this.compiledRules ??= this.listRules()
      .map((r) => compileRule(r.pattern, r.categoryId))
      .filter((r): r is CompiledRule => r !== null)
    return this.compiledRules
  }

  createRule(pattern: string, categoryId: number, applyToExisting = false): { rule: Rule; updated: number } {
    const compiled = compileRule(pattern, categoryId)
    if (!compiled) throw new Error('Rule pattern is empty')
    const { lastId } = this.run('INSERT INTO rules (pattern, category_id, priority) VALUES (?, ?, ?)', [pattern.trim(), categoryId, USER_RULE_PRIORITY])
    let updated = 0
    if (applyToExisting) {
      this.tx(() => {
        for (const t of this.all<{ id: number; description: string; payee: string; categoryId: number | null }>(
          'SELECT id, description, payee, category_id AS categoryId FROM transactions'
        )) {
          if (t.categoryId !== categoryId && categorize([compiled], t.description, t.payee) !== null) {
            this.run('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?', [categoryId, t.id])
            updated++
          }
        }
      })
    }
    this.changed()
    return { rule: { id: lastId, pattern: pattern.trim(), categoryId, priority: USER_RULE_PRIORITY }, updated }
  }

  deleteRule(id: number): void {
    this.run('DELETE FROM rules WHERE id = ?', [id])
    this.changed()
  }

  /** Re-runs rules. Never touches categories the user picked by hand. Returns the number of changed rows. */
  applyRules(onlyUncategorized: boolean): number {
    const rules = this.rules()
    let updated = 0
    this.tx(() => {
      const rows = this.all<{ id: number; description: string; payee: string; categoryId: number | null }>(
        `SELECT id, description, payee, category_id AS categoryId FROM transactions WHERE category_locked = 0 ${onlyUncategorized ? 'AND category_id IS NULL' : ''}`
      )
      for (const t of rows) {
        const c = categorize(rules, t.description, t.payee)
        if (c !== null && c !== t.categoryId) {
          this.run('UPDATE transactions SET category_id = ? WHERE id = ?', [c, t.id])
          updated++
        }
      }
    })
    updated += this.matchTransfers()
    this.changed()
    return updated
  }

  /** Marks uncategorized opposite-amount pairs across accounts as transfers so they don't count as income/spending. */
  private matchTransfers(): number {
    const transferId = this.get<{ id: number }>("SELECT id FROM categories WHERE name = 'Transfer' AND kind = 'transfer'")?.id
    if (transferId === undefined) return 0
    const byCurrency = new Map<string, { id: number; accountId: number; date: string; amount: number }[]>()
    for (const t of this.all<{ id: number; accountId: number; date: string; amount: number; currency: string }>(
      `SELECT t.id, t.account_id AS accountId, t.date, t.amount, a.currency FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.category_id IS NULL AND t.category_locked = 0`
    ))
      byCurrency.set(t.currency, [...(byCurrency.get(t.currency) ?? []), t])
    // Only same-currency movements can be matched by amount.
    const pairs = [...byCurrency.values()].flatMap((list) => findTransferPairs(list))
    for (const [a, b] of pairs) this.run('UPDATE transactions SET category_id = ? WHERE id IN (?, ?)', [transferId, a, b])
    return pairs.length * 2
  }

  listBudgets(): Budget[] {
    return this.all<Budget>('SELECT category_id AS categoryId, amount FROM budgets')
  }

  setBudget(categoryId: number, amount: number): void {
    if (amount > 0)
      this.run('INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT (category_id) DO UPDATE SET amount = excluded.amount', [categoryId, Math.round(amount)])
    else this.run('DELETE FROM budgets WHERE category_id = ?', [categoryId])
    this.changed()
  }

  /** Spending per expense category for `month`, plus the average of the 3 months before it. */
  getBudgetOverview(month = monthOf(todayIso())): { month: string; rows: BudgetOverviewRow[] } {
    const txns = this.homeTransactions(this.rawAccounts(), this.allTransactions())
    const categories = this.listCategories()
    const budgets = new Map(this.listBudgets().map((b) => [b.categoryId, b.amount]))
    const sum = (m: string): Map<number | null, number> => new Map(spendingByCategory(txns, categories, m).map((s) => [s.categoryId, s.amount]))
    const current = sum(month)
    const prior = [1, 2, 3].map((n) => sum(addMonths(month, -n)))
    const rows = categories
      .filter((c) => c.kind === 'expense')
      .map((category) => ({
        category,
        budget: budgets.get(category.id) ?? 0,
        spent: current.get(category.id) ?? 0,
        average: Math.round(prior.reduce((s, m) => s + (m.get(category.id) ?? 0), 0) / prior.length)
      }))
      .sort((a, b) => b.budget - a.budget || b.average - a.average || a.category.name.localeCompare(b.category.name))
    return { month, rows }
  }

  // ---------- import ----------

  private matchAccount(externalId?: string): number | null {
    if (!externalId) return null
    const accounts = this.rawAccounts()
    const exact = accounts.find((a) => a.externalId === externalId)
    if (exact) return exact.id
    const last4 = externalId.replace(/\D/g, '').slice(-4)
    if (last4.length < 4) return null
    return accounts.find((a) => a.externalId && a.externalId.replace(/\D/g, '').slice(-4) === last4)?.id ?? null
  }

  previewImport(filename: string, text: string, options: ImportOptions = {}): ImportPreview {
    const parsed = parseStatement(filename, text, options)
    const positives = parsed.transactions.filter((t) => t.amount > 0).length
    return {
      ...parsed,
      matchedAccountId: this.matchAccount(parsed.account?.externalId),
      currency: detectCurrency(text),
      positiveShare: parsed.transactions.length ? positives / parsed.transactions.length : 0
    }
  }

  commitImport(req: ImportRequest): ImportResult {
    const parsed = parseStatement(req.filename, req.text, req.options)
    // Fingerprints come from the rows as parsed, so corrections made in the preview don't defeat dedupe on re-import.
    const excluded = new Set(req.excluded ?? [])
    const rows = parsed.transactions.flatMap((t, index) => {
      if (excluded.has(index)) return []
      const edit = req.edits?.[index]
      if (!edit) return [{ t, index }]
      const fixed = { ...t, ...edit }
      const date = parseDate(fixed.date)
      if (!date || !Number.isInteger(fixed.amount) || !fixed.description.trim()) throw new Error(`Row ${index + 1} has an invalid date, amount or description`)
      return [{ t: { ...fixed, date, description: fixed.description.trim() }, index }]
    })
    if (rows.length === 0 && !parsed.ledgerBalance) throw new Error(parsed.errors[0] ?? 'No transactions found')
    const result = this.tx(() => {
      let accountId = req.accountId
      if (accountId == null) {
        if (!req.newAccount) throw new Error('Choose an account to import into')
        accountId = this.createAccount({ ...req.newAccount, externalId: req.newAccount.externalId ?? parsed.account?.externalId ?? null }).id
      } else if (parsed.account?.externalId) {
        this.run('UPDATE accounts SET external_id = COALESCE(external_id, ?) WHERE id = ?', [parsed.account.externalId, accountId])
      }
      const { lastId: importId } = this.run('INSERT INTO imports (account_id, filename, format, added, duplicates, imported_at) VALUES (?, ?, ?, 0, 0, ?)', [
        accountId,
        req.filename,
        parsed.format,
        new Date().toISOString()
      ])
      const rules = this.rules()
      const fps = fingerprintAll(accountId, parsed.transactions)
      const now = new Date().toISOString()
      let added = 0
      let categorized = 0
      rows.forEach(({ t, index }) => {
        const payee = normalizePayee(t.description)
        const categoryId = categorize(rules, t.description, payee)
        const { changes } = this.run(
          `INSERT OR IGNORE INTO transactions (account_id, date, amount, description, payee, category_id, fingerprint, import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, t.date, t.amount, t.description, payee, categoryId, fps[index], importId, now]
        )
        if (changes) {
          added++
          if (categoryId !== null) categorized++
        }
      })
      const duplicates = rows.length - added
      this.run('UPDATE imports SET added = ?, duplicates = ? WHERE id = ?', [added, duplicates, importId])
      if (parsed.ledgerBalance) this.setBalance(accountId, parsed.ledgerBalance.date, parsed.ledgerBalance.balance)
      const transfersMatched = this.matchTransfers()
      return { accountId, added, duplicates, categorized, transfersMatched, balanceUpdated: Boolean(parsed.ledgerBalance) }
    })
    this.changed()
    return result
  }

  // ---------- dashboard ----------

  getDashboard(month?: string, asOf = todayIso()): DashboardData {
    const accounts = this.rawAccounts(false)
    const accountIds = new Set(accounts.map((a) => a.id))
    const fx = this.converter()
    const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]))
    const txns = this.homeTransactions(
      accounts,
      this.allTransactions().filter((t) => accountIds.has(t.accountId)),
      fx
    )
    const snapshots = this.allSnapshots()
      .filter((s) => accountIds.has(s.accountId))
      .map((s) => ({ ...s, balance: fx.toHome(s.balance, currencyOf.get(s.accountId)!) }))
    const categories = this.listCategories()
    const calcs = buildCalculators(accounts, txns, snapshots)

    const months = new Set(txns.map((t) => monthOf(t.date)))
    months.add(monthOf(asOf))
    const availableMonths = [...months].filter((m) => m <= monthOf(asOf)).sort().reverse()
    const selected = month && availableMonths.includes(month) ? month : availableMonths[0]

    const now = netWorthAt(accounts, calcs, asOf)
    const before = netWorthAt(accounts, calcs, addDays(asOf, -30))
    const flow = cashFlow(txns, categories, selected, 12)
    const current = flow[flow.length - 1]
    const previous = flow.slice(-7, -1).filter((p) => p.expenses > 0)
    const avgMonthlyExpenses = previous.length ? Math.round(previous.reduce((s, p) => s + p.expenses, 0) / previous.length) : current.expenses
    const cash = accounts
      .filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
      .reduce((s, a) => s + calcs.get(a.id)!.balanceAt(asOf), 0)
    const spending = spendingByCategory(txns, categories, selected)
    const accountsWithBalance = this.listAccounts(false, asOf)

    return {
      asOf,
      insights: this.insightsFor(txns, categories, asOf, fx.home).slice(0, 3),
      homeCurrency: fx.home,
      missingRates: [...fx.missing].sort(),
      month: selected,
      availableMonths,
      accounts: accountsWithBalance,
      assets: now.assets,
      liabilities: now.liabilities,
      netWorth: now.netWorth,
      netWorthChange30d: now.netWorth - before.netWorth,
      netWorthSeries: netWorthSeries(accounts, calcs, asOf, 12),
      cashFlow: flow,
      monthIncome: current.income,
      monthExpenses: current.expenses,
      savingsRate: current.income > 0 ? (current.income - current.expenses) / current.income : null,
      avgMonthlyExpenses,
      emergencyFundMonths: avgMonthlyExpenses > 0 ? cash / avgMonthlyExpenses : null,
      spending,
      topMerchants: topMerchants(txns, categories, selected),
      budgets: budgetProgress(this.listBudgets(), spending, categories),
      recurring: detectRecurring(txns, categories, asOf),
      uncategorizedCount: Number(this.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL')?.n ?? 0),
      recentTransactions: this.listTransactions({ limit: 8 }).rows
    }
  }

  // ---------- spending ----------

  private insightsFor(txns: Transaction[], categories: Category[], asOf: string, currency: string, recurring?: RecurringItem[]): Insight[] {
    const month = monthOf(asOf)
    return spendingInsights({
      txns,
      categories,
      recurring: recurring ?? detectRecurring(txns, categories, asOf),
      budgets: budgetProgress(this.listBudgets(), spendingByCategory(txns, categories, month), categories),
      lastMonthFlow: cashFlow(txns, categories, addMonths(month, -1), 1)[0],
      asOf,
      currency
    })
  }

  getSpendingReport(q: SpendingQuery = {}, asOf = todayIso()): SpendingReport {
    const accounts = this.rawAccounts(false)
    const ids = new Set(accounts.filter((a) => q.accountId == null || a.id === q.accountId).map((a) => a.id))
    const fx = this.converter()
    const txns = this.homeTransactions(
      accounts,
      this.allTransactions().filter((t) => ids.has(t.accountId)),
      fx
    )
    const categories = this.listCategories()
    const months = new Set(txns.map((t) => monthOf(t.date)))
    months.add(monthOf(asOf))
    const availableMonths = [...months].filter((m) => m <= monthOf(asOf)).sort().reverse()
    const endMonth = q.endMonth && availableMonths.includes(q.endMonth) ? q.endMonth : availableMonths[0]
    const recurring = detectRecurring(txns, categories, asOf)
    const count = Math.min(Math.max(Math.round(q.months ?? 12), 1), 60)
    return {
      homeCurrency: fx.home,
      availableMonths,
      ...spendingReport(txns, categories, endMonth, count, new Set(recurring.map((r) => r.payee)), q.categoryId),
      insights: this.insightsFor(txns, categories, asOf, fx.home, recurring)
    }
  }

  // ---------- currencies ----------

  homeCurrency(): string {
    return this.getSetting('home_currency') ?? 'USD'
  }

  /** Converts amounts to the home currency: a manual rate wins, then European Central Bank rates. */
  private converter(): { home: string; missing: Set<string>; rate: (currency: string) => number | null; toHome: (cents: number, currency: string) => number } {
    const home = this.homeCurrency()
    const perEur = Object.fromEntries(this.all<{ currency: string; perEur: number }>('SELECT currency, per_eur AS perEur FROM fx_rates').map((r) => [r.currency, r.perEur]))
    const manual = new Map(this.all<{ currency: string; rate: number }>('SELECT currency, home_per_unit AS rate FROM fx_manual').map((r) => [r.currency, r.rate]))
    const missing = new Set<string>()
    const rate = (currency: string): number | null => (currency === home ? 1 : (manual.get(currency) ?? crossRate(perEur, currency, home)))
    const toHome = (cents: number, currency: string): number => {
      const r = rate(currency)
      if (r === null) {
        missing.add(currency)
        return cents
      }
      return r === 1 ? cents : Math.round(cents * r)
    }
    return { home, missing, rate, toHome }
  }

  private homeTransactions(accounts: Account[], txns: Transaction[], fx = this.converter()): Transaction[] {
    const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]))
    return txns.map((t) => ({ ...t, amount: fx.toHome(t.amount, currencyOf.get(t.accountId) ?? fx.home) }))
  }

  private foreignCurrencies(): string[] {
    const home = this.homeCurrency()
    return this.all<{ currency: string }>('SELECT DISTINCT currency FROM accounts ORDER BY currency')
      .map((r) => r.currency)
      .filter((c) => c !== home)
  }

  getCurrencySettings(): CurrencySettings {
    const fx = this.converter()
    const manual = new Set(this.all<{ currency: string }>('SELECT currency FROM fx_manual').map((r) => r.currency))
    return {
      homeCurrency: fx.home,
      ratesFetchedAt: this.getSetting('rates_fetched_at'),
      ratesDate: this.getSetting('rates_date'),
      accountCounts: Object.fromEntries(this.all<{ currency: string; n: number }>('SELECT currency, COUNT(*) AS n FROM accounts GROUP BY currency').map((r) => [r.currency, r.n])),
      rates: this.foreignCurrencies().map((currency) => ({ currency, homePerUnit: fx.rate(currency), manual: manual.has(currency) }))
    }
  }

  /** With `moveAccounts`, accounts in the old home currency are relabelled (amounts unchanged), for when the first guess was wrong. */
  setHomeCurrency(code: string, moveAccounts = false): void {
    if (!isCurrency(code)) throw new Error(`Unsupported currency ${code}`)
    const old = this.homeCurrency()
    this.tx(() => {
      this.setSetting('home_currency', code)
      if (moveAccounts) this.run('UPDATE accounts SET currency = ? WHERE currency = ?', [code, old])
      // Manual rates are quoted in the old home currency.
      this.run('DELETE FROM fx_manual')
    })
    this.changed()
  }

  setExchangeRate(currency: string, homePerUnit: number | null): void {
    if (!isCurrency(currency)) throw new Error(`Unsupported currency ${currency}`)
    if (homePerUnit === null) this.run('DELETE FROM fx_manual WHERE currency = ?', [currency])
    else {
      if (!Number.isFinite(homePerUnit) || homePerUnit <= 0) throw new Error('Enter the rate as a positive number, e.g. 0.54')
      this.run('INSERT INTO fx_manual (currency, home_per_unit) VALUES (?, ?) ON CONFLICT (currency) DO UPDATE SET home_per_unit = excluded.home_per_unit', [
        currency,
        homePerUnit
      ])
    }
    this.changed()
  }

  /** Stores European Central Bank reference rates (units per 1 EUR) published on `date`. */
  saveRates(date: string, perEur: Record<string, number>, fetchedAt = new Date().toISOString()): void {
    this.tx(() => {
      this.run('DELETE FROM fx_rates')
      for (const [currency, rate] of Object.entries(perEur)) if (Number.isFinite(rate) && rate > 0) this.run('INSERT INTO fx_rates (currency, per_eur) VALUES (?, ?)', [currency, rate])
      this.setSetting('rates_date', date)
      this.setSetting('rates_fetched_at', fetchedAt)
    })
    this.changed()
  }

  /** True when some account is in another currency and rates are missing or more than 12 hours old. */
  ratesStale(now = Date.now()): boolean {
    if (this.foreignCurrencies().length === 0) return false
    const fetched = this.getSetting('rates_fetched_at')
    return !fetched || now - Date.parse(fetched) > 12 * 3600_000
  }

  // ---------- maintenance ----------

  loadDemoData(asOf = todayIso()): void {
    const demo = generateDemoData(asOf)
    const ids = new Map<string, number>()
    this.tx(() => {
      for (const a of demo.accounts) ids.set(a.key, this.createAccount({ name: a.name, institution: a.institution, type: a.type }).id)
      const rules = this.rules()
      const byAccount = new Map<string, typeof demo.transactions>()
      for (const t of demo.transactions) byAccount.set(t.account, [...(byAccount.get(t.account) ?? []), t])
      const now = new Date().toISOString()
      for (const [key, list] of byAccount) {
        const accountId = ids.get(key)!
        const fps = fingerprintAll(accountId, list)
        list.forEach((t, i) => {
          const payee = normalizePayee(t.description)
          this.run(
            'INSERT OR IGNORE INTO transactions (account_id, date, amount, description, payee, category_id, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [accountId, t.date, t.amount, t.description, payee, categorize(rules, t.description, payee), fps[i], now]
          )
        })
      }
      for (const s of demo.snapshots) this.setBalance(ids.get(s.account)!, s.date, s.balance)
      const cat = new Map(this.listCategories().map((c) => [c.name, c.id]))
      const budgets: [string, number][] = [
        ['Groceries', 70_000],
        ['Dining', 35_000],
        ['Shopping', 30_000],
        ['Transportation', 20_000],
        ['Entertainment', 10_000],
        ['Subscriptions', 6_000],
        ['Utilities', 32_000]
      ]
      for (const [name, amount] of budgets) if (cat.has(name)) this.setBudget(cat.get(name)!, amount)
      this.matchTransfers()
    })
    this.changed()
  }

  resetAll(): void {
    this.tx(() => {
      for (const t of ['transactions', 'balances', 'imports', 'budgets', 'rules', 'accounts', 'categories']) this.run(`DELETE FROM ${t}`)
      this.seedDefaults()
    })
    this.changed()
  }
}
