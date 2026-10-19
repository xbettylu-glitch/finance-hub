import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_TYPES, isLiability, type AccountType, type AccountWithBalance, type ColumnMapping, type DateFormat, type ImportPreview, type ImportResult } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, ErrorBanner, Money } from '../components/ui'
import { shortDate } from '../format'

interface PendingFile {
  name: string
  text: string
}

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount (signed)' },
  { key: 'debit', label: 'Money out column' },
  { key: 'credit', label: 'Money in column' },
  { key: 'balance', label: 'Running balance' }
]

function guessName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\d{6,}/g, '').trim() || 'Imported account'
}

export function Import({ navigate, onChange, version }: PageProps) {
  const [queue, setQueue] = useState<PendingFile[]>([])
  const [drag, setDrag] = useState(false)
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | undefined>()
  const [dateFormat, setDateFormat] = useState<DateFormat>('auto')
  const [invert, setInvert] = useState(false)
  const [target, setTarget] = useState<number | 'new'>('new')
  const [newName, setNewName] = useState('')
  const [newInstitution, setNewInstitution] = useState('')
  const [newType, setNewType] = useState<AccountType>('checking')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{ file: string; result: ImportResult; account: string }[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const current = queue[0]

  useEffect(() => {
    void api.listAccounts().then(setAccounts)
  }, [version])

  // New file: detect everything from scratch.
  useEffect(() => {
    if (!current) return
    setMapping(undefined)
    setDateFormat('auto')
    setInvert(false)
    setError(null)
    void api.previewImport(current.name, current.text, {}).then((p) => {
      setPreview(p)
      setMapping(p.mapping)
      setDateFormat(p.dateFormat ?? 'auto')
      setTarget(p.matchedAccountId ?? 'new')
      setNewName(guessName(current.name))
      setNewInstitution(p.account?.institution ?? '')
      setNewType(p.account?.type ?? 'checking')
    })
  }, [current])

  // Options changed: re-parse.
  useEffect(() => {
    if (!current || !preview) return
    void api.previewImport(current.name, current.text, { mapping, dateFormat, invertAmounts: invert }).then(setPreview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, dateFormat, invert])

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    const loaded = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })))
    setResults([])
    setQueue((q) => [...q, ...loaded])
  }

  const targetType: AccountType | undefined = target === 'new' ? newType : accounts.find((a) => a.id === target)?.type
  const suggestInvert = preview && targetType && isLiability(targetType) && preview.positiveShare > 0.6 && !invert

  const commit = async (): Promise<void> => {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.commitImport({
        filename: current.name,
        text: current.text,
        options: { mapping, dateFormat, invertAmounts: invert },
        accountId: target === 'new' ? undefined : target,
        newAccount: target === 'new' ? { name: newName, institution: newInstitution, type: newType } : undefined
      })
      const account = target === 'new' ? newName : (accounts.find((a) => a.id === target)?.name ?? '')
      setResults((r) => [...r, { file: current.name, result, account }])
      setPreview(null)
      setQueue((q) => q.slice(1))
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Import statements</h1>
      </div>

      {results.map(({ file, result, account }) => (
        <div className="banner success" key={file + result.accountId}>
          <span>
            <strong>{file}</strong> → {account}: {result.added} new transaction{result.added === 1 ? '' : 's'}
            {result.duplicates > 0 && `, ${result.duplicates} already imported (skipped)`}
            {result.added > 0 && `, ${result.categorized} auto-categorized`}
            {result.transfersMatched > 0 && `, ${result.transfersMatched} matched as transfers`}
            {result.balanceUpdated && ', balance updated'}.
          </span>
          {queue.length === 0 && (
            <button className="link" onClick={() => navigate({ page: 'dashboard' })}>
              View overview
            </button>
          )}
        </div>
      ))}

      {!current && (
        <Card>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void addFiles(e.dataTransfer.files)
            }}
          >
            <h2>Drop statement files here</h2>
            <p className="muted">or click to choose · CSV, OFX, QFX or QBO · several at once is fine</p>
            <input ref={input} type="file" multiple accept=".csv,.txt,.ofx,.qfx,.qbo" hidden onChange={(e) => void addFiles(e.target.files)} />
          </div>
          <h3 style={{ marginTop: 20 }}>Where to get these files</h3>
          <ul className="muted" style={{ lineHeight: 1.7 }}>
            <li>
              Log in to your bank or card&apos;s website, open the account, and look for <strong>Download</strong> or <strong>Export</strong> next to the transaction list.
            </li>
            <li>
              Choose <strong>Quicken (QFX)</strong>, <strong>OFX</strong> or <strong>CSV</strong>. QFX/OFX is best: it includes the account number and balance, so repeat imports go to the right account automatically.
            </li>
            <li>Import as often as you like. Transactions you already imported are skipped.</li>
            <li>For investments, property or loans without downloads, add the account and update its balance from the Accounts page.</li>
          </ul>
        </Card>
      )}

      {current && preview && (
        <>
          <Card title={`${current.name}${queue.length > 1 ? ` (${queue.length - 1} more queued)` : ''}`} action={<span className="chip">{preview.format.toUpperCase()}</span>}>
            <ErrorBanner error={error} />
            {preview.errors.map((e) => (
              <div className="banner warn" key={e}>
                {e}
              </div>
            ))}
            <div className="form">
              <div className="row">
                <label>
                  Import into
                  <select value={target} onChange={(e) => setTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
                    <option value="new">+ New account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.institution ? ` · ${a.institution}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {preview.matchedAccountId != null && target === preview.matchedAccountId && (
                  <div className="muted small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                    Matched by account number {preview.account?.externalId}
                  </div>
                )}
              </div>
              {target === 'new' && (
                <div className="mapping">
                  <label>
                    Account name
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </label>
                  <label>
                    Institution
                    <input value={newInstitution} onChange={(e) => setNewInstitution(e.target.value)} />
                  </label>
                  <label>
                    Type
                    <select value={newType} onChange={(e) => setNewType(e.target.value as AccountType)}>
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {preview.format === 'csv' && preview.headers && (
                <>
                  <h3>Columns</h3>
                  <div className="mapping">
                    {MAPPING_FIELDS.map((f) => (
                      <label key={f.key}>
                        {f.label}
                        <select
                          value={mapping?.[f.key] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value)
                            setMapping((m) => ({ ...(m ?? { date: 0, description: 1 }), [f.key]: v }) as ColumnMapping)
                          }}
                        >
                          {!f.required && <option value="">(none)</option>}
                          {preview.headers!.map((h, i) => (
                            <option key={i} value={i}>
                              {h || `Column ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <label>
                      Date order
                      <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                        <option value="auto">Detect</option>
                        <option value="MDY">MM/DD/YYYY</option>
                        <option value="DMY">DD/MM/YYYY</option>
                        <option value="YMD">YYYY-MM-DD</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'inherit', fontSize: 14 }}>
                <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Flip signs (use when purchases show up as positive amounts)
              </label>
              {suggestInvert && (
                <div className="banner info">
                  Most amounts in this file are positive. Credit card exports often list purchases as positive, so you probably want to flip signs.
                  <button onClick={() => setInvert(true)}>Flip signs</button>
                </div>
              )}
            </div>
          </Card>

          <Card
            title={`Preview · ${preview.transactions.length} transactions`}
            action={
              preview.ledgerBalance && (
                <span className="muted small">
                  Balance on {shortDate(preview.ledgerBalance.date)}: <Money cents={preview.ledgerBalance.balance} />
                </span>
              )
            }
          >
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.transactions.slice(0, 12).map((t, i) => (
                  <tr key={i}>
                    <td className="muted">{shortDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td className="num">
                      <Money cents={t.amount} colored />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.transactions.length > 12 && <div className="muted small" style={{ marginTop: 8 }}>…and {preview.transactions.length - 12} more</div>}
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button
                onClick={() => {
                  setPreview(null)
                  setQueue((q) => q.slice(1))
                }}
              >
                Skip file
              </button>
              <button className="primary" disabled={busy || (preview.transactions.length === 0 && !preview.ledgerBalance) || (target === 'new' && !newName.trim())} onClick={() => void commit()}>
                {busy ? 'Importing…' : `Import ${preview.transactions.length} transactions`}
              </button>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
