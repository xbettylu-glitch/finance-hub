import { useEffect, useState } from 'react'
import { todayIso } from '../../../core/dates'
import { ACCOUNT_TYPES, accountGroup, accountTypeLabel, isLiability, type AccountType, type AccountWithBalance, type BalanceSnapshot } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, Empty, ErrorBanner, Modal, Money } from '../components/ui'
import { centsFromInput, inputFromCents, shortDate } from '../format'

export function AccountForm({ account, onClose, onSaved }: { account?: AccountWithBalance; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account?.name ?? '')
  const [institution, setInstitution] = useState(account?.institution ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const liability = isLiability(type)

  const save = async (): Promise<void> => {
    try {
      if (account) {
        await api.updateAccount(account.id, { name, institution, type })
      } else {
        const cents = balance.trim() ? centsFromInput(balance) : null
        if (balance.trim() && cents == null) throw new Error('Enter the balance as a number, e.g. 1250.00')
        await api.createAccount({ name, institution, type, openingBalance: cents == null ? undefined : liability ? -Math.abs(cents) : cents })
      }
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal title={account ? 'Edit account' : 'Add account'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ErrorBanner error={error} />
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Joint Checking" required />
        </label>
        <div className="row">
          <label>
            Institution
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Chase" />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!account && (
          <label>
            {liability ? 'Amount owed today' : 'Current balance / value'} (optional)
            <input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" inputMode="decimal" />
          </label>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function BalanceModal({ account, onClose, onSaved }: { account: AccountWithBalance; onClose: () => void; onSaved: () => void }) {
  const liability = isLiability(account.type)
  const [date, setDate] = useState(todayIso())
  const [value, setValue] = useState(inputFromCents(liability ? -account.balance : account.balance))
  const [history, setHistory] = useState<BalanceSnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = (): void => void api.listBalances(account.id).then(setHistory)
  useEffect(load, [account.id])

  return (
    <Modal title={`Update balance · ${account.name}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          const cents = centsFromInput(value)
          if (cents == null) return setError('Enter the balance as a number, e.g. 1250.00')
          await api.setBalance(account.id, date, liability ? -Math.abs(cents) : cents)
          onSaved()
          onClose()
        }}
      >
        <ErrorBanner error={error} />
        <p className="muted small" style={{ margin: 0 }}>
          Balances anchor the account history; imported transactions before and after are applied on top. Use this for investments, property and loans
          that you don&apos;t import transactions for.
        </p>
        <div className="row">
          <label>
            As of
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            {liability ? 'Amount owed' : 'Balance / value'}
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save balance
          </button>
        </div>
      </form>
      {history.length > 0 && (
        <>
          <h3 style={{ margin: '18px 0 6px' }}>History</h3>
          <table>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{shortDate(h.date)}</td>
                  <td className="num">
                    <Money cents={h.balance} />
                  </td>
                  <td className="num">
                    <button
                      className="link danger"
                      onClick={async () => {
                        await api.deleteBalance(h.id)
                        load()
                        onSaved()
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

export function Accounts({ navigate, onChange, version }: PageProps) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<AccountWithBalance | 'new' | null>(null)
  const [balanceFor, setBalanceFor] = useState<AccountWithBalance | null>(null)

  useEffect(() => {
    void api.listAccounts(showArchived).then(setAccounts)
  }, [version, showArchived])

  const groups = new Map<string, AccountWithBalance[]>()
  for (const a of accounts) groups.set(accountGroup(a.type), [...(groups.get(accountGroup(a.type)) ?? []), a])

  return (
    <>
      <div className="page-header">
        <h1>Accounts</h1>
        <div className="actions">
          <label className="muted small">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button onClick={() => navigate({ page: 'import' })}>Import statement</button>
          <button className="primary" onClick={() => setEditing('new')}>
            Add account
          </button>
        </div>
      </div>
      {accounts.length === 0 && (
        <Card>
          <Empty>No accounts yet. Import a statement or add an account to get started.</Empty>
        </Card>
      )}
      {[...groups.entries()].map(([group, list]) => (
        <Card
          key={group}
          className="mb"
          title={group}
          action={
            <strong>
              <Money cents={list.reduce((s, a) => s + a.balance, 0)} />
            </strong>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Last activity</th>
                <th className="num">Transactions</th>
                <th className="num">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} style={{ opacity: a.archived ? 0.5 : 1 }}>
                  <td>
                    <strong>{a.name}</strong>
                    {a.institution && <div className="muted small">{a.institution}</div>}
                  </td>
                  <td className="muted">{accountTypeLabel(a.type)}</td>
                  <td className="muted">{a.lastActivity ? shortDate(a.lastActivity) : '—'}</td>
                  <td className="num">
                    {a.transactionCount > 0 ? <a onClick={() => navigate({ page: 'transactions', query: { accountId: a.id } })}>{a.transactionCount}</a> : '—'}
                  </td>
                  <td className="num">
                    <Money cents={a.balance} />
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => setBalanceFor(a)}>Update balance</button>{' '}
                    <button onClick={() => setEditing(a)}>Edit</button>{' '}
                    <button
                      onClick={async () => {
                        await api.updateAccount(a.id, { archived: !a.archived })
                        onChange()
                      }}
                    >
                      {a.archived ? 'Unarchive' : 'Archive'}
                    </button>{' '}
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm(`Delete "${a.name}" and its ${a.transactionCount} transactions? This cannot be undone.`)) return
                        await api.deleteAccount(a.id)
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
        </Card>
      ))}
      {editing && <AccountForm account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={onChange} />}
      {balanceFor && <BalanceModal account={balanceFor} onClose={() => setBalanceFor(null)} onSaved={onChange} />}
    </>
  )
}
