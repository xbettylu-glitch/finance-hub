import type { AccountType } from '../shared/types'
import { addDays, addMonths, daysInMonth, monthOf } from './dates'

export interface DemoData {
  accounts: { key: string; name: string; institution: string; type: AccountType }[]
  transactions: { account: string; date: string; amount: number; description: string }[]
  snapshots: { account: string; date: string; balance: number }[]
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Twelve months of realistic sample data ending at `asOf`, for exploring the app. */
export function generateDemoData(asOf: string, months = 12): DemoData {
  const rand = rng(42)
  const between = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
  const data: DemoData = {
    accounts: [
      { key: 'chk', name: 'Everyday Checking', institution: 'Chase', type: 'checking' },
      { key: 'sav', name: 'High-Yield Savings', institution: 'Ally', type: 'savings' },
      { key: 'cc', name: 'Sapphire Preferred', institution: 'Chase', type: 'credit_card' },
      { key: 'brk', name: 'Brokerage', institution: 'Vanguard', type: 'investment' },
      { key: 'ret', name: '401(k)', institution: 'Fidelity', type: 'retirement' },
      { key: 'home', name: 'Home', institution: 'Zillow estimate', type: 'property' },
      { key: 'mtg', name: 'Mortgage', institution: 'Rocket Mortgage', type: 'mortgage' }
    ],
    transactions: [],
    snapshots: []
  }
  const lastMonth = monthOf(asOf)
  const firstMonth = addMonths(lastMonth, -(months - 1))
  const start = `${firstMonth}-01`
  const tx = (account: string, date: string, amount: number, description: string): void => {
    if (date <= asOf && date >= start) data.transactions.push({ account, date, amount, description })
  }
  const snap = (account: string, date: string, balance: number): void => {
    if (date <= asOf) data.snapshots.push({ account, date, balance })
  }
  snap('chk', addDays(start, -1), 420_000)
  snap('sav', addDays(start, -1), 1_500_000)

  for (let d = start; d <= asOf; d = addDays(d, 14)) tx('chk', d, 325_000, 'ACME CORP PAYROLL DIRECT DEP')

  let savings = 1_500_000
  let brokerage = 4_200_000
  let retirement = 6_800_000
  let home = 52_000_000
  let mortgage = -38_500_000
  let cardPrev = 0

  for (let i = 0; i < months; i++) {
    const m = addMonths(firstMonth, i)
    const dim = daysInMonth(+m.slice(0, 4), +m.slice(5, 7))
    const day = (n: number): string => `${m}-${String(Math.min(n, dim)).padStart(2, '0')}`

    tx('chk', day(1), -245_000, 'ROCKET MORTGAGE PAYMENT')
    tx('chk', day(8), -between(95, 165), 'PG&E UTILITY BILL')
    tx('chk', day(12), -8_999, 'COMCAST XFINITY INTERNET')
    tx('chk', day(15), -7_500, 'VERIZON WIRELESS')
    tx('chk', day(18), -13_200, 'GEICO AUTO INSURANCE')
    tx('chk', day(3), -80_000, 'ONLINE TRANSFER TO SAVINGS')
    tx('sav', day(3), 80_000, 'ONLINE TRANSFER FROM CHECKING')
    tx('chk', day(5), -50_000, 'VANGUARD BUY INVESTMENT')
    if (cardPrev > 0) {
      tx('chk', day(25), -cardPrev, 'CHASE CREDIT CRD AUTOPAY')
      tx('cc', day(25), cardPrev, 'PAYMENT THANK YOU')
    }
    savings += 80_000
    const interest = Math.round((savings * 0.043) / 12)
    savings += interest
    tx('sav', day(dim), interest, 'INTEREST PAID')

    let cardTotal = 0
    const charge = (n: number, amount: number, desc: string): void => {
      cardTotal += amount
      tx('cc', day(n), -amount, desc)
    }
    for (const n of [2, 9, 16, 23, 30]) if (n <= dim) charge(n, between(55, 185), pick(['WHOLE FOODS MARKET #10234', "TRADER JOE'S #552", 'SAFEWAY #1823']))
    const dining = 6 + Math.floor(rand() * 6)
    for (let k = 0; k < dining; k++) charge(1 + Math.floor(rand() * dim), between(6, 85), pick(['STARBUCKS STORE 08812', 'CHIPOTLE 1734', 'DOORDASH*THAI BASIL', 'SQ *BLUE BOTTLE COFFEE', 'SWEETGREEN SOMA', 'LUCCA BISTRO']))
    charge(4, 1_549, 'NETFLIX.COM')
    charge(7, 1_199, 'SPOTIFY USA')
    charge(10, 299, 'APPLE.COM/BILL ICLOUD')
    charge(14, 2_499, 'PLANET FITNESS CLUB FEES')
    charge(6, between(38, 62), 'SHELL OIL 57442')
    charge(20, between(38, 62), 'CHEVRON 0091')
    const shopping = 2 + Math.floor(rand() * 4)
    for (let k = 0; k < shopping; k++) charge(1 + Math.floor(rand() * dim), between(12, 140), pick(['AMAZON MKTPL*2K4L19', 'TARGET 00012345', 'AMZN Mktp US*RT5', 'BEST BUY 00431']))
    if (rand() < 0.5) charge(11, between(12, 35), 'UBER *TRIP')
    if (rand() < 0.4) charge(19, between(18, 60), 'AMC THEATRES')
    if (rand() < 0.3) charge(22, between(15, 45), 'CVS/PHARMACY #0921')
    if (i % 4 === 2) {
      charge(13, between(280, 520), 'DELTA AIR LINES')
      charge(27, between(350, 700), 'MARRIOTT HOTELS')
    }
    if (m === lastMonth) cardPrev = 0
    else cardPrev = cardTotal

    brokerage = Math.round((brokerage + 50_000) * (1 + (rand() * 0.05 - 0.015)))
    retirement = Math.round((retirement + 115_000) * (1 + (rand() * 0.05 - 0.015)))
    home = Math.round(home * 1.003)
    mortgage += 72_000 + i * 300
    const end = day(dim) > asOf ? asOf : day(dim)
    snap('brk', end, brokerage)
    snap('ret', end, retirement)
    snap('home', end, home)
    snap('mtg', end, mortgage)
  }
  return data
}
