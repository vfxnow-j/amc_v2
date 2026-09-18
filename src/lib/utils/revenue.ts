import { Prisma } from '@/generated/prisma/client'
import { applyOrderDiscount, earnedRevenue, type EarningCheckout } from '@/lib/billing/earned'
import { businessToday, type BillingAnchor } from '@/lib/billing/calendar'
import { roundMoney } from '@/lib/pricing/periods'
import { getBillingAnchor } from '@/lib/settings/business'

// Accepts either the base Prisma client or a transaction client — both expose
// the model delegates used here.
type DbClient = Prisma.TransactionClient

// Checkout statuses that represent realized revenue for a unit. Revenue is
// credited the moment an item is checked out (ACTIVE), stays credited while
// out (OVERDUE) and after return (RETURNED). Pending/approval and canceled
// checkouts are excluded.
const REVENUE_CHECKOUT_STATUSES = ['ACTIVE', 'OVERDUE', 'RETURNED'] as const

const lineSelect = { rate: true, pricingType: true, quantity: true, subtotal: true, isOneTime: true } as const

const checkoutEarningSelect = {
  id: true,
  assetUnitId: true,
  reservationId: true,
  status: true,
  checkoutDate: true,
  actualReturn: true,
  totalCharge: true,
  assetUnit: { select: { assetId: true } },
  reservation: {
    select: {
      reservationType: true,
      status: true,
      isRecurring: true,
      notBilled: true,
      billingCycleType: true,
      billingCycleDays: true,
      startDate: true,
      recurrenceEndDate: true,
      completedAt: true,
      discountType: true,
      discountValue: true,
      items: { select: { assetId: true, ...lineSelect }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  },
} satisfies Prisma.CheckoutSelect

type CheckoutRow = Prisma.CheckoutGetPayload<{ select: typeof checkoutEarningSelect }>

type Line = { rate: Prisma.Decimal; pricingType: string; quantity: number; subtotal: Prisma.Decimal; isOneTime: boolean }

function toEarning(c: CheckoutRow, linked: Line | undefined): EarningCheckout {
  const r = c.reservation
  // The line this unit went out on; an unlinked checkout takes the order's
  // first line for the asset, as v1 does.
  const line = linked ?? r?.items.find((i) => i.assetId === c.assetUnit.assetId) ?? null
  return {
    status: c.status,
    checkoutDate: c.checkoutDate,
    actualReturn: c.actualReturn,
    totalCharge: Number(c.totalCharge ?? 0),
    lineRate: line ? Number(line.rate) : null,
    linePricingType: line ? line.pricingType : null,
    lineQuantity: line ? line.quantity : null,
    lineSubtotal: line ? Number(line.subtotal) : null,
    lineOneTime: line?.isOneTime ?? false,
    order: r
      ? {
          reservationType: r.reservationType,
          status: r.status,
          isRecurring: r.isRecurring,
          notBilled: r.notBilled,
          billingCycleType: r.billingCycleType,
          billingCycleDays: r.billingCycleDays,
          startDate: r.startDate,
          recurrenceEndDate: r.recurrenceEndDate,
          completedAt: r.completedAt,
        }
      : null,
  }
}

/** Each unit's earned revenue, from its checkouts, net of discount, as of today. */
async function earnedByUnit(
  db: DbClient,
  where: Prisma.CheckoutWhereInput,
  anchor: BillingAnchor,
): Promise<Map<string, number>> {
  const realized = { status: { in: [...REVENUE_CHECKOUT_STATUSES] } }
  const checkouts = await db.checkout.findMany({ where: { ...where, ...realized }, select: checkoutEarningSelect })
  // A fixed discount is shared across the whole order, so its other checkouts
  // are needed even when only one unit is being recomputed.
  const wanted = new Set(checkouts.map((c) => c.id))
  const fixedOrders = [
    ...new Set(
      checkouts
        .filter((c) => c.reservation?.discountType === 'FIXED' && Number(c.reservation.discountValue ?? 0) > 0)
        .map((c) => c.reservationId as string),
    ),
  ]
  if (fixedOrders.length) {
    const siblings = await db.checkout.findMany({
      where: { reservationId: { in: fixedOrders }, id: { notIn: [...wanted] }, ...realized },
      select: checkoutEarningSelect,
    })
    checkouts.push(...siblings)
  }
  // `checkoutId` on the item-unit link is a plain column, not a relation.
  const links = await db.reservationItemUnit.findMany({
    where: { checkoutId: { in: checkouts.map((c) => c.id) } },
    select: { checkoutId: true, reservationItem: { select: lineSelect } },
  })
  const lineOf = new Map(links.map((l) => [l.checkoutId, l.reservationItem]))
  const today = businessToday()
  const byOrder = new Map<string, CheckoutRow[]>()
  for (const c of checkouts) {
    const key = c.reservationId ?? `checkout:${c.id}`
    byOrder.set(key, [...(byOrder.get(key) ?? []), c])
  }
  const totals = new Map<string, number>()
  for (const rows of byOrder.values()) {
    const gross = rows.map((c) => earnedRevenue(toEarning(c, lineOf.get(c.id)), anchor, today))
    const r = rows[0].reservation
    const net = r ? applyOrderDiscount(gross, { type: r.discountType, value: Number(r.discountValue ?? 0) }) : gross
    rows.forEach((c, i) => {
      if (!wanted.has(c.id)) return
      totals.set(c.assetUnitId, (totals.get(c.assetUnitId) ?? 0) + net[i])
    })
  }
  return totals
}

/**
 * Recompute and persist a unit's cumulative earned revenue.
 *
 * `AssetUnit.totalRevenue` is a cached figure derived from the unit's
 * checkouts: a one-off order contributes its checkout charge, a recurring one
 * the line's rate for every billing period the unit was out (see
 * `lib/billing/earned.ts`). We DERIVE (set) rather than increment/decrement so
 * the total can never drift across checkout, check-in, cancellation, swap, and
 * reset flows — call this after any change to a unit's checkouts. Recurring
 * revenue grows as each period starts, so `refreshUnitRevenue` re-derives every
 * unit daily.
 */
export async function recomputeUnitRevenue(tx: DbClient, assetUnitId: string): Promise<void> {
  const totals = await earnedByUnit(tx, { assetUnitId }, await getBillingAnchor())
  await tx.assetUnit.update({
    where: { id: assetUnitId },
    data: { totalRevenue: roundMoney(totals.get(assetUnitId) ?? 0) },
  })
}

/**
 * Re-derive every unit's earned revenue, writing only the ones that moved.
 * Run daily, so each new billing period is credited as it starts, and after a
 * sync from v1, whose checkouts and orders it is derived from.
 */
export async function refreshUnitRevenue(db: DbClient): Promise<{ checked: number; changed: number }> {
  const anchor = await getBillingAnchor()
  const totals = await earnedByUnit(db, {}, anchor)
  const units = await db.assetUnit.findMany({ select: { id: true, totalRevenue: true } })
  let changed = 0
  for (const unit of units) {
    const earned = roundMoney(totals.get(unit.id) ?? 0)
    if (Math.abs(Number(unit.totalRevenue ?? 0) - earned) < 0.005) continue
    await db.assetUnit.update({ where: { id: unit.id }, data: { totalRevenue: earned } })
    changed++
  }
  return { checked: units.length, changed }
}
