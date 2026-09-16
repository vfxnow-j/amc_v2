/**
 * Keeping hardware, purchase orders and loans in step.
 *
 * A PO carries the financing (`PurchaseOrder.leaseId`); the units received
 * against it inherit that financing. When the financing changes — a funding
 * request gets funded, or someone assigns a PO to a loan by hand — the units
 * already received have to follow the money rather than being stranded on the
 * ownership they happened to be received with.
 *
 * These run inside an existing transaction so the PO row and its units can
 * never disagree about which loan paid for them.
 */

export type LeaseForSync = {
  id: string
  leaseName: string
  lender: string
  /** Carried for callers' convenience; deliberately not written to units. */
  totalAmount: unknown
  endDate: Date
}

/**
 * Push a PO's financing down onto the units received against it.
 *
 * Only ever touches units stamped with this PO — hand-added and imported units
 * carry no `purchaseOrderId` and are left alone.
 */
export async function syncUnitsToPurchaseOrderLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  poId: string,
  lease: LeaseForSync | null,
  /** How the PO itself was paid for — what units revert to when unassigned. */
  fallbackPurchaseMethod: string | null
): Promise<void> {
  if (lease) {
    await tx.assetUnit.updateMany({
      where: { purchaseOrderId: poId },
      data: {
        leaseId: lease.id,
        ownershipType: 'LOAN',
        loanName: lease.leaseName,
        fundingBusiness: lease.lender,
        // v1 also writes `loanAmount: lease.totalAmount` here. v2 does not: that
        // stamps the WHOLE lease onto every unit, so anything summing the column
        // counts the loan once per unit (docs/build-plan.md, data gap 7 — a 432x
        // overstatement). The unit's lease link is the fact; the amount lives on
        // the lease. Existing values are left as found, not repaired on a guess.
        amortizationEndDate: lease.endDate,
      },
    })
    return
  }

  await tx.assetUnit.updateMany({
    where: { purchaseOrderId: poId },
    data: {
      leaseId: null,
      ownershipType: fallbackPurchaseMethod ?? 'CASH',
      loanName: null,
      fundingBusiness: null,
      // Cleared rather than left: a unit taken off its loan has no loan amount,
      // and a stale lease total is exactly the value data gap 7 warns about.
      loanAmount: null,
      amortizationEndDate: null,
    },
  })
}

/**
 * Put a set of purchase orders — and everything received against them — onto a
 * loan. Used when a funding request is marked funded: the POs already attached
 * to the request roll onto the loan in one step.
 *
 * POs already assigned to a *different* loan are left alone; re-pointing those
 * is a deliberate act, not a side effect of funding a request. Returns the ids
 * actually moved.
 */
export async function assignPurchaseOrdersToLeaseTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  poIds: string[],
  lease: LeaseForSync
): Promise<string[]> {
  if (poIds.length === 0) return []

  const unassigned: { id: string; purchaseMethod: string | null }[] =
    await tx.purchaseOrder.findMany({
      where: { id: { in: poIds }, OR: [{ leaseId: null }, { leaseId: lease.id }] },
      select: { id: true, purchaseMethod: true },
    })

  for (const po of unassigned) {
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { leaseId: lease.id, purchaseMethod: 'LOAN' },
    })
    await syncUnitsToPurchaseOrderLease(tx, po.id, lease, po.purchaseMethod)
  }

  return unassigned.map((po) => po.id)
}
