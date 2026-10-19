import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { monthEnd } from '../../../core/dates'
import type { AccountWithBalance, Category, Insight, SpendingQuery, SpendingReport } from '../../../shared/types'
import type { Navigate, PageProps } from '../App'
import { api } from '../api'
import { Card, Empty, Money, Stat } from '../components/ui'
import { money, monthLabel, pct, shortMonth } from '../format'

const axisMoney = (v: number): string => money(v, { compact: true })
const tooltipMoney = (v: number): string => money(v, { whole: true })

export function InsightList({ insights, navigate, limit }: { insights: Insight[]; navigate: Navigate; limit?: number }) {
  const list = limit ? insights.slice(0, limit) : insights
  if (!list.length) return <Empty>Nothing stands out right now. Your spending is in line with your usual months.</Empty>
  return (
    <div>
      {list.map((i) => (
        <div className="insight" key={i.id}>
          <div>
            <strong>{i.title}</strong>
            <div className="muted small">{i.detail}</div>
          </div>
          <div className="insight-side">
            {i.monthlySaving != null && i.monthlySaving > 0 && <span className="chip custom">Save ~{money(i.monthlySaving, { whole: true })}/mo</span>}
            {(i.categoryId !== undefined || i.payee) && (
              <button
                className="link"
                onClick={() => navigate({ page: 'transactions', query: i.payee ? { search: i.payee } : { categoryId: i.categoryId ?? 'uncategorized' } })}
              >
                View
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="muted small">Worked out from your own transactions on this computer. These are prompts to review, not financial advice.</p>
    </div>
  )
}

function Trend({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="trend" aria-hidden>
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(4, (Math.max(v, 0) / max) * 100)}%` }} />
      ))}
    </div>
  )
}

export function Spending({ navigate, version }: PageProps) {
  const [query, setQuery] = useState<SpendingQuery>({ months: 12 })
  const [data, setData] = useState<SpendingReport | null>(null)
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    void api.getSpendingReport(query).then(setData)
  }, [query, version])
  useEffect(() => {
    void api.listAccounts().then(setAccounts)
    void api.listCategories().then(setCategories)
  }, [version])

  if (!data) return <div className="muted">Loading…</div>
  const set = (patch: Partial<SpendingQuery>): void => setQuery((q) => ({ ...q, ...patch }))
  const last = data.months.length - 1
  const total = data.totals.reduce((s, v) => s + v, 0)
  const average = data.averageMonths ? Math.round(total / data.averageMonths) : 0
  const latest = data.totals[last] ?? 0
  const fixedTotal = data.fixed.reduce((s, v) => s + v, 0)
  const top = data.categories.slice(0, 7)
  const chart = data.months.map((m, i) => {
    const row: Record<string, number | string> = { label: shortMonth(m) }
    for (const c of top) row[c.name] = c.monthly[i]
    const rest = data.totals[i] - top.reduce((s, c) => s + c.monthly[i], 0)
    if (data.categories.length > top.length) row.Other = rest
    return row
  })
  const from = `${data.months[0]}-01`
  const to = monthEnd(data.months[last])
  const selected = query.categoryId === undefined ? null : query.categoryId === 'uncategorized' ? 'Uncategorized' : categories.find((c) => c.id === query.categoryId)?.name
  const expenseCategories = categories.filter((c) => c.kind === 'expense')

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Spending</h1>
          <div className="muted small">Money going out, in {data.homeCurrency}. Transfers, card payments and income are left out; refunds reduce spending.</div>
        </div>
        <div className="filters">
          <select value={query.months} onChange={(e) => set({ months: Number(e.target.value) })} aria-label="Period">
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                Last {n} months
              </option>
            ))}
          </select>
          <select value={query.endMonth ?? data.availableMonths[0]} onChange={(e) => set({ endMonth: e.target.value })} aria-label="Ending">
            {data.availableMonths.map((m) => (
              <option key={m} value={m}>
                to {monthLabel(m)}
              </option>
            ))}
          </select>
          <select value={query.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={query.categoryId ?? ''}
            onChange={(e) => set({ categoryId: e.target.value === '' ? undefined : e.target.value === 'uncategorized' ? 'uncategorized' : Number(e.target.value) })}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="uncategorized">Uncategorized</option>
          </select>
        </div>
      </div>

      {selected && (
        <div className="banner info">
          <span>Showing {selected} only.</span>
          <span>
            <button
              className="link"
              onClick={() => navigate({ page: 'transactions', query: { categoryId: query.categoryId, accountId: query.accountId, from, to } })}
            >
              View transactions
            </button>
            {'   '}
            <button className="link" onClick={() => set({ categoryId: undefined })}>
              Show all categories
            </button>
          </span>
        </div>
      )}

      <div className="grid kpis">
        <Stat label={`Total · ${data.months.length} months`} value={money(total, { whole: true })} />
        <Stat label="Monthly average" value={money(average, { whole: true })} />
        <Stat
          label={shortMonth(data.months[last])}
          value={money(latest, { whole: true })}
          sub={average ? `${latest >= average ? '+' : ''}${pct((latest - average) / average)} vs average` : undefined}
          tone={average && latest > average * 1.1 ? 'bad' : undefined}
        />
        <Stat label="Regular bills" value={total ? pct(fixedTotal / total) : '—'} sub="Share of spending that recurs" />
      </div>

      {!selected && query.accountId === undefined && (
        <Card title="Ways to save" className="mb">
          <InsightList insights={data.insights} navigate={navigate} />
        </Card>
      )}

      <Card title="Spending by month" className="mb">
        {total === 0 ? (
          <Empty>No spending in this period.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} fontSize={12} width={70} />
              <Tooltip formatter={tooltipMoney} />
              <Legend />
              {top.map((c) => (
                <Bar key={c.name} dataKey={c.name} stackId="s" fill={c.color} />
              ))}
              {data.categories.length > top.length && <Bar dataKey="Other" stackId="s" fill="#cbd5e1" />}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid halves">
        <Card title="Categories">
          {data.categories.length === 0 ? (
            <Empty>No spending in this period.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Trend</th>
                  <th className="num">Avg / mo</th>
                  <th className="num">{shortMonth(data.months[last])}</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.name} className="clickable" onClick={() => set({ categoryId: c.categoryId ?? 'uncategorized' })} title="Show only this category">
                    <td>
                      <span className="chip">
                        <span className="dot" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    </td>
                    <td>
                      <Trend values={c.monthly} />
                    </td>
                    <td className="num">
                      <Money cents={c.average} whole />
                    </td>
                    <td className={`num ${c.average && c.monthly[last] > c.average * 1.2 ? 'neg' : ''}`}>
                      <Money cents={c.monthly[last]} whole />
                    </td>
                    <td className="num">
                      <Money cents={c.total} whole />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Regular bills vs everyday spending">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.months.map((m, i) => ({ label: shortMonth(m), fixed: data.fixed[i], flexible: data.flexible[i] }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} fontSize={12} width={70} />
              <Tooltip formatter={tooltipMoney} />
              <Legend />
              <Bar dataKey="fixed" name="Bills & subscriptions" stackId="f" fill="#6366f1" />
              <Bar dataKey="flexible" name="Everyday" stackId="f" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Top merchants">
        {data.merchants.length === 0 ? (
          <Empty>No purchases in this period.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Trend</th>
                <th className="num">Purchases</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.merchants.map((m) => (
                <tr key={m.payee} className="clickable" onClick={() => navigate({ page: 'transactions', query: { search: m.payee, from, to } })}>
                  <td>{m.payee}</td>
                  <td>
                    <Trend values={m.monthly} />
                  </td>
                  <td className="num">{m.count}</td>
                  <td className="num">
                    <Money cents={m.total} whole />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
