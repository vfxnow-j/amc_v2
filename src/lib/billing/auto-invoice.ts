/**
 * Checkout's auto-invoice for a recurring rental's FIRST stretch, priced the one
 * way every first invoice is priced (lib/billing/cycle-invoice.ts): only the
 * chosen quote option, parts included in a system's price left out, one-time
 * lines once and whole, the discount, delivery and return. It used to bill
 * every package's lines at rate × stub, one-time lines × the stub too, and no
 * discount or delivery — and then, being "an invoice", stopped the billing run
 * from ever billing them (found 2026-09-26).
 *
 * Each priced line keeps the order line it came from, so a later checkout's
 * auto-invoice sees those lines as already billed. Pure — no prisma, no next.
 */
import {
  cycleInvoice,
  scopeChosenItems,
  toCycleLine,
  type CycleInvoice,
  type CycleInvoiceLine,
  type CycleTerms,
} from './cycle-invoice'

export type AutoInvoiceItem = {
  id: string
  parentId: string | null
  cloudProductId?: string | null
  packageId: string | null
  package?: { isActive: boolean | null } | null
  asset?: { name: string } | null
  description?: string | null
  assetId: string | null
  rate: unknown
  quantity?: number | null
  pricingType: string
  isOneTime?: boolean | null
  includedInParent?: boolean | null
}

export type AutoInvoiceLine = CycleInvoiceLine & {
  /** The order line billed; null for the discount, delivery and return. */
  reservationItemId: string | null
  /** The billed line's parent order line, for nesting on the invoice. */
  parentReservationItemId: string | null
}

/**
 * The lines an auto-invoice may bill at all: the chosen option's, minus a
 * cloud host's hidden $0 config rows and parts already in their system's price.
 */
export function autoInvoiceScope<T extends AutoInvoiceItem>(items: T[]): T[] {
  return scopeChosenItems(items).filter((item) => !(item.parentId && item.cloudProductId) && !item.includedInParent)
}

export function firstCycleAutoInvoice(input: {
  items: AutoInvoiceItem[]
  /** Periods' worth the first stretch bills (firstInvoiceStretch), 1 when it has none. */
  share: number
  terms: CycleTerms
  shareNote?: string
}): { priced: CycleInvoice; lines: AutoInvoiceLine[] } {
  const billed = autoInvoiceScope(input.items)
  const priced = cycleInvoice({
    lines: billed.map(toCycleLine),
    share: input.share,
    first: true,
    terms: input.terms,
    shareNote: input.shareNote,
  })
  // On the first stretch cycleInvoice emits one line per billed item, in order
  // (nothing here is included or skipped as a later one-time), then the
  // discount, delivery and return.
  const lines = priced.items.map((line, i): AutoInvoiceLine => ({
    ...line,
    reservationItemId: i < billed.length ? billed[i].id : null,
    parentReservationItemId: i < billed.length ? billed[i].parentId : null,
  }))
  return { priced, lines }
}
