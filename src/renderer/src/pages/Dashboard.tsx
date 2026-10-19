import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { accountGroup, type DashboardData } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, Empty, Money, Progress, Stat } from '../components/ui'
import { money, monthLabel, pct, shortDate, shortMonth } from '../format'
import { AccountForm } from './Accounts'

const axisMoney = (v: number): string => money(v, { compact: true })
const tooltipMoney = (v: number): string => money(v, { whole: true })

export function Dashboard({ navigate, onChange, version }: PageProps) {
  const [month, setMonth] = useState<string | undefined>()
  const [data, setData] = useState<DashboardData | null>(null)
  const [adding, setAdding] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)

  useEffect(() => {
    void api.getDashboard(month).then(setData)
  }, [month, version])

  if (!data) return <div className="muted">Loading…</div>

  if (data.accounts.length === 0) {
    return (
      <div className="welcome">
        <h1>See all your money in one place</h1>
        <p className="muted">
          Bring in your bank, card, investment and loan accounts to get one view of your net worth, cash flow, spending, budgets and subscriptions.
        </p>
        <div className="welcome-options">
          <div className="welcome-option">
            <h3>Import statements</h3>
            <p>Download CSV, OFX or QFX files from your bank or card's website and drop them in.</p>
            <button className="primary" onClick={() => navigate({ page: 'import' })}>
              Import a file
            </button>
          </div>
          <div className="welcome-option">
            <h3>Add an account</h3>
            <p>Track balances for things like a 401(k), your home or a loan by entering them by hand.</p>
            <button onClick={() => setAdding(true)}>Add account</button>
          </div>
          <div className="welcome-option">
            <h3>Try it with sample data</h3>
            <p>Load 12 months of realistic made-up data to explore. You can wipe it from Settings.</p>
            <button
              disabled={loadingDemo}
              onClick={async () => {
                setLoadingDemo(true)
                await api.loadDemoData()
                setLoadingDemo(false)
                onChange()
              }}
            >
              {loadingDemo ? 'Loading…' : 'Load sample data'}
            </button>
          </div>
        </div>
        {adding && <AccountForm onClose={() => setAdding(false)} onSaved={onChange} />}
      </div>
    )
  }

  const groups = new Map<string, { total: number; accounts: DashboardData['accounts'] }>()
  for (const a of data.accounts) {
    const g = accountGroup(a.type)
    const cur = groups.get(g) ?? { total: 0, accounts: [] }
    cur.total += a.balance
    cur.accounts.push(a)
    groups.set(g, cur)
  }
  const spendTotal = data.spending.reduce((s, c) => s + c.amount, 0)
  const recurringTotal = data.recurring.reduce((s, r) => s + r.monthlyCost, 0)
  const isCurrent = data.month === data.availableMonths[0]

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <div className="muted small">As of {shortDate(data.asOf)}</div>
        </div>
        <div className="actions">
          <select value={data.month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {data.availableMonths.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => navigate({ page: 'import' })}>
            Import
          </button>
        </div>
      </div>

      {data.uncategorizedCount > 0 && (
        <div className="banner warn">
          <span>
            {data.uncategorizedCount} transaction{data.uncategorizedCount === 1 ? '' : 's'} need a category for accurate spending reports.
          </span>
          <button className="link" onClick={() => navigate({ page: 'transactions', query: { categoryId: 'uncategorized' } })}>
            Review
          </button>
        </div>
      )}

      <div className="grid kpis">
        <Stat
          label="Net worth"
          value={money(data.netWorth, { whole: true })}
          sub={
            <span className={data.netWorthChange30d >= 0 ? 'pos' : 'neg'}>
              {money(data.netWorthChange30d, { whole: true, sign: true })} last 30 days
            </span>
          }
        />
        <Stat label="Assets" value={money(data.assets, { whole: true })} />
        <Stat label="Liabilities" value={money(-data.liabilities, { whole: true })} />
        <Stat label={`Income · ${shortMonth(data.month)}`} value={money(data.monthIncome, { whole: true })} sub={isCurrent ? 'Month to date' : undefined} />
        <Stat label={`Spending · ${shortMonth(data.month)}`} value={money(data.monthExpenses, { whole: true })} sub={`Avg ${money(data.avgMonthlyExpenses, { whole: true })}/mo`} />
        <Stat
          label="Savings rate"
          value={data.savingsRate == null ? '—' : pct(data.savingsRate)}
          tone={data.savingsRate == null ? undefined : data.savingsRate >= 0.2 ? 'good' : data.savingsRate < 0 ? 'bad' : undefined}
          sub="Of income kept"
        />
        <Stat
          label="Emergency fund"
          value={data.emergencyFundMonths == null ? '—' : `${data.emergencyFundMonths.toFixed(1)} mo`}
          tone={data.emergencyFundMonths == null ? undefined : data.emergencyFundMonths >= 6 ? 'good' : data.emergencyFundMonths < 3 ? 'bad' : undefined}
          sub="Cash ÷ avg spending"
        />
      </div>

      <div className="grid two">
        <Card title="Net worth">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.netWorthSeries.map((p) => ({ ...p, liabilities: -p.liabilities, label: shortMonth(p.date.slice(0, 7)) }))}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} fontSize={12} width={70} />
              <Tooltip formatter={tooltipMoney} />
              <Legend />
              <Area type="monotone" dataKey="assets" name="Assets" stroke="#10b981" fill="none" strokeWidth={1.5} />
              <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke="#ef4444" fill="none" strokeWidth={1.5} />
              <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#4f46e5" fill="url(#nw)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Accounts" action={<button className="link" onClick={() => navigate({ page: 'accounts' })}>Manage</button>}>
          {[...groups.entries()].map(([group, g]) => (
            <div key={group}>
              <div className="group-title">
                <span>{group}</span>
                <Money cents={g.total} whole />
              </div>
              <div className="list">
                {g.accounts.map((a) => (
                  <div className="list-row" key={a.id}>
                    <div className="left">
                      <a className="title" onClick={() => navigate({ page: 'transactions', query: { accountId: a.id } })}>
                        {a.name}
                      </a>
                      {a.institution && <span className="muted small">&nbsp;· {a.institution}</span>}
                    </div>
                    <Money cents={a.balance} whole />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid two">
        <Card title="Cash flow">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.cashFlow.map((p) => ({ ...p, label: shortMonth(p.month) }))} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} fontSize={12} width={70} />
              <Tooltip formatter={tooltipMoney} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} onClick={(p: { month?: string }) => p.month && setMonth(p.month)} />
              <Bar dataKey="expenses" name="Spending" fill="#f97316" radius={[4, 4, 0, 0]} onClick={(p: { month?: string }) => p.month && setMonth(p.month)} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={`Spending by category · ${monthLabel(data.month)}`}>
          {data.spending.length === 0 ? (
            <Empty>No spending this month.</Empty>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={data.spending} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={1}>
                    {data.spending.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={tooltipMoney} />
                </PieChart>
              </ResponsiveContainer>
              <div className="legend">
                {data.spending.slice(0, 7).map((s) => (
                  <div className="legend-row" key={s.name}>
                    <a
                      className="left"
                      onClick={() =>
                        navigate({
                          page: 'transactions',
                          query: { categoryId: s.categoryId ?? 'uncategorized', from: `${data.month}-01`, to: `${data.month}-31` }
                        })
                      }
                    >
                      <span className="dot" style={{ background: s.color }} />
                      {s.name}
                    </a>
                    <span>
                      <Money cents={s.amount} whole /> <span className="muted small">{pct(s.amount / spendTotal)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid three">
        <Card title="Budgets" action={<button className="link" onClick={() => navigate({ page: 'budgets' })}>Edit</button>}>
          {data.budgets.length === 0 ? (
            <Empty>
              No budgets yet. <a onClick={() => navigate({ page: 'budgets' })}>Set some up</a>
            </Empty>
          ) : (
            data.budgets.map((b) => (
              <div className="budget-row" key={b.categoryId}>
                <div className="top">
                  <span>{b.name}</span>
                  <span className={b.spent > b.budget ? 'neg' : 'muted'}>
                    {money(b.spent, { whole: true })} / {money(b.budget, { whole: true })}
                  </span>
                </div>
                <Progress value={b.spent} max={b.budget} color={b.color} />
              </div>
            ))
          )}
        </Card>
        <Card title="Bills & subscriptions" action={<span className="muted small">{money(recurringTotal, { whole: true })}/mo</span>}>
          {data.recurring.length === 0 ? (
            <Empty>Recurring charges show up here after a few months of history.</Empty>
          ) : (
            <div className="list">
              {data.recurring.slice(0, 10).map((r) => (
                <div className="list-row" key={r.payee}>
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{r.payee}</div>
                    <div className="muted small">
                      {r.frequency} · next {shortDate(r.nextDate)}
                    </div>
                  </div>
                  <Money cents={r.amount} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={`Top merchants · ${shortMonth(data.month)}`}>
          {data.topMerchants.length === 0 ? (
            <Empty>No purchases this month.</Empty>
          ) : (
            <div className="list">
              {data.topMerchants.map((m) => (
                <div className="list-row" key={m.payee}>
                  <div style={{ minWidth: 0 }}>
                    <a className="title" onClick={() => navigate({ page: 'transactions', query: { search: m.payee } })}>
                      {m.payee}
                    </a>
                    <div className="muted small">
                      {m.count} purchase{m.count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Money cents={m.amount} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent transactions" action={<button className="link" onClick={() => navigate({ page: 'transactions' })}>View all</button>}>
        <table>
          <tbody>
            {data.recentTransactions.map((t) => (
              <tr key={t.id}>
                <td className="muted">{shortDate(t.date)}</td>
                <td>{t.payee}</td>
                <td className="muted">{t.accountName}</td>
                <td>
                  {t.categoryName ? (
                    <span className="chip">
                      <span className="dot" style={{ background: t.categoryColor ?? '#ccc' }} />
                      {t.categoryName}
                    </span>
                  ) : (
                    <span className="chip">Uncategorized</span>
                  )}
                </td>
                <td className="num">
                  <Money cents={t.amount} colored />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
