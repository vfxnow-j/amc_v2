/**
 * Helpers for the Sold & Disposal report.
 *
 * Who a unit went to was never a structured field — it lives in free text on
 * `retiredTo`, `soldNotes`, and sometimes the unit's own `notes`, typed by hand
 * over years ("Sold to AMGI", "Sold on Ebay.", "Ebay", "Sold on eBay Order-13-13405-81524").
 * These helpers pull a consistent counterparty out of that text so the same
 * buyer collapses into one row instead of six.
 */

export type Disposition =
  | 'SOLD'
  | 'RECYCLED'
  | 'GIFTED'
  | 'DAMAGED'
  | 'STOLEN'
  | 'LOST'
  | 'RELEASED'
  | 'OTHER'
  | 'UNSPECIFIED'

export const dispositionLabels: Record<Disposition, string> = {
  SOLD: 'Sold',
  RECYCLED: 'Recycled',
  GIFTED: 'Gifted',
  DAMAGED: 'Damaged',
  STOLEN: 'Stolen',
  LOST: 'Lost',
  RELEASED: 'Released',
  OTHER: 'Other',
  UNSPECIFIED: 'Unspecified',
}

export const dispositionVariants: Record<
  Disposition,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  SOLD: 'default',
  RECYCLED: 'secondary',
  GIFTED: 'secondary',
  DAMAGED: 'destructive',
  STOLEN: 'destructive',
  LOST: 'destructive',
  RELEASED: 'outline',
  OTHER: 'outline',
  UNSPECIFIED: 'outline',
}

/** Lead-ins people type before the counterparty name. */
const LEAD_IN =
  /^(?:sold\s+(?:via|on|to|at|through|off)\s+|sold\s+|re?turned\s+to\s+|returned\s+|retired\s+to\s+|released\s+to\s+|gifted\s+to\s+|given\s+to\s+|donated\s+to\s+|shipped\s+to\s+|went\s+to\s+|to\s+)/i

/**
 * Phrases that describe what happened to a unit rather than who received it —
 * warehouse write-offs, recycling, condition notes. These are kept as the
 * disposition note but never counted as a buyer.
 */
const NON_RECIPIENT_PATTERNS: RegExp[] = [
  /^not\s+in\s+(?:warehouse|stock|inventory)/i,
  /^unverified/i,
  /^(?:e-?waste|recycle[dr]?|scrap(?:ped)?|trash(?:ed)?|disposed?|destroyed|junked?)\b/i,
  /^(?:eol|end\s+of\s+life)\b/i,
  /^non[-\s]?repairable/i,
  /^(?:parted|parts?\b|part\s+out)/i,
  /^(?:damaged|broken|dead|doa|faulty|defective)\b/i,
  /^(?:lost|missing|stolen)\b/i,
  /^asset\s+fix/i,
  /^stock\s+release/i,
  /^(?:retire[dr]?|write[-\s]?off|written\s+off)\b/i,
  /^(?:unknown|n\/?a|none|tbd|\?+)$/i,
]

/** Marketplaces and other channels that should collapse to one canonical name. */
const CHANNEL_ALIASES: { pattern: RegExp; name: string }[] = [
  { pattern: /\be-?bay\b/i, name: 'eBay' },
  { pattern: /\bcraigs\s?list\b/i, name: 'Craigslist' },
  { pattern: /\bfacebook\s+market(?:place)?\b|\bfb\s+market(?:place)?\b/i, name: 'Facebook Marketplace' },
  { pattern: /\bamazon\b/i, name: 'Amazon' },
  { pattern: /\boffer\s?up\b/i, name: 'OfferUp' },
]

/**
 * Best free-text description of where a unit went, preferring the most
 * deliberate field. `notes` is only consulted when it actually reads like a
 * disposal note — units carry all kinds of unrelated notes.
 */
export function pickDisposalText(
  retiredTo: string | null,
  soldNotes: string | null,
  notes: string | null
): string | null {
  const candidates = [retiredTo, soldNotes]
  for (const c of candidates) {
    const t = c?.trim()
    if (t) return t
  }
  const n = notes?.trim()
  if (n && /\b(sold|sale|e-?bay|recycle|scrap|donat|gift|dispos)/i.test(n)) return n
  return null
}

