/**
 * Whether an order's next invoice is its FIRST billing-stretch invoice — the one
 * that carries the one-time lines, the fixed discount and delivery/return
 * (lib/billing/cycle-invoice.ts). The billing run, the manual first invoice
 * (createInvoiceFromReservation) and checkout's auto-invoice all decide "first"
 * here, so none of them can steal it from the others.
 *
 * "First" means no prior CYCLE invoice, not no prior invoice at all: an add-on
 * invoice (createInvoiceForAddOns) or a hand-made one bills something else, and
 * counting it used to leave the order's discount, one-time lines and delivery
 * never billed. A cycle invoice is a non-void one stamped with the stretch it
 * bills — `periodNumber` or `periodStartDate` — which every stretch invoice
 * those three paths create now carries.
 *
 * Invoices from before the stamping (CYCLE_STAMPS_SINCE) count as cycle
 * invoices whatever they carry. On 2026-09-26 no invoice in v2 had either stamp,
 * yet every active recurring rental that had one had already been billed its
 * first stretch by the old auto-invoice; without this, the next billing run
 * would bill their one-time lines and delivery a second time. The old rule
 * (any prior invoice) is what applied to them when they were raised.
 *
 * Pure — no prisma import, no next.
 */
import { stretchLabel } from './calendar'
import { formatPeriodCount } from '@/lib/pricing/periods'

/** Stretch invoices are stamped from here on; anything older counts as one. */
export const CYCLE_STAMPS_SINCE = new Date('2026-09-27T00:00:00Z')

const NOT_VOID: ('VOID' | 'CANCELLED')[] = ['VOID', 'CANCELLED']

/** The prisma `where` for an order's prior cycle invoices — count it, and zero means first. */
export function priorCycleInvoiceWhere(reservationId: string) {
  return {
    reservationId,
    status: { notIn: NOT_VOID },
    OR: [
      { periodNumber: { not: null } },
      { periodStartDate: { not: null } },
      { createdAt: { lt: CYCLE_STAMPS_SINCE } },
    ],
  }
}

/** The same rule as {@link priorCycleInvoiceWhere}, for one invoice already in hand. */
export function isCycleInvoice(invoice: {
  status: string
  periodNumber: number | null
  periodStartDate: Date | null
  createdAt: Date
}): boolean {
  if ((NOT_VOID as string[]).includes(invoice.status)) return false
  return (
    invoice.periodNumber != null ||
    invoice.periodStartDate != null ||
    invoice.createdAt.getTime() < CYCLE_STAMPS_SINCE.getTime()
  )
}

/** True when none of the order's invoices so far is a cycle invoice. */
export function isFirstCycleInvoice(
  prior: { status: string; periodNumber: number | null; periodStartDate: Date | null; createdAt: Date }[],
): boolean {
  return !prior.some(isCycleInvoice)
}

/**
 * The note a first stretch adds inside each recurring line's "(… rate)" label —
 * " × 0.37, Sep 20 – Sep 30" — or nothing when it is one whole period (or has
 * no stretch). The same wording on the auto-invoice and the manual one.
 */
export function firstStretchNote(stretch: { start: Date; end: Date; periods: number } | null): string {
  return stretch && Math.abs(stretch.periods - 1) >= 0.0005
    ? ` × ${formatPeriodCount(stretch.periods)}, ${stretchLabel(stretch.start, stretch.end)}`
    : ''
}
