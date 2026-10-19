import { useEffect, useState } from 'react'
import { todayIso } from '../../../core/dates'
import type { Account, Category, TransactionRow, TxnQuery } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, Empty, ErrorBanner, Modal, Money } from '../components/ui'
import { centsFromInput, shortDate } from '../format'

const PAGE_SIZE = 100

export function CategorySelect({ categories, value, onChange, className, allowNone = true }: { categories: Category[]; value: number | null; onChange: (id: number | null) => void; className?: string; allowNone?: boolean }) {
  const groups: [string, Category[]][] = [
    ['Income', categories.filter((c) => c.kind === 'income')],
    ['Spending', categories.filter((c) => c.kind === 'expense')],
    ['Transfers (not counted)', categories.filter((c) => c.kind === 'transfer')]
  ]
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowNone && <option value="">Uncategorized</option>}
      {groups.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function RuleModal({ txn, categories, onClose, onSaved }: { txn: TransactionRow; categories: Category[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [pattern, setPattern] = useState(txn.payee.toLowerCase())
  const [categoryId, setCategoryId] = useState<number | null>(txn.categoryId)
  const [apply, setApply] = useState(true)
  return (
    <Modal title="Create a rule" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (categoryId == null) return
          const { updated } = await api.createRule(pattern, categoryId, apply)
          onSaved(`Rule saved${apply ? `, ${updated} transaction${updated === 1 ? '' : 's'} updated` : ''}.`)
          onClose()
        }}
      >
        <label>
          When the description contains (use | to separate alternatives)
          <input autoFocus value={pattern} onChange={(e) => setPattern(e.target.value)} required />
        </label>
        <label>
          Set category to
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} allowNone={false} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'inherit', fontSize: 14 }}>
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Also apply to existing matching transactions
        </label>
        <div className="muted small">Original description: {txn.description}</div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={categoryId == null}>
            Save rule
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AddTransactionModal({ accounts, categories, onClose, onSaved }: { accounts: Account[]; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Add transaction" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          const cents = centsFromInput(amount)
          if (cents == null || accountId == null) return setError('Enter an amount, e.g. 42.50')
          await api.addTransaction({ accountId, date, description, amount: direction === 'out' ? -Math.abs(cents) : Math.abs(cents), categoryId: categoryId ?? undefined })
          onSaved()
          onClose()
        }}
      >
        <ErrorBanner error={error} />
        <div className="row">
          <label>
            Account
            <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        </div>
        <label>
          Description
          <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} required />
        </label>
        <div className="row">
          <label>
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" required />
          </label>
          <label>
            Direction
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </select>
          </label>
        </div>
        <label>
          Category (leave empty to use rules)
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        </label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Add
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function Transactions({ initialQuery, onChange, version }: PageProps & { initialQuery?: TxnQuery }) {
  const [query, setQuery] = useState<TxnQuery>(initialQuery ?? {})
  const [search, setSearch] = useState(initialQuery?.search ?? '')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: TransactionRow[]; total: number }>({ rows: [], total: 0 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [ruleFor, setRuleFor] = useState<TransactionRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api.listAccounts(true).then(setAccounts)
    void api.listCategories().then(setCategories)
  }, [version])

  useEffect(() => {
    const h = setTimeout(() => setQuery((q) => ({ ...q, search: search || undefined })), 250)
    return () => clearTimeout(h)
  }, [search])

  useEffect(() => {
    void api.listTransactions({ ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then(setData)
  }, [query, page, version])

  const update = (patch: Partial<TxnQuery>): void => {
    setPage(0)
    setQuery((q) => ({ ...q, ...patch }))
  }
  const pageTotal = data.rows.reduce((s, r) => s + r.amount, 0)
  const pageCurrencies = [...new Set(data.rows.map((r) => r.currency))]

  return (
    <>
      <div className="page-header">
        <h1>Transactions</h1>
        <div className="actions">
          <button onClick={async () => setNotice((await api.exportTransactionsCsv()) ? 'Exported transactions to CSV.' : null)}>Export CSV</button>
          <button className="primary" onClick={() => setAdding(true)} disabled={accounts.length === 0}>
            Add transaction
          </button>
        </div>
      </div>
      {notice && (
        <div className="banner success">
          {notice}
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      <Card>
        <div className="filters">
          <input type="search" placeholder="Search description, payee, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={query.accountId ?? ''} onChange={(e) => update({ accountId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={query.categoryId ?? ''}
            onChange={(e) => update({ categoryId: e.target.value === '' ? undefined : e.target.value === 'uncategorized' ? 'uncategorized' : Number(e.target.value) })}
            aria-label="Category"
          >
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="date" value={query.from ?? ''} onChange={(e) => update({ from: e.target.value || undefined })} aria-label="From" />
          <span className="muted">to</span>
          <input type="date" value={query.to ?? ''} onChange={(e) => update({ to: e.target.value || undefined })} aria-label="To" />
          {(query.accountId || query.categoryId || query.from || query.to || search) && (
            <button
              className="link"
              onClick={() => {
                setSearch('')
                setPage(0)
                setQuery({})
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {data.rows.length === 0 ? (
          <Empty>No transactions match.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {shortDate(t.date)}
                  </td>
                  <td>
                    <div className="txn-desc">
                      <span>{t.payee}</span>
                      <span className="raw" title={t.description}>
                        {t.description}
                      </span>
                    </div>
                  </td>
                  <td className="muted">{t.accountName}</td>
                  <td>
                    <CategorySelect
                      className="cat-select"
                      categories={categories}
                      value={t.categoryId}
                      onChange={async (id) => {
                        await api.updateTransaction(t.id, { categoryId: id })
                        onChange()
                      }}
                    />
                  </td>
                  <td className="num">
                    <Money cents={t.amount} colored currency={t.currency} />
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="link" onClick={() => setRuleFor(t)} title="Always categorize transactions like this one">
                      Rule
                    </button>
                    {'  '}
                    <button
                      className="link danger"
                      onClick={async () => {
                        if (!confirm('Delete this transaction?')) return
                        await api.deleteTransaction(t.id)
                        onChange()
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pager">
          <span className="muted small">
            {data.total === 0 ? '0' : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + data.rows.length}`} of {data.total}
            {pageCurrencies.length === 1 && (
              <>
                {' '}
                · net on this page <Money cents={pageTotal} colored currency={pageCurrencies[0]} />
              </>
            )}
          </span>
          <span>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>{' '}
            <button disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </span>
        </div>
      </Card>
      {ruleFor && (
        <RuleModal
          txn={ruleFor}
          categories={categories}
          onClose={() => setRuleFor(null)}
          onSaved={(msg) => {
            setNotice(msg)
            onChange()
          }}
        />
      )}
      {adding && <AddTransactionModal accounts={accounts.filter((a) => !a.archived)} categories={categories} onClose={() => setAdding(false)} onSaved={onChange} />}
    </>
  )
}
