import type { CategoryKind } from '../shared/types'
import { daysBetween } from './dates'

export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; color: string }[] = [
  { name: 'Salary', kind: 'income', color: '#16a34a' },
  { name: 'Interest & Dividends', kind: 'income', color: '#22c55e' },
  { name: 'Other Income', kind: 'income', color: '#4ade80' },
  { name: 'Housing', kind: 'expense', color: '#6366f1' },
  { name: 'Utilities', kind: 'expense', color: '#0ea5e9' },
  { name: 'Groceries', kind: 'expense', color: '#f59e0b' },
  { name: 'Dining', kind: 'expense', color: '#f97316' },
  { name: 'Transportation', kind: 'expense', color: '#14b8a6' },
  { name: 'Shopping', kind: 'expense', color: '#ec4899' },
  { name: 'Entertainment', kind: 'expense', color: '#a855f7' },
  { name: 'Subscriptions', kind: 'expense', color: '#8b5cf6' },
  { name: 'Health', kind: 'expense', color: '#ef4444' },
  { name: 'Insurance', kind: 'expense', color: '#64748b' },
  { name: 'Travel', kind: 'expense', color: '#06b6d4' },
  { name: 'Education', kind: 'expense', color: '#84cc16' },
  { name: 'Personal Care', kind: 'expense', color: '#d946ef' },
  { name: 'Gifts & Donations', kind: 'expense', color: '#f43f5e' },
  { name: 'Fees & Charges', kind: 'expense', color: '#b91c1c' },
  { name: 'Taxes', kind: 'expense', color: '#78716c' },
  { name: 'Other Expenses', kind: 'expense', color: '#94a3b8' },
  { name: 'Transfer', kind: 'transfer', color: '#cbd5e1' },
  { name: 'Credit Card Payment', kind: 'transfer', color: '#cbd5e1' },
  { name: 'Investment Contribution', kind: 'transfer', color: '#cbd5e1' }
]

/** Ordered: earlier rules win, so specific patterns come before generic ones. */
export const DEFAULT_RULES: { pattern: string; category: string }[] = [
  { pattern: 'payment thank you|autopay payment|card payment|credit card payment|online payment received|payment received|epay|applecard gsbank|amex epayment|chase credit crd|citi card online|discover e-payment|capital one mobile pmt', category: 'Credit Card Payment' },
  { pattern: 'vanguard buy|fidelity contribution|401k contribution|schwab transfer|robinhood deposit|betterment|wealthfront|ira contribution', category: 'Investment Contribution' },
  { pattern: 'transfer to|transfer from|online transfer|internal transfer|xfer|zelle transfer to self', category: 'Transfer' },
  { pattern: 'payroll|direct dep|salary|paycheck|adp|gusto', category: 'Salary' },
  { pattern: 'interest paid|interest payment|dividend|div reinvest|interest earned', category: 'Interest & Dividends' },
  { pattern: 'uber eats|ubereats|doordash|grubhub|postmates|seamless|starbucks|dunkin|mcdonald|chipotle|subway|panera|chick-fil-a|taco bell|wendy|burger king|domino|pizza|restaurant|cafe|coffee|bistro|grill|sushi|bar &|kitchen|deli|bakery|sweetgreen|shake shack', category: 'Dining' },
  { pattern: 'whole foods|trader joe|safeway|kroger|costco|aldi|publix|wegmans|heb|h-e-b|albertsons|sprouts|instacart|grocery|market basket|food lion|giant eagle|stop & shop|vons|ralphs|meijer', category: 'Groceries' },
  { pattern: 'netflix|spotify|hulu|disney plus|disney+|hbo|max.com|apple.com/bill|itunes|youtube premium|youtube tv|amazon prime|prime video|audible|paramount|peacock|patreon|dropbox|icloud|google storage|google one|adobe|microsoft 365|chatgpt|openai|github|notion|nytimes|new york times|wsj|substack|duolingo|siriusxm', category: 'Subscriptions' },
  { pattern: 'airbnb|vrbo|expedia|booking.com|hotels.com|marriott|hilton|hyatt|delta air|united air|american air|southwest|jetblue|alaska air|airline|hotel|hertz|avis|enterprise rent', category: 'Travel' },
  { pattern: 'uber|lyft|shell|chevron|exxon|mobil|bp |arco|76 |valero|sunoco|citgo|speedway|wawa|gas station|fuel|parking|transit|metro|mta|bart|clipper|toll|e-zpass|ezpass|fastrak|dmv|jiffy lube|autozone|tesla supercharger', category: 'Transportation' },
  { pattern: 'rent|mortgage|hoa|property management|apartments|landlord|home depot|lowe', category: 'Housing' },
  { pattern: 'comcast|xfinity|verizon|at&t|t-mobile|tmobile|sprint|spectrum|cox comm|pg&e|pge|con edison|coned|duke energy|electric|water|sewer|gas co|utility|utilities|internet|fios|google fi|mint mobile', category: 'Utilities' },
  { pattern: 'geico|state farm|allstate|progressive|liberty mutual|insurance|lemonade|usaa ins', category: 'Insurance' },
  { pattern: 'cvs|walgreens|rite aid|pharmacy|doctor|dental|dentist|medical|hospital|clinic|health|optometr|vision|kaiser|labcorp|quest diag|gym|fitness|planet fitness|equinox|peloton|classpass', category: 'Health' },
  { pattern: 'amazon|amzn|target|walmart|best buy|ebay|etsy|apple store|ikea|wayfair|macy|nordstrom|tj maxx|marshalls|old navy|gap |uniqlo|zara|h&m|nike|sephora|ulta', category: 'Shopping' },
  { pattern: 'amc|regal|cinema|theater|theatre|ticketmaster|stubhub|eventbrite|steam|playstation|xbox|nintendo|bowling|museum|concert', category: 'Entertainment' },
  { pattern: 'tuition|university|college|school|udemy|coursera|books|barnes', category: 'Education' },
  { pattern: 'salon|barber|spa|nail|haircut', category: 'Personal Care' },
  { pattern: 'donation|charity|gofundme|red cross|unicef', category: 'Gifts & Donations' },
  { pattern: 'fee|overdraft|late charge|service charge|finance charge|interest charge|atm withdrawal fee|foreign transaction', category: 'Fees & Charges' },
  { pattern: 'irs|treas tax|franchise tax|tax payment|state tax', category: 'Taxes' }
]

