import { useEffect, useState } from 'react'
import { CURRENCIES } from '../../../core/currency'
import type { CurrencySettings } from '../../../shared/types'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card, ErrorBanner } from '../components/ui'
import { shortDate } from '../format'

function CurrencyCard({ onChange, version }: Pick<PageProps, 'onChange' | 'version'>) {
  const [settings, setSettings] = useState<CurrencySettings | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    void api.getCurrencySettings().then(setSettings)
  }, [version])
  if (!settings) return null
  const home = settings.homeCurrency
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      onChange()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card title="Currencies" className="mb">
      <ErrorBanner error={error} />
      <div className="settings-row">
        <div>
          <strong>Main currency</strong>
          <p>Net worth, cash flow, spending and budgets are shown in this currency. Each account keeps its own currency.</p>
        </div>
        <select
          value={home}
          onChange={(e) => {
            const code = e.target.value
            const n = settings.accountCounts[home] ?? 0
            const move =
              n > 0 &&
              confirm(
                `${n} account${n === 1 ? ' is' : 's are'} set to ${home}. Are they actually in ${code}?\n\nOK: change them to ${code} (amounts stay the same).\nCancel: keep them in ${home} and convert them.`
              )
            void run(() => api.setHomeCurrency(code, move))
          }}
          aria-label="Main currency"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <div>
          <strong>Exchange rates</strong>
          <p>
            Daily reference rates from the European Central Bank
            {settings.ratesDate ? `, published ${shortDate(settings.ratesDate)}` : ''}. Downloading them sends no personal data. Type a rate to use your own
            instead.
          </p>
        </div>
        <button
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            const r = await api.refreshRates(true)
            setRefreshing(false)
            if (r.error) setError(r.error)
            else onChange()
          }}
        >
          {refreshing ? 'Downloading…' : 'Update rates'}
        </button>
      </div>
      {settings.rates.length === 0 ? (
        <p className="muted small">All your accounts are in {home}, so no conversion is needed.</p>
      ) : (
        <table>
          <tbody>
            {settings.rates.map((r) => {
              const draft = drafts[r.currency] ?? (r.homePerUnit == null ? '' : String(Number(r.homePerUnit.toFixed(4))))
              return (
                <tr key={r.currency}>
                  <td>
                    <strong>1 {r.currency}</strong> =
                  </td>
                  <td>
                    <input
                      style={{ width: 110, textAlign: 'right' }}
                      value={draft}
                      inputMode="decimal"
                      aria-label={`${home} per ${r.currency}`}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.currency]: e.target.value }))}
                    />{' '}
                    {home}
                  </td>
                  <td className="muted small">{r.manual ? 'Your rate' : r.homePerUnit == null ? 'No rate yet' : 'ECB rate'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button
                      disabled={drafts[r.currency] === undefined}
                      onClick={() =>
                        void run(async () => {
                          await api.setExchangeRate(r.currency, Number(draft))
                          setDrafts(({ [r.currency]: _, ...rest }) => rest)
                        })
                      }
                    >
                      Save
                    </button>{' '}
                    {r.manual && (
                      <button
                        className="link"
                        onClick={() =>
                          void run(async () => {
                            await api.setExchangeRate(r.currency, null)
                            setDrafts(({ [r.currency]: _, ...rest }) => rest)
                          })
                        }
                      >
                        Use ECB rate
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}

export function Settings({ onChange, navigate, version }: PageProps) {
  const [path, setPath] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    void api.getDataPath().then(setPath)
  }, [])

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      {notice && <div className="banner success">{notice}</div>}
      <CurrencyCard onChange={onChange} version={version} />
      <Card title="Your data">
        <div className="settings-row">
          <div>
            <strong>Storage location</strong>
            <p>
              Everything is stored in one SQLite file on this computer: <code>{path}</code>
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Back up</strong>
            <p>Save a copy of the database file. To restore, quit the app and replace the file above with the backup.</p>
          </div>
          <button onClick={async () => setNotice((await api.exportBackup()) ? 'Backup saved.' : null)}>Save backup…</button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Export transactions</strong>
            <p>All transactions as a CSV for spreadsheets or taxes.</p>
          </div>
          <button onClick={async () => setNotice((await api.exportTransactionsCsv()) ? 'Transactions exported.' : null)}>Export CSV…</button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Sample data</strong>
            <p>Add 12 months of made-up accounts and transactions to explore the app.</p>
          </div>
          <button
            onClick={async () => {
              await api.loadDemoData()
              onChange()
              navigate({ page: 'dashboard' })
            }}
          >
            Load sample data
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Erase everything</strong>
            <p>Deletes all accounts, transactions, budgets and custom rules, and restores the default categories.</p>
          </div>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Erase all data? Save a backup first if you might want it back.')) return
              await api.resetAll()
              onChange()
              setNotice('All data erased.')
            }}
          >
            Erase all data
          </button>
        </div>
      </Card>
    </>
  )
}
