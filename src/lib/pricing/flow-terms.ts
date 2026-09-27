/**
 * Flow Subscription Terms — an addendum to the general VFXnow Rental Terms & Conditions.
 * The wording lives in Settings (flow_subscription_terms); this module holds the default
 * clauses and fills an order's numbers into them. The approved quote is the binding
 * agreement, so the rendered output is frozen onto the order at approval.
 * Pure — no prisma, no 'use server', no next/*.
 */
import type { FlowClientQuote } from './flow-client-quote'

export type FlowTermsClause = { title: string; body: string }

export type FlowTermsSettings = {
  version: number
  cancellationPct: number
  extensionPct: number
  endNoticeDays: number
  generalTermsUrl: string
  clauses: FlowTermsClause[]
}

export type RenderedFlowTerms = {
  version: number
  clauses: FlowTermsClause[]
  cancellationExamples: { afterMonth: number; fee: number }[]
  extension: { pct: number; monthly: number; finalMonthly: number }
  generalTermsUrl: string
  /** Set when frozen at approval (ISO). */
  acceptedAt?: string
}

export const FLOW_TERMS_PLACEHOLDERS = [
  'termMonths', 'startDate', 'endDate', 'cancellationPct', 'extensionPct',
  'extensionMonthly', 'finalMonthly', 'endNoticeDays', 'termsUrl',
] as const

export const FLOW_TERMS_DEFAULTS: FlowTermsSettings = {
  version: 1,
  cancellationPct: 50,
  extensionPct: 50,
  endNoticeDays: 30,
  generalTermsUrl: 'https://vfxnow.com/terms',
  clauses: [
    { title: 'Subscription, not ownership', body: 'This is a {{termMonths}}-month Flow subscription starting {{startDate}}. The equipment remains VFXnow\'s property at all times. There is no buyout, purchase option or transfer of ownership, during or at the end of the term.' },
    { title: 'Payments and autopay', body: 'Monthly payments are billed in advance per the payment schedule in this agreement. Automatic payment (ACH or card) is required for the full term.' },
    { title: 'Early cancellation', body: 'You may cancel before the term ends with written notice. The cancellation fee is {{cancellationPct}}% of the scheduled payments remaining after the cancellation date, and all equipment must be returned. The cancellation table in this agreement shows the fee at points in your term.' },
    { title: 'VFXnow hardware support included', body: 'For the full term, VFXnow repairs or replaces VFXnow-supplied equipment that fails under normal use, at no extra charge. Damage, loss, theft and misuse are governed by the General Terms.' },
    { title: 'Adding equipment (co-terming)', body: 'Gear added during the term can be co-termed to end with this agreement. Its cost is recovered over the months that remain, so its monthly price is higher than on a new term — still one monthly bill. Alternatively, additions can go on a new agreement at then-current rates.' },
    { title: 'End of term', body: 'At least {{endNoticeDays}} days before {{endDate}} you must tell VFXnow which you choose: Extend — continue month-to-month at {{extensionMonthly}}/month ({{extensionPct}}% of your final payment of {{finalMonthly}}), with VFXnow support continuing; Return — return the equipment in good working order by {{endDate}} and the agreement ends; Refresh — return the equipment and start a new Flow agreement with new equipment. An election is required: equipment not returned by {{endDate}} and not covered by an agreed extension is overdue, and the late-return charges in the General Terms apply.' },
    { title: 'Protection of VFXnow\'s equipment', body: 'You keep the equipment free of liens and claims, and don\'t sell, sublease, lend or move it off the site on this agreement without VFXnow\'s written consent. If a payment fails and isn\'t made good within 10 days of notice, VFXnow may suspend support and recover the equipment, and the early-cancellation fee becomes due. Amounts owed under this agreement survive its end.' },
    { title: 'This addendum and the General Terms', body: 'These Flow terms are an addendum to the VFXnow Rental Terms & Conditions at {{termsUrl}}, which are part of this agreement and govern everything not covered here — including care and use of equipment, damage, loss, insurance, liability, indemnity and late payment. Order of precedence: (1) the pricing, schedule and equipment in this signed quote, (2) these Flow terms, (3) the General Terms. Where the General Terms conflict with these Flow terms — including any buyout, purchase-option or rent-to-own provision — these Flow terms control. By signing you confirm you have read and accept both.' },
  ],
}

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const longDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g

export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(FLOW_TERMS_PLACEHOLDERS)
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !known.has(k))
}

/**
 * The General Terms URL is rendered as a link on the public quote page, so only
 * http(s) is acceptable — never `javascript:`, `data:`, a bare path, or similar.
 * Shared by the save-side check (`saveFlowTermsSettings`) and the defensive
 * fallback below, so both agree on exactly one definition of "valid".
 */
export function isValidTermsUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

/**
 * Stored JSON merged over the defaults, so a key added later always has a
 * value. A stored `generalTermsUrl` that isn't http(s) — e.g. hand-edited in
 * the database, or written before the save-side check existed — falls back to
 * the default rather than being rendered as a link.
 */
export function mergeFlowTermsSettings(stored: unknown): FlowTermsSettings {
  if (!stored || typeof stored !== 'object') return structuredClone(FLOW_TERMS_DEFAULTS)
  const s = stored as Partial<FlowTermsSettings>
  const generalTermsUrl =
    typeof s.generalTermsUrl === 'string' && isValidTermsUrl(s.generalTermsUrl)
      ? s.generalTermsUrl
      : FLOW_TERMS_DEFAULTS.generalTermsUrl
  return {
    ...structuredClone(FLOW_TERMS_DEFAULTS),
    ...s,
    generalTermsUrl,
    clauses: Array.isArray(s.clauses) && s.clauses.length ? s.clauses : structuredClone(FLOW_TERMS_DEFAULTS.clauses),
  }
}

function exampleMonths(termMonths: number): number[] {
  if (termMonths <= 1) return []
  if (termMonths <= 6) return [1]
  const out: number[] = []
  for (let m = 6; m < termMonths; m += 6) out.push(m)
  return out
}

export function renderFlowTerms(
  settings: FlowTermsSettings,
  ctx: { termMonths: number; startDate: Date | string; endDate: Date | string; extensionPct?: number | null; quote: FlowClientQuote },
): RenderedFlowTerms {
  const rows = ctx.quote.rows
  const finalMonthly = rows.length ? rows[rows.length - 1].payment : 0
  const extPct = ctx.extensionPct ?? settings.extensionPct
  const extension = { pct: extPct, monthly: round2((finalMonthly * extPct) / 100), finalMonthly }

  const cancellationExamples = exampleMonths(ctx.termMonths)
    .filter((m) => rows[m - 1])
    .map((m) => ({ afterMonth: m, fee: round2((settings.cancellationPct / 100) * rows[m - 1].remaining) }))

  const values: Record<string, string> = {
    termMonths: String(ctx.termMonths),
    startDate: longDate(ctx.startDate),
    endDate: longDate(ctx.endDate),
    cancellationPct: String(settings.cancellationPct),
    extensionPct: String(extPct),
    extensionMonthly: money(extension.monthly),
    finalMonthly: money(finalMonthly),
    endNoticeDays: String(settings.endNoticeDays),
    termsUrl: settings.generalTermsUrl,
  }
  const fill = (t: string) => t.replace(PLACEHOLDER, (all, k: string) => values[k] ?? all)

  return {
    version: settings.version,
    clauses: settings.clauses.map((c) => ({ title: fill(c.title), body: fill(c.body) })),
    cancellationExamples,
    extension,
    generalTermsUrl: settings.generalTermsUrl,
  }
}
