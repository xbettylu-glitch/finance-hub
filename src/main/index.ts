import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { FinanceApi } from '../shared/types'
import { openDatabase } from './db'
import { currencyForLocale } from '../core/currency'
import { extractPdfText } from './pdf'
import { fetchEcbRates } from './rates'
import { FinanceStore } from './store'

const dataPath = process.env.FINANCE_HUB_DATA ?? join(app.getPath('userData'), 'finance-hub.db')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'Finance Hub',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

async function main(): Promise<void> {
  await app.whenReady()
  const { db, save } = await openDatabase(dataPath)
  let timer: NodeJS.Timeout | undefined
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    save()
  }
  const store = new FinanceStore(
    db,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 400)
    },
    currencyForLocale(app.getSystemLocale() || app.getLocale())
  )
  flush()

  const api: FinanceApi = {
    getDashboard: async (month) => store.getDashboard(month),
    listAccounts: async (includeArchived) => store.listAccounts(includeArchived),
    createAccount: async (input) => store.createAccount(input),
    updateAccount: async (id, patch) => store.updateAccount(id, patch),
    deleteAccount: async (id) => store.deleteAccount(id),
    listBalances: async (accountId) => store.listBalances(accountId),
    setBalance: async (accountId, date, balance) => store.setBalance(accountId, date, balance),
    deleteBalance: async (id) => store.deleteBalance(id),
    listTransactions: async (query) => store.listTransactions(query),
    addTransaction: async (input) => store.addTransaction(input),
    updateTransaction: async (id, patch) => store.updateTransaction(id, patch),
    deleteTransaction: async (id) => store.deleteTransaction(id),
    listCategories: async () => store.listCategories(),
    createCategory: async (input) => store.createCategory(input),
    updateCategory: async (id, patch) => store.updateCategory(id, patch),
    deleteCategory: async (id) => store.deleteCategory(id),
    listRules: async () => store.listRules(),
    createRule: async (pattern, categoryId, applyToExisting) => store.createRule(pattern, categoryId, applyToExisting),
    deleteRule: async (id) => store.deleteRule(id),
    applyRules: async (onlyUncategorized) => store.applyRules(onlyUncategorized),
    listBudgets: async () => store.listBudgets(),
    setBudget: async (categoryId, amount) => store.setBudget(categoryId, amount),
    getBudgetOverview: async (month) => store.getBudgetOverview(month),
    extractPdfText: async (data, password) => extractPdfText(data, password),
    previewImport: async (filename, text, options) => store.previewImport(filename, text, options),
    commitImport: async (request) => store.commitImport(request),
    loadDemoData: async () => store.loadDemoData(),
    resetAll: async () => store.resetAll(),
    getDataPath: async () => dataPath,
    getCurrencySettings: async () => store.getCurrencySettings(),
    setHomeCurrency: async (code, moveAccounts) => store.setHomeCurrency(code, moveAccounts),
    setExchangeRate: async (currency, homePerUnit) => store.setExchangeRate(currency, homePerUnit),
    refreshRates: async (force) => {
      if (!force && !store.ratesStale()) return { updated: false }
      try {
        const { date, perEur } = await fetchEcbRates()
        store.saveRates(date, perEur)
        return { updated: true }
      } catch (e) {
        return { updated: false, error: `Couldn't download exchange rates (${(e as Error).message}). Check your internet connection or enter rates yourself.` }
      }
    },
    exportBackup: async () => {
      const win = BrowserWindow.getFocusedWindow()
      const opts = { defaultPath: `finance-hub-backup-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: 'SQLite database', extensions: ['db'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, db.export())
      return res.filePath
    },
    exportTransactionsCsv: async () => {
      const win = BrowserWindow.getFocusedWindow()
      const opts = { defaultPath: 'transactions.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, store.transactionsCsv())
      return res.filePath
    }
  }

  ipcMain.handle('finance:api', async (_event, method: string, args: unknown[]) => {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Unknown method: ${method}`)
    const fn = api[method as keyof FinanceApi] as (...a: unknown[]) => Promise<unknown>
    return fn(...(Array.isArray(args) ? args : []))
  })

  app.on('before-quit', flush)
  app.on('window-all-closed', () => {
    flush()
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  createWindow()
}

void main()
