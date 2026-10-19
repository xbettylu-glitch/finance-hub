# Finance Hub

A local-first desktop app (macOS, Windows, Linux) that brings all your accounts together into one view of your finances. Your data stays in a single SQLite file on your computer. Nothing is uploaded.

## What it shows

- **Net worth** over the last 12 months, with assets vs. liabilities and the change over 30 days
- **Accounts** grouped as cash, investments, property, credit cards and loans, each with its current balance
- **Cash flow**: income vs. spending by month. Transfers and card payments are excluded so they aren't double counted.
- **Spending by category** and **top merchants** for any month
- **Budgets**: monthly limits per category, with a 3-month average to help you pick realistic numbers
- **Bills & subscriptions**: recurring charges found automatically, with their next expected date and monthly cost
- **Savings rate** and **emergency fund** (months of spending your cash would cover)

## Getting your data in

- **Multiple currencies**: each account has its own currency (GBP, EUR, USD, CAD, …), guessed from the statement when importing. Net worth, cash flow, spending and budgets are converted to one main currency (Settings → Currencies) using the European Central Bank's daily reference rates, downloaded from frankfurter.dev (no personal data is sent). You can type your own rate instead. History is converted at the latest rates, and transfers are only matched between accounts in the same currency.
- **Import statements**: PDF, CSV, OFX, QFX or QBO files downloaded from your bank or card's website.
  - Columns are detected automatically and can be mapped by hand. This covers debit/credit columns, preamble lines, header-less files, DD/MM dates and sign flipping for card exports.
  - OFX/QFX files are matched to the right account by account number, and the statement balance is recorded.
  - PDF statements are read from their text. The app finds the dated transaction lines, then works out money in vs. out from the running balance, the +/−/CR/DR markers, or section headings like "Deposits" and "Withdrawals". It also picks up the account number, the bank's name and the closing balance. In the preview you can untick or edit rows before importing, and password-protected PDFs ask for their password. Scanned (image-only) PDFs can't be read. UK and Canadian statements work too: £/€/C$ amounts and amounts like "12.34 GBP", day-first dates on British statements, "12 Oct 2026" and "OCT 12 OCT 13" dates, descriptions that wrap onto the next line, and dates printed under the description (Wise). Banks are recognised by name, including Amex, Yonder, Revolut, Wise, Monzo, Barclays, RBC, BMO, Rogers Bank, TD, Scotiabank and CIBC. If a PDF finds no transactions, **Show the text the app read** shows what the app read, to help diagnose the layout.
  - Re-importing a file, or importing overlapping date ranges, skips transactions that are already there.
  - Transactions are categorized by about 20 built-in rules plus any rules you add. Matching opposite amounts between your own accounts are marked as transfers.
- **Manual balances**: for a 401(k), your home, a car or a loan, enter the balance from time to time and the app builds the history.
- **Manual transactions**: for cash spending.
- **Sample data**: load 12 months of made-up data to explore the app (Settings → Load sample data).

## Install on a Mac

1. Open the [latest release](https://github.com/xbettylu-glitch/finance-hub/releases/latest) and download the `.dmg` for your Mac. Choose `arm64` for Apple Silicon (M1–M4) or `x64` for Intel. To check which you have, open  → About This Mac.
2. Open the `.dmg` and drag **Finance Hub** into **Applications**.
3. The first time you open it, macOS says it can't verify the app, because it isn't signed with a paid Apple developer certificate. Click **Done**. Then open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** and confirm. After that it opens normally.

Every change merged into `main` builds a new installer automatically (GitHub Actions → **Mac app**). Bump `version` in `package.json` to publish it as a new release.

## Running it from source

Requires Node.js 20+.

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit tests (parsers, analytics, database)
npm run typecheck
npm run dist:mac   # or dist:win / dist:linux, builds an installer into release/
```

The database lives in the OS app-data folder (shown under Settings). Set `FINANCE_HUB_DATA=/path/to/file.db` to use a different file.

## How it's built

| Path | What's there |
| --- | --- |
| `src/core/` | Pure TypeScript logic: CSV/OFX/PDF-statement parsing, dates & amounts, payee cleanup, rules, transfer matching, balance history, cash flow, recurring detection, demo data |
| `src/main/` | Electron main process: `store.ts` (SQLite schema and queries through sql.js), `db.ts` (load/save the file), `pdf.ts` (PDF text extraction with pdf.js), `index.ts` (window and IPC) |
| `src/preload/` | Exposes a single `invoke` bridge to the UI (context isolation on, sandboxed, no Node access in the UI) |
| `src/renderer/` | React UI: Overview, Accounts, Transactions, Budgets, Import, Categories & rules, Settings |
| `tests/` | Vitest suites and sample bank files |

Amounts are stored as integer cents. Asset balances are positive and liability balances negative. An account's balance on any date is the nearest balance snapshot plus the transactions between the snapshot and that date. Without any snapshot, it is the running total of its transactions.

## Roadmap ideas

- Automatic bank sync through Plaid / SimpleFIN (needs API keys)
- Investment holdings and performance
- Multi-currency
- Encrypted database file
