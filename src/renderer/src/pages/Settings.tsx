import { useEffect, useState } from 'react'
import type { PageProps } from '../App'
import { api } from '../api'
import { Card } from '../components/ui'

export function Settings({ onChange, navigate }: PageProps) {
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
