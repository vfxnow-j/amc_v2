// PO landed cost: spread a PO's extras (freight + fees + tax − discount) over
// its tracked asset lines by value, so each received unit carries its true
// cost. Pure and client-safe; the DB write lives in purchase-orders.ts.

export interface LandedCostLine {
  id: string
  assetId: string | null
  isInventoried: boolean
  quantity: number
  unitPrice: number
}

export interface LandedCostPO {
  discountAmount: number
  freightAmount: number
  feesTotal: number
  taxAmount: number
  items: LandedCostLine[]
}

type NumLike = number | string | { toString(): string } | null | undefined
const num = (v: NumLike) => Number(v ?? 0) || 0
const round2 = (n: number) => Math.round(n * 100) / 100

export function toLandedCostPO(po: {
  discountAmount: NumLike
  freightAmount: NumLike
  feesTotal: NumLike
  taxAmount: NumLike
  items: { id: string; assetId: string | null; isInventoried: boolean; quantity: number; unitPrice: NumLike }[]
}): LandedCostPO {
  return {
    discountAmount: num(po.discountAmount),
    freightAmount: num(po.freightAmount),
    feesTotal: num(po.feesTotal),
    taxAmount: num(po.taxAmount),
    items: po.items.map((i) => ({
      id: i.id,
      assetId: i.assetId,
      isInventoried: i.isInventoried,
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
    })),
  }
}

/**
 * Per-unit landed adjustment for each tracked line, keyed by POItem id.
 * Shares use ORDERED quantity, so a partial receipt gives every unit the same
 * figure. Each share is rounded to cents; the few cents of drift against the
 * PO total are accepted rather than pushed onto one unit.
 */
export function allocateLandedCost(po: LandedCostPO): Map<string, number> {
  const tracked = po.items.filter((i) => i.isInventoried)
  const out = new Map<string, number>()
  const assetValue = tracked.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const netExtras = po.freightAmount + po.feesTotal + po.taxAmount - po.discountAmount
  for (const line of tracked) {
    out.set(line.id, assetValue > 0 ? round2((netExtras * line.unitPrice) / assetValue) : 0)
  }
  return out
}

/**
 * The adjustment for one received unit: the tracked line with the same asset
 * AND the same unit price. A unit whose price differs from every line was
 * priced by hand at receipt (and may already include extras), so it gets
 * null and is left alone.
 */
export function landedAdjustmentForUnit(
  po: LandedCostPO,
  allocation: Map<string, number>,
  unit: { assetId: string; purchasePrice: number | null },
): number | null {
  const price = unit.purchasePrice
  if (price == null) return null
  const line = po.items.find(
    (i) => i.isInventoried && i.assetId === unit.assetId && Math.abs(i.unitPrice - price) < 0.005,
  )
  return line ? allocation.get(line.id) ?? 0 : null
}
