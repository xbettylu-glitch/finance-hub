import { useEffect, useState } from 'react'
import type { Category, CategoryKind, Rule } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, ErrorBanner } from '../components/ui'
import { CategorySelect } from './Transactions'

const KIND_LABELS: Record<CategoryKind, string> = { income: 'Income', expense: 'Spending', transfer: 'Transfer (not counted)' }

export function Categories({ onChange, version }: PageProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [color, setColor] = useState('#6366f1')
  const [pattern, setPattern] = useState('')
  const [ruleCategory, setRuleCategory] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api.listCategories().then(setCategories)
    void api.listRules().then(setRules)
  }, [version])

  const byId = new Map(categories.map((c) => [c.id, c]))
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      setError(null)
      await fn()
      onChange()
    } catch (e) {
      setError((e as Error).message.includes('UNIQUE') ? 'A category with that name already exists.' : (e as Error).message)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Categories & rules</h1>
        <div className="actions">
          <button
            onClick={() =>
              guard(async () => {
                const n = await api.applyRules(false)
                setNotice(`Rules re-applied: ${n} transaction${n === 1 ? '' : 's'} updated. Categories you picked by hand were left alone.`)
              })
            }
          >
            Re-apply rules to all transactions
          </button>
        </div>
      </div>
      <ErrorBanner error={error} />
      {notice && <div className="banner success">{notice}</div>}
      <div className="grid halves">
        <Card title="Categories">
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault()
              void guard(async () => {
                await api.createCategory({ name, kind, color })
                setName('')
              })
            }}
          >
            <input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} required />
            <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              {Object.entries(KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
            <button type="submit" className="primary">
              Add
            </button>
          </form>
          <table>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 40 }}>
                    <input type="color" value={c.color} onChange={(e) => guard(() => api.updateCategory(c.id, { color: e.target.value }))} aria-label={`Color for ${c.name}`} />
                  </td>
                  <td>{c.name}</td>
                  <td>
                    <select value={c.kind} onChange={(e) => guard(() => api.updateCategory(c.id, { kind: e.target.value as CategoryKind }))}>
                      {Object.entries(KIND_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button
                      className="link danger"
                      onClick={() => {
                        if (confirm(`Delete "${c.name}"? Its transactions become uncategorized and its rules and budget are removed.`)) void guard(() => api.deleteCategory(c.id))
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
        <Card title="Auto-categorization rules">
          <p className="muted small" style={{ marginTop: 0 }}>
            When a transaction description contains the text (whole words, case-insensitive; separate alternatives with |), it gets the category. Your rules run before the built-in ones.
          </p>
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault()
              if (ruleCategory == null) return
              void guard(async () => {
                const { updated } = await api.createRule(pattern, ruleCategory, true)
                setNotice(`Rule added and applied to ${updated} existing transaction${updated === 1 ? '' : 's'}.`)
                setPattern('')
              })
            }}
          >
            <input placeholder="e.g. blue bottle|philz" value={pattern} onChange={(e) => setPattern(e.target.value)} required style={{ flex: 1 }} />
            <CategorySelect categories={categories} value={ruleCategory} onChange={setRuleCategory} allowNone={false} />
            <button type="submit" className="primary" disabled={ruleCategory == null}>
              Add rule
            </button>
          </form>
          <table>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code style={{ display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }} title={r.pattern}>
                      {r.pattern}
                    </code>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>→ {byId.get(r.categoryId)?.name}</td>
                  <td>
                    <span className={`chip ${r.priority > 0 ? 'custom' : ''}`}>{r.priority > 0 ? 'Yours' : 'Built-in'}</span>
                  </td>
                  <td className="num">
                    <button className="link danger" onClick={() => guard(() => api.deleteRule(r.id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
