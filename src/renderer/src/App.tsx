import { useCallback, useEffect, useState } from 'react'
import type { TxnQuery } from '../../shared/types'
import { api } from './api'
import { setDisplayCurrency } from './format'
import { Accounts } from './pages/Accounts'
import { Budgets } from './pages/Budgets'
import { Categories } from './pages/Categories'
import { Dashboard } from './pages/Dashboard'
import { Import } from './pages/Import'
import { Settings } from './pages/Settings'
import { Transactions } from './pages/Transactions'

export type PageName = 'dashboard' | 'accounts' | 'transactions' | 'import' | 'budgets' | 'categories' | 'settings'
export interface Nav {
  page: PageName
  query?: TxnQuery
}
export type Navigate = (nav: Nav) => void

const PAGES: { page: PageName; label: string }[] = [
  { page: 'dashboard', label: 'Overview' },
  { page: 'accounts', label: 'Accounts' },
  { page: 'transactions', label: 'Transactions' },
  { page: 'budgets', label: 'Budgets' },
  { page: 'import', label: 'Import' },
  { page: 'categories', label: 'Categories & rules' },
  { page: 'settings', label: 'Settings' }
]

export function App() {
  const [nav, setNav] = useState<Nav>({ page: 'dashboard' })
  const [version, setVersion] = useState(0)
  const [uncategorized, setUncategorized] = useState(0)
  const changed = useCallback(() => setVersion((v) => v + 1), [])
  const [homeCurrency, setHomeCurrency] = useState<string | null>(null)

  useEffect(() => {
    void api.getCurrencySettings().then((s) => {
      setDisplayCurrency(s.homeCurrency)
      setHomeCurrency(s.homeCurrency)
    })
    void api.refreshRates().then((r) => r.updated && changed())
  }, [version, changed])

  useEffect(() => {
    void api.listTransactions({ categoryId: 'uncategorized', limit: 1 }).then((r) => setUncategorized(r.total))
  }, [version])

  const props = { navigate: setNav, onChange: changed, version }
  if (!homeCurrency) return null
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark" /> Finance Hub
        </div>
        {PAGES.map((p) => (
          <button key={p.page} className={`nav-item ${nav.page === p.page ? 'active' : ''}`} onClick={() => setNav({ page: p.page })}>
            {p.label}
            {p.page === 'transactions' && uncategorized > 0 && <span className="nav-badge">{uncategorized}</span>}
          </button>
        ))}
        <div className="sidebar-footer">Your data stays on this computer. Nothing is uploaded.</div>
      </nav>
      <main className="main">
        {nav.page === 'dashboard' && <Dashboard {...props} />}
        {nav.page === 'accounts' && <Accounts {...props} />}
        {nav.page === 'transactions' && <Transactions key={JSON.stringify(nav.query ?? {})} initialQuery={nav.query} {...props} />}
        {nav.page === 'budgets' && <Budgets {...props} />}
        {nav.page === 'import' && <Import {...props} />}
        {nav.page === 'categories' && <Categories {...props} />}
        {nav.page === 'settings' && <Settings {...props} />}
      </main>
    </div>
  )
}

export interface PageProps {
  navigate: Navigate
  onChange: () => void
  version: number
}
