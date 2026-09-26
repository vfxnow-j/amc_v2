/**
 * Re-derive everything a Flow order stores from its lines, server-side. Ported from
 * v1's repriceFlowTx (src/lib/actions/reservations.ts ~302).
 *
 * The caller's rates and totals are never trusted for Flow: each active-package
 * line's rate is set to its per-unit CONTRACT value (priceFlowLines), the order
 * totals are rebuilt from those, and `flowMonthlyPayment` is the rate for the
 * period the order is in. The inputs come from flowInputsForOrder, the same call
 * the order page makes, so the stored numbers and the numbers on screen agree.
 * Funding rides along in that config for the economics, but it never moves the
 * price: the price chain and the schedule are built from the lines and the knobs.
 *
 * An asset line with no true cost yet gets it snapshotted here from the landed-cost
 * basis (and a missing basis filled, floored at true cost). It is never re-derived
 * after that. Throws, rolling the caller's transaction back, when the order cannot
 * be priced: no term, a component line, a line with no or an incomplete cost
 * basis, or an infeasible schedule.
 *
 * A no-op for every other order type. Flow is never invoiced by the billing run,
 * so a Flow order carries no `nextBillingDate`; the repricer clears one if any
 * path set it.
 *
 * Server-only and NOT a 'use server' module: it takes a transaction, so it must
 * never be exposed as an action.
 */
import type { Prisma } from '@/generated/prisma/client'
import { priceFlowLines } from '@/lib/pricing/flow-lines'
import { flowInputsForOrder } from './order-inputs'
import { flowSnapshotLineCost, flowStoredMoney } from './stored-money'

export async function repriceFlowTx(tx: Prisma.TransactionClient, reservationId: string): Promise<void> {
  const inputs = await flowInputsForOrder(tx, reservationId)
  if (!inputs) return // missing, or not a Flow order
  const { config, lines } = inputs
  if (!config) throw new Error('A Flow order needs a term before it can be priced.')
  if (lines.some((l) => l.parentId)) {
    throw new Error('Components are not supported on Flow orders — add each part as its own line.')
  }

  const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } })
  const activePackage = await tx.package.findFirst({ where: { reservationId, isActive: true } })

  // Snapshot true cost (and a missing basis) on asset lines that have not got one.
  const stored = await tx.reservationItem.findMany({
    where: { id: { in: lines.map((l) => l.itemId) } },
    select: { id: true, trueCost: true, costBasis: true },
  })
  const storedById = new Map(stored.map((s) => [s.id, s]))
  for (const line of lines) {
    const s = storedById.get(line.itemId)
    if (!line.assetId || !s || (s.trueCost != null && s.costBasis != null)) continue
    const snap = flowSnapshotLineCost(s, inputs.bases[line.assetId], line.name || 'A line')
    if (!snap.ok) throw new Error(snap.error)
    await tx.reservationItem.update({
      where: { id: line.itemId },
      data: { trueCost: snap.cost.trueCost, costBasis: snap.cost.costBasis },
    })
    line.trueCost = snap.cost.trueCost
    line.costBasis = snap.cost.costBasis
  }

  const priced = priceFlowLines(
    lines.map((l) => ({
      name: l.name,
      costBasis: l.costBasis,
      trueCost: l.trueCost,
      quantity: l.quantity,
      addedAtMonth: l.addedAtMonth,
    })),
    config,
  )
  if (!priced.ok) throw new Error(priced.problem || 'This Flow order cannot be priced.')

  const money = flowStoredMoney(lines, priced, {
    startDate: reservation.startDate,
    termMonths: config.termMonths,
    discountType: reservation.discountType,
    discountValue: reservation.discountValue,
    taxRate: reservation.taxRate,
    deliveryCost: activePackage?.deliveryCost != null ? activePackage.deliveryCost : reservation.deliveryCost,
    returnCost: activePackage?.returnCost != null ? activePackage.returnCost : reservation.returnCost,
    shippingMarginType: reservation.shippingMarginType,
    shippingMargin: reservation.shippingMargin,
    rentalCreditAmount: reservation.rentalCreditAmount,
    internalShippingCost: reservation.internalShippingCost,
    subRentalCost: reservation.subRentalCost,
    hardwareCost: reservation.hardwareCost,
  })

  const current = await tx.reservationItem.findMany({
    where: { id: { in: lines.map((l) => l.itemId) } },
    select: { id: true, rate: true, subtotal: true },
  })
  const currentById = new Map(current.map((c) => [c.id, c]))
  for (let k = 0; k < lines.length; k++) {
    const { rate, subtotal } = money.lines[k]
    const c = currentById.get(lines[k].itemId)
    if (c && Number(c.rate) === rate && Number(c.subtotal) === subtotal) continue
    await tx.reservationItem.update({ where: { id: lines[k].itemId }, data: { rate, subtotal } })
  }

  await tx.reservation.update({
    where: { id: reservationId },
    data: {
      subtotal: money.subtotal,
      discountAmount: money.discountAmount,
      taxAmount: money.taxAmount,
      total: money.total,
      totalCost: money.totalCost,
      totalMargin: money.totalMargin,
      flowContractValue: money.flowContractValue,
      flowMonthlyPayment: money.flowMonthlyPayment,
      endDate: money.endDate,
      nextBillingDate: null,
    },
  })
}