const ACRONYMS = new Set(['usa', 'us', 'atm', 'irs', 'hbo', 'amc', 'tv', 'llc', 'ups', 'aaa', 'ikea'])

const PREFIXES = [
  /^(pos|debit card|debit|dbt|check card|checkcard|purchase|recurring|ach|ach debit|ach credit|card|visa|mc|sq|tst|pp|paypal|ppd|web|pmt)\b[\s*:#-]*/i,
  /^purchase authorized on \d{1,2}\/\d{1,2}\s*/i
]

/** Turns raw bank descriptions like "SQ *BLUE BOTTLE #1234 OAKLAND CA" into a stable payee name. */
export function normalizePayee(description: string): string {
  let s = description.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) for (const p of PREFIXES) s = s.replace(p, '')
  s = s
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/[#*]+\s*\w*\d\w*/g, ' ')
    .replace(/\b(x{2,}|\*{2,})\d+\b/gi, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\b(ref|id|conf|trace)[:#]?\s*\S+/gi, ' ')
    .replace(/\s+[A-Z]{2}\s*$/i, (m) => (/^\s+(?:inc|co|llc)$/i.test(m) ? m : ''))
    .replace(/[*#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) s = description.trim()
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (ACRONYMS.has(w) || /^[b-df-hj-np-tv-z&]{2,4}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .slice(0, 60)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface CompiledRule {
  categoryId: number
  re: RegExp
}

/** Rule patterns are case-insensitive "contains" matches; `|` separates alternatives. */
export function compileRule(pattern: string, categoryId: number): CompiledRule | null {
  const alts = pattern
    .split('|')
    .map((a) => a.toLowerCase())
    .filter((a) => a.trim() !== '')
  if (alts.length === 0) return null
  const body = alts.map((a) => `(?<![a-z0-9])${escapeRe(a)}(?![a-z])`).join('|')
  return { categoryId, re: new RegExp(body, 'i') }
}

export function categorize(rules: CompiledRule[], description: string, payee: string): number | null {
  const text = `${description} ${payee}`
  for (const r of rules) if (r.re.test(text)) return r.categoryId
  return null
}

/** Finds uncategorized pairs of opposite amounts in different accounts within a few days (e.g. checking -> savings). */
export function findTransferPairs(
  txns: { id: number; accountId: number; date: string; amount: number }[],
  windowDays = 3
): [number, number][] {
  const byAbs = new Map<number, typeof txns>()
  for (const t of txns) {
    if (t.amount === 0) continue
    const k = Math.abs(t.amount)
    const list = byAbs.get(k)
    if (list) list.push(t)
    else byAbs.set(k, [t])
  }
  const pairs: [number, number][] = []
  for (const list of byAbs.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.date.localeCompare(b.date))
    const used = new Set<number>()
    for (const out of list) {
      if (out.amount >= 0 || used.has(out.id)) continue
      const match = list.find(
        (inc) =>
          inc.amount > 0 &&
          !used.has(inc.id) &&
          inc.accountId !== out.accountId &&
          Math.abs(daysBetween(out.date, inc.date)) <= windowDays
      )
      if (match) {
        used.add(out.id)
        used.add(match.id)
        pairs.push([out.id, match.id])
      }
    }
  }
  return pairs
}
