import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_TYPES, isLiability, type AccountType, type AccountWithBalance, type ColumnMapping, type DateFormat, type ImportPreview, type ImportRequest, type ImportResult, type ParsedTransaction } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, ErrorBanner, Money } from '../components/ui'
import { centsFromInput, inputFromCents, shortDate } from '../format'

interface PendingFile {
  name: string
  text: string
  /** Set while a PDF waits for its password. */
  locked?: { data: Uint8Array; wrongPassword: boolean }
}

type RowEdits = NonNullable<ImportRequest['edits']>

const isPdf = (name: string): boolean => /\.pdf$/i.test(name)

/** Shows the text read from a PDF so an unrecognised layout can be diagnosed. */
function ExtractedText({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <details className="extracted-text">
      <summary>Show the text the app read</summary>
      <p className="muted">
        These are the lines found in the PDF. Transactions need a date at the start of the line and an amount at the end. To get help with this layout, copy a few
        transaction lines, replace names and numbers with made-up ones, and share them.
      </p>
      <textarea readOnly value={text} rows={14} />
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy text'}
      </button>
    </details>
  )
}

async function loadFile(f: File): Promise<PendingFile> {
  if (!isPdf(f.name)) return { name: f.name, text: await f.text() }
  const data = new Uint8Array(await f.arrayBuffer())
  return unlockPdf(f.name, data)
}

async function unlockPdf(name: string, data: Uint8Array, password?: string): Promise<PendingFile> {
  try {
    return { name, text: await api.extractPdfText(data, password) }
  } catch (e) {
    const message = (e as Error).message
    if (message === 'PDF_PASSWORD_REQUIRED' || message === 'PDF_PASSWORD_INCORRECT') {
      return { name, text: '', locked: { data, wrongPassword: message === 'PDF_PASSWORD_INCORRECT' } }
    }
    throw e
  }
}

