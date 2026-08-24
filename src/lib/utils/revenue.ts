import { Prisma } from '@/generated/prisma/client'

// Accepts either the base Prisma client or a transaction client — both expose
// the model delegates used here.
type DbClient = Prisma.TransactionClient

// Checkout statuses that represent realized revenue for a unit. Revenue is
// credited the moment an item is checked out (ACTIVE), stays credited while
// out (OVERDUE) and after return (RETURNED). Pending/approval and canceled
// checkouts are excluded.
const REVENUE_CHECKOUT_STATUSES = ['ACTIVE', 'OVERDUE', 'RETURNED'] as const

/**
 * Recompute and persist a unit's cumulative earned revenue.
 *
 * `AssetUnit.totalRevenue` is a cached figure derived from the unit's checkout
 * charges: the sum of `Checkout.totalCharge` across the unit's realized
 * checkouts. We DERIVE (set) rather than increment/decrement so the total can
 * never drift across checkout, check-in, cancellation, swap, and reset flows —
 * call this after any change to a unit's checkouts.
 */
export async function recomputeUnitRevenue(tx: DbClient, assetUnitId: string): Promise<void> {
  const agg = await tx.checkout.aggregate({
    where: {
      assetUnitId,
      status: { in: [...REVENUE_CHECKOUT_STATUSES] },
    },
    _sum: { totalCharge: true },
  })

  await tx.assetUnit.update({
    where: { id: assetUnitId },
    data: { totalRevenue: agg._sum.totalCharge ?? 0 },
  })
}
