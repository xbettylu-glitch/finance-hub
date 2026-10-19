import { useEffect, useState } from 'react'
import { addMonths, monthOf, todayIso } from '../../../core/dates'
import type { BudgetOverviewRow } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, Money, Progress } from '../components/ui'
import { centsFromInput, inputFromCents, money, monthLabel } from '../format'

function BudgetInput({ row, onSaved }: { row: BudgetOverviewRow; onSaved: () => void }) {
  const [value, setValue] = useState(row.budget ? inputFromCents(row.budget) : '')
  useEffect(() => setValue(row.budget ? inputFromCents(row.budget) : ''), [row.budget])
  const save = async (): Promise<void> => {
    const cents = value.trim() === '' ? 0 : centsFromInput(value)
    if (cents == null || cents === row.budget) return
    await api.setBudget(row.category.id, cents)
    onSaved()
  }
  return (
    <input
      style={{ width: 110, textAlign: 'right' }}
      value={value}
      placeholder="—"
      inputMode="decimal"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={`Budget for ${row.category.name}`}
    />
  )
}

export function Budgets({ onChange, version }: PageProps) {
  const [month, setMonth] = useState(monthOf(todayIso()))
  const [rows, setRows] = useState<BudgetOverviewRow[]>([])

  useEffect(() => {
    void api.getBudgetOverview(month).then((r) => setRows(r.rows))
  }, [month, version])

  const budgeted = rows.filter((r) => r.budget > 0)
  const totalBudget = budgeted.reduce((s, r) => s + r.budget, 0)
  const totalSpent = budgeted.reduce((s, r) => s + r.spent, 0)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <div className="muted small">Set a monthly limit per category. The 3-month average helps you pick realistic numbers.</div>
        </div>
        <div className="actions">
          <button onClick={() => setMonth((m) => addMonths(m, -1))}>‹</button>
          <strong style={{ minWidth: 90, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <button onClick={() => setMonth((m) => addMonths(m, 1))} disabled={month >= monthOf(todayIso())}>
            ›
          </button>
        </div>
      </div>
      {budgeted.length > 0 && (
        <div className="grid kpis">
          <div className="stat">
            <div className="stat-label">Budgeted</div>
            <div className="stat-value">{money(totalBudget, { whole: true })}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Spent</div>
            <div className={`stat-value ${totalSpent > totalBudget ? 'bad' : ''}`}>{money(totalSpent, { whole: true })}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Left</div>
            <div className={`stat-value ${totalBudget - totalSpent < 0 ? 'bad' : 'good'}`}>{money(totalBudget - totalSpent, { whole: true })}</div>
          </div>
        </div>
      )}
      <Card>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">3-mo average</th>
              <th className="num">Spent</th>
              <th style={{ width: '30%' }} />
              <th className="num">Monthly budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category.id}>
                <td>
                  <span className="dot" style={{ background: r.category.color }} />
                  {r.category.name}
                </td>
                <td className="num muted">{r.average ? <Money cents={r.average} whole /> : '—'}</td>
                <td className={`num ${r.budget && r.spent > r.budget ? 'neg' : ''}`}>{r.spent ? <Money cents={r.spent} /> : '—'}</td>
                <td>{r.budget > 0 && <Progress value={r.spent} max={r.budget} color={r.category.color} />}</td>
                <td className="num">
                  <BudgetInput row={r} onSaved={onChange} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