function PreviewRow({
  txn,
  included,
  onToggle,
  onEdit
}: {
  txn: ParsedTransaction
  included: boolean
  onToggle: () => void
  onEdit: (patch: Partial<ParsedTransaction>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(txn.date)
  const [description, setDescription] = useState(txn.description)
  const [amount, setAmount] = useState(inputFromCents(txn.amount))
  const cents = centsFromInput(amount)
  const valid = Boolean(date) && description.trim() !== '' && cents !== null

  if (editing) {
    return (
      <tr>
        <td />
        <td>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        </td>
        <td>
          <input style={{ width: '100%' }} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </td>
        <td className="num">
          <input style={{ width: 110, textAlign: 'right' }} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        </td>
        <td className="num">
          <button
            className="link"
            disabled={!valid}
            onClick={() => {
              onEdit({ date, description: description.trim(), amount: cents! })
              setEditing(false)
            }}
          >
            Done
          </button>
        </td>
      </tr>
    )
  }
  return (
    <tr className={included ? undefined : 'excluded'}>
      <td>
        <input type="checkbox" checked={included} onChange={onToggle} aria-label={`Include ${txn.description}`} />
      </td>
      <td className="muted">{shortDate(txn.date)}</td>
      <td>{txn.description}</td>
      <td className="num">
        <Money cents={txn.amount} colored />
      </td>
      <td className="num">
        <button
          className="link"
          onClick={() => {
            setDate(txn.date)
            setDescription(txn.description)
            setAmount(inputFromCents(txn.amount))
            setEditing(true)
          }}
        >
          Edit
        </button>
      </td>
    </tr>
  )
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
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [edits, setEdits] = useState<RowEdits>({})
  const [password, setPassword] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const current = queue[0]

  const resetRows = (): void => {
    setExcluded(new Set())
    setEdits({})
  }

  useEffect(() => {
    void api.listAccounts().then(setAccounts)
  }, [version])

  // New file: detect everything from scratch.
  useEffect(() => {
    if (!current || current.locked) return
    resetRows()
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
    if (!current || current.locked || !preview) return
    resetRows()
    void api.previewImport(current.name, current.text, { mapping, dateFormat, invertAmounts: invert }).then(setPreview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, dateFormat, invert])

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    setError(null)
    try {
      const loaded = await Promise.all([...files].map(loadFile))
      setResults([])
      setQueue((q) => [...q, ...loaded])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const unlock = async (): Promise<void> => {
    if (!current?.locked) return
    setBusy(true)
    try {
      const file = await unlockPdf(current.name, current.locked.data, password)
      setPassword('')
      setQueue((q) => [file, ...q.slice(1)])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const skipFile = (): void => {
    setPreview(null)
    setPassword('')
    setQueue((q) => q.slice(1))
  }

  const rows = preview ? preview.transactions.map((t, i) => ({ ...t, ...edits[i] })) : []
  const includedCount = rows.length - excluded.size

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
        newAccount: target === 'new' ? { name: newName, institution: newInstitution, type: newType } : undefined,
        excluded: [...excluded],
        edits
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

      {!current && <ErrorBanner error={error} />}

      {current?.locked && (
        <Card title={current.name}>
          <ErrorBanner error={error} />
          <p>This PDF is password-protected. Enter the password you use to open it (often set by your bank, e.g. part of your account number or date of birth).</p>
          {current.locked.wrongPassword && <div className="banner warn">That password didn&apos;t work. Try again.</div>}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void unlock()
            }}
          >
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="PDF password" aria-label="PDF password" />
            <button className="primary" type="submit" disabled={busy || !password}>
              Unlock
            </button>
            <button type="button" onClick={skipFile}>
              Skip file
            </button>
          </form>
        </Card>
      )}

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
            <p className="muted">or click to choose · PDF, CSV, OFX, QFX or QBO · several at once is fine</p>
            <input ref={input} type="file" multiple accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo" hidden onChange={(e) => void addFiles(e.target.files)} />
          </div>
          <h3 style={{ marginTop: 20 }}>Where to get these files</h3>
          <ul className="muted" style={{ lineHeight: 1.7 }}>
            <li>
              Log in to your bank or card&apos;s website, open the account, and look for <strong>Download</strong> or <strong>Export</strong> next to the transaction list.
            </li>
            <li>
              Choose <strong>Quicken (QFX)</strong>, <strong>OFX</strong> or <strong>CSV</strong>. QFX/OFX is best: it includes the account number and balance, so repeat imports go to the right account automatically.
            </li>
            <li>
              Monthly <strong>PDF statements</strong> work too, for example older months that are no longer downloadable as CSV. Check the preview: you can untick or fix any row that was read wrong. Scanned (photographed) PDFs have no text and can&apos;t be read.
            </li>
            <li>Import as often as you like. Transactions you already imported are skipped.</li>
            <li>For investments, property or loans without downloads, add the account and update its balance from the Accounts page.</li>
          </ul>
        </Card>
      )}

      {current && !current.locked && preview && (
        <>
          <Card title={`${current.name}${queue.length > 1 ? ` (${queue.length - 1} more queued)` : ''}`} action={<span className="chip">{preview.format.toUpperCase()}</span>}>
            <ErrorBanner error={error} />
            {preview.errors.map((e) => (
              <div className="banner warn" key={e}>
                {e}
              </div>
            ))}
            {preview.format === 'pdf' && preview.transactions.length === 0 && current.text.trim() && <ExtractedText text={current.text} />}
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

              {preview.format === 'pdf' && (
                <>
                  <div className="banner info">Transactions were read from the PDF&apos;s text. Check them below: untick rows that aren&apos;t transactions and click Edit to fix any that were read wrong.</div>
                  <div className="mapping">
                    <label>
                      Date order
                      <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                        <option value="MDY">MM/DD</option>
                        <option value="DMY">DD/MM</option>
                      </select>
                    </label>
                  </div>
                </>
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
            title={`Preview · ${includedCount} of ${rows.length} transactions selected`}
            action={
              preview.ledgerBalance && (
                <span className="muted small">
                  Balance on {shortDate(preview.ledgerBalance.date)}: <Money cents={preview.ledgerBalance.balance} />
                </span>
              )
            }
          >
            <div className="preview-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        aria-label="Include all"
                        checked={excluded.size === 0}
                        onChange={() => setExcluded(excluded.size === 0 ? new Set(rows.map((_, i) => i)) : new Set())}
                      />
                    </th>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => (
                    <PreviewRow
                      key={`${current.name}-${i}-${t.date}-${t.amount}`}
                      txn={t}
                      included={!excluded.has(i)}
                      onToggle={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev)
                          if (next.has(i)) next.delete(i)
                          else next.add(i)
                          return next
                        })
                      }
                      onEdit={(patch) => setEdits((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {preview.skippedRows > 0 && preview.format === 'pdf' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                {preview.skippedRows} dated line{preview.skippedRows === 1 ? '' : 's'} didn&apos;t look like transactions and were left out.
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button onClick={skipFile}>Skip file</button>
              <button className="primary" disabled={busy || (includedCount === 0 && !preview.ledgerBalance) || (target === 'new' && !newName.trim())} onClick={() => void commit()}>
                {busy ? 'Importing…' : `Import ${includedCount} transaction${includedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