/**
 * Pull a counterparty name out of disposal free text, or null when the text
 * only describes the disposal itself.
 */
export function normalizeRecipient(raw: string | null | undefined): string | null {
  if (!raw) return null

  let text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null

  for (const { pattern, name } of CHANNEL_ALIASES) {
    if (pattern.test(text)) return name
  }

  // Strip lead-ins repeatedly ("Sold to" then a stray "to").
  let previous: string
  do {
    previous = text
    text = text.replace(LEAD_IN, '').trim()
  } while (text !== previous && text)

  // Drop trailing punctuation and trailing order/price detail.
  text = text
    .replace(/\s*(?:[-–—,;:]|\bfor\b)\s*\$[\d,.]+.*$/i, '')
    .replace(/\s*\border[-\s#]*[\w-]+\s*$/i, '')
    .replace(/[.,;:\s]+$/, '')
    .trim()

  if (!text) return null
  if (NON_RECIPIENT_PATTERNS.some((p) => p.test(text))) return null

  // "Shapes + Forms" and "Shapes & Forms" are the same company.
  text = text.replace(/\s*\+\s*/g, ' & ')

  return text
}

/** Grouping key so casing, punctuation, and "Inc." noise don't split a buyer. */
export function recipientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(?:inc|llc|ltd|corp|co|company|studios?|productions?)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Pull a dollar amount out of free text, e.g. "Sold on ebay for $600". */
export function extractPrice(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * How and when a unit left the fleet. Units still in service come back with
 * `disposed: false`; a SOLD/RETIRED unit gets its disposition, date, who it
 * went to and the sale price (recorded, else a figure in its disposal note).
 */
export function unitDisposal(unit: {
  status: string
  retirementReason: string | null
  soldAt: Date | null
  retiredAt: Date | null
  soldPrice: number | string | { toString(): string } | null
  retiredTo: string | null
  soldNotes: string | null
  notes: string | null
}) {
  const disposed = unit.status === 'SOLD' || unit.status === 'RETIRED'
  if (!disposed) {
    return { disposed, disposition: null, disposedAt: null, recipient: null, salePrice: null, salePriceSource: null }
  }
  const isSold = unit.status === 'SOLD' || unit.retirementReason === 'SOLD' || !!unit.soldAt
  const disposition: Disposition = isSold
    ? 'SOLD'
    : ((unit.retirementReason as Disposition | null) ?? 'UNSPECIFIED')
  const text = pickDisposalText(unit.retiredTo, unit.soldNotes, unit.notes)
  const recordedPrice = unit.soldPrice != null ? Number(unit.soldPrice) : null
  const notedPrice = recordedPrice == null && isSold ? extractPrice(text) : null
  return {
    disposed,
    disposition,
    disposedAt: unit.soldAt ?? unit.retiredAt,
    recipient: normalizeRecipient(text) ?? text,
    salePrice: recordedPrice ?? notedPrice,
    salePriceSource: (recordedPrice != null ? 'recorded' : notedPrice != null ? 'notes' : null) as 'recorded' | 'notes' | null,
  }
}

/** Bucket for units that have no sold/retired date at all. */
export const UNDATED_PERIOD = 'undated'

/** How the report buckets dates when you look at it by time period. */
export type PeriodGranularity = 'month' | 'quarter' | 'year'

export const periodGranularityLabels: Record<PeriodGranularity, string> = {
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
}

export function isPeriodGranularity(value: unknown): value is PeriodGranularity {
  return value === 'month' || value === 'quarter' || value === 'year'
}

/**
 * Bucket key for an ISO timestamp. Sliced off the ISO string rather than read
 * through a local Date so a sale stamped at UTC midnight can't slide into the
 * previous period for anyone west of UTC.
 */
export function periodKey(iso: string, granularity: PeriodGranularity): string {
  const year = iso.slice(0, 4)
  if (granularity === 'year') return year
  if (granularity === 'quarter') {
    const month = Number(iso.slice(5, 7))
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  }
  return iso.slice(0, 7)
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Human label for a `periodKey` value. */
export function periodLabel(key: string, granularity: PeriodGranularity): string {
  if (key === UNDATED_PERIOD) return 'No date'
  if (granularity === 'year') return key
  if (granularity === 'quarter') return `${key.slice(5)} ${key.slice(0, 4)}`
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`
}
