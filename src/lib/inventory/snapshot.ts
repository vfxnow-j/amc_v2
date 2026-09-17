import { prisma } from '@/lib/prisma'
import { IN_FLEET, OPEN_CHECKOUT } from '@/lib/inventory/availability'

/**
 * The inventory report's snapshot, ported from v1's
 * `lib/analytics/inventory-snapshot.ts` for the emailed Inventory report.
 *
 * Per asset model: what is in stock now; what is committed to go out, due back
 * and sitting on open quotes inside the outlook window; and the monthly rate.
 *
 * Two departures, both to v2's own single definitions so the report cannot
 * disagree with the screens it summarises:
 *
 * - **Fleet** is `IN_FLEET` from `lib/inventory/availability` (v1 listed the
 *   same four statuses by hand).
 * - **On rent** is `OPEN_CHECKOUT` — not returned and not cancelled — rather
 *   than v1's `status in (ACTIVE, OVERDUE)`, because `OVERDUE` is maintained by
 *   a nightly job v2 does not run, and the Reservations hub and the units list
 *   already read custody from `OPEN_CHECKOUT`.
 *
 * No auth: a plain server module, called by the report runner. The reports
 * screens that need a session go through their own queries.
 */

/** Orders that are committed to ship — these drive "going out". */
const COMMITTED_STATUSES = ['APPROVED', 'PREPARING', 'SHIPPED'] as const

/** Orders still in the sales pipeline — these drive "on quote". */
const PIPELINE_STATUSES = ['DRAFT', 'QUOTE_SENT', 'REVISION'] as const

export type InventorySnapshotRow = {
  assetId: string
  assetName: string
  category: string
  manufacturer: string | null
  model: string | null
  totalUnits: number
  inStock: number
  reserved: number
  out: number
  maintenance: number
  /** Units on committed orders shipping inside the horizon, not yet checked out. */
  goingOut: number
  /** Units on committed orders whose ship date has already passed — backlog. */
  lateToShip: number
  /** Units on rent due back between now and the end of the horizon. */
  comingBack: number
  /** Units on rent already past their expected return — unverified, never counted in projections. */
  overdueBack: number
  /** Units on rent under a recurring / ongoing order — no return assumed. */
  recurringOut: number
  /** Units on open quotes / drafts inside the horizon (not yet committed). */
  quoted: number
  /** inStock − goingOut + comingBack, floored at 0. */
  projectedAvailable: number
  monthlyRate: number | null
  /** monthlyRate × units currently out — recurring revenue this model is carrying. */
  monthlyRateOut: number
  /** monthlyRate × units in stock — idle monthly revenue potential. */
  monthlyRateAvailable: number
}

export type InventorySnapshotCategory = {
  category: string
  rows: InventorySnapshotRow[]
  totals: {
    totalUnits: number
    inStock: number
    out: number
    goingOut: number
    lateToShip: number
    comingBack: number
    overdueBack: number
    recurringOut: number
    quoted: number
    projectedAvailable: number
    monthlyRateOut: number
    monthlyRateAvailable: number
  }
}

export type InventorySnapshotData = {
  generatedAtLabel: string
  horizonDays: number
  horizonLabel: string
  summary: {
    totalUnits: number
    inStock: number
    out: number
    reserved: number
    maintenance: number
    goingOut: number
    lateToShip: number
    comingBack: number
    overdueBack: number
    recurringOut: number
    quoted: number
    projectedAvailable: number
    utilizationPercent: number
    monthlyRateOut: number
    monthlyRateAvailable: number
  }
  categories: InventorySnapshotCategory[]
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export type InventorySnapshotOptions = {
  /** How far ahead to look for planned movement. Default 14 days. */
  horizonDays?: number
  /** Include asset models with no active units and no upcoming activity. */
  includeEmpty?: boolean
}

export async function getInventorySnapshot(
  options: InventorySnapshotOptions = {}
): Promise<InventorySnapshotData> {
  const horizonDays = options.horizonDays ?? 14
  const now = new Date()
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000)
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number)
  const todayStart = new Date(Date.UTC(y, m - 1, d))

  const [assets, committedItems, pipelineItems, dueBack] = await Promise.all([
    prisma.asset.findMany({
      where: { retiredAt: null },
      select: {
        id: true,
        name: true,
        manufacturer: true,
        model: true,
        monthlyRate: true,
        category: { select: { name: true } },
        units: {
          where: { status: { in: IN_FLEET } },
          select: { status: true },
        },
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    }),

    // Committed orders shipping inside the horizon — units not yet checked out
    prisma.reservationItem.findMany({
      where: {
        assetId: { not: null },
        reservation: {
          status: { in: [...COMMITTED_STATUSES] },
          startDate: { lt: horizonEnd },
        },
      },
      select: {
        assetId: true,
        quantity: true,
        checkedOutCount: true,
        reservation: { select: { startDate: true } },
      },
    }),

    // Open quotes inside the horizon — prospected, not committed
    prisma.reservationItem.findMany({
      where: {
        assetId: { not: null },
        reservation: {
          status: { in: [...PIPELINE_STATUSES] },
          startDate: { lt: horizonEnd },
          endDate: { gte: now },
        },
      },
      select: { assetId: true, quantity: true },
    }),

    // On rent, with a return signal inside the horizon. Both the checkout's own
    // expectedReturn and the order's end date are considered — they disagree
    // often enough that trusting either one alone promises stock that is not
    // actually coming back.
    prisma.checkout.findMany({
      where: {
        ...OPEN_CHECKOUT,
        OR: [
          { expectedReturn: { lt: horizonEnd } },
          { reservation: { endDate: { lt: horizonEnd } } },
        ],
      },
      select: {
        expectedReturn: true,
        assetUnit: { select: { assetId: true } },
        reservation: { select: { isRecurring: true, endDate: true } },
      },
    }),
  ])

  // Units out on recurring / ongoing orders. Their expectedReturn is a billing
  // artefact, not a promise to return, so they are reported on their own and
  // kept out of every inbound number.
  const recurringOnRent = await prisma.checkout.findMany({
    where: {
      ...OPEN_CHECKOUT,
      reservation: { isRecurring: true },
    },
    select: { assetUnit: { select: { assetId: true } } },
  })

  // ---- Roll movement quantities up per asset ----
  // A committed order whose ship date has already passed is backlog, not
  // planned movement. Both hold stock that sales cannot promise, so both are
  // subtracted from the projection — but they are reported separately so the
  // "next N days" framing stays honest.
  const isLate = (startDate: Date) => startDate.getTime() < todayStart.getTime()

  const goingOutByAsset = new Map<string, number>()
  const lateToShipByAsset = new Map<string, number>()
  for (const item of committedItems) {
    if (!item.assetId || !item.reservation) continue
    const remaining = Math.max(0, item.quantity - item.checkedOutCount)
    if (remaining === 0) continue
    const bucket = isLate(item.reservation.startDate) ? lateToShipByAsset : goingOutByAsset
    bucket.set(item.assetId, (bucket.get(item.assetId) ?? 0) + remaining)
  }

  const quotedByAsset = new Map<string, number>()
  for (const item of pipelineItems) {
    if (!item.assetId) continue
    quotedByAsset.set(item.assetId, (quotedByAsset.get(item.assetId) ?? 0) + item.quantity)
  }

  /**
   * The date a unit can realistically be counted back in: the later of the
   * checkout's expected return and the order's end date. Returns null when
   * neither is set, or when the order is recurring — in both cases nothing
   * should be promised.
   */
  const effectiveReturn = (co: {
    expectedReturn: Date | null
    reservation: { isRecurring: boolean; endDate: Date } | null
  }): Date | null => {
    if (!co.reservation || co.reservation.isRecurring) return null
    const candidates = [co.expectedReturn, co.reservation.endDate].filter((d): d is Date => !!d)
    if (candidates.length === 0) return null
    return candidates.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest))
  }

  // A return whose date has already passed is not planned movement — it is an
  // exception to chase, so it is tracked separately and left out of the
  // projection.
  const isOverdue = (d: Date) => d.getTime() < todayStart.getTime()

  const comingBackByAsset = new Map<string, number>()
  const overdueByAsset = new Map<string, number>()
  for (const co of dueBack) {
    const assetId = co.assetUnit?.assetId
    if (!assetId) continue
    // Recurring orders roll over — never treat their date as a return.
    const due = effectiveReturn(co)
    if (!due) continue
    // Pushed past the horizon by the order's end date — not this window's stock.
    if (!isOverdue(due) && due.getTime() >= horizonEnd.getTime()) continue
    const bucket = isOverdue(due) ? overdueByAsset : comingBackByAsset
    bucket.set(assetId, (bucket.get(assetId) ?? 0) + 1)
  }

  const recurringByAsset = new Map<string, number>()
  for (const co of recurringOnRent) {
    const assetId = co.assetUnit?.assetId
    if (!assetId) continue
    recurringByAsset.set(assetId, (recurringByAsset.get(assetId) ?? 0) + 1)
  }

  // ---- Per-asset rows, grouped by category ----
  const categoryMap = new Map<string, InventorySnapshotRow[]>()

  for (const asset of assets) {
    const inStock = asset.units.filter((u) => u.status === 'AVAILABLE').length
    const out = asset.units.filter((u) => u.status === 'CHECKED_OUT').length
    const reserved = asset.units.filter((u) => u.status === 'RESERVED').length
    const maintenance = asset.units.filter((u) => u.status === 'MAINTENANCE').length
    const goingOut = goingOutByAsset.get(asset.id) ?? 0
    const lateToShip = lateToShipByAsset.get(asset.id) ?? 0
    const comingBack = comingBackByAsset.get(asset.id) ?? 0
    const overdueBack = overdueByAsset.get(asset.id) ?? 0
    const recurringOut = recurringByAsset.get(asset.id) ?? 0
    const quoted = quotedByAsset.get(asset.id) ?? 0
    const totalUnits = asset.units.length

    const hasActivity =
      totalUnits > 0 ||
      goingOut > 0 ||
      lateToShip > 0 ||
      comingBack > 0 ||
      overdueBack > 0 ||
      recurringOut > 0 ||
      quoted > 0
    if (!hasActivity && !options.includeEmpty) continue

    const monthlyRate = asset.monthlyRate ? Number(asset.monthlyRate) : null

    const row: InventorySnapshotRow = {
      assetId: asset.id,
      assetName: asset.name,
      category: asset.category?.name || 'Uncategorized',
      manufacturer: asset.manufacturer,
      model: asset.model,
      totalUnits,
      inStock,
      reserved,
      out,
      maintenance,
      goingOut,
      lateToShip,
      comingBack,
      overdueBack,
      recurringOut,
      quoted,
      projectedAvailable: Math.max(0, inStock - goingOut - lateToShip + comingBack),
      monthlyRate,
      monthlyRateOut: monthlyRate ? Math.round(monthlyRate * out * 100) / 100 : 0,
      monthlyRateAvailable: monthlyRate ? Math.round(monthlyRate * inStock * 100) / 100 : 0,
    }

    const existing = categoryMap.get(row.category)
    if (existing) existing.push(row)
    else categoryMap.set(row.category, [row])
  }

  const categories: InventorySnapshotCategory[] = Array.from(categoryMap.entries())
    .map(([category, rows]) => ({
      category,
      rows: rows.sort((a, b) => a.assetName.localeCompare(b.assetName)),
      totals: {
        totalUnits: rows.reduce((s, r) => s + r.totalUnits, 0),
        inStock: rows.reduce((s, r) => s + r.inStock, 0),
        out: rows.reduce((s, r) => s + r.out, 0),
        goingOut: rows.reduce((s, r) => s + r.goingOut, 0),
        lateToShip: rows.reduce((s, r) => s + r.lateToShip, 0),
        comingBack: rows.reduce((s, r) => s + r.comingBack, 0),
        overdueBack: rows.reduce((s, r) => s + r.overdueBack, 0),
        recurringOut: rows.reduce((s, r) => s + r.recurringOut, 0),
        quoted: rows.reduce((s, r) => s + r.quoted, 0),
        projectedAvailable: rows.reduce((s, r) => s + r.projectedAvailable, 0),
        monthlyRateOut: Math.round(rows.reduce((s, r) => s + r.monthlyRateOut, 0) * 100) / 100,
        monthlyRateAvailable: Math.round(rows.reduce((s, r) => s + r.monthlyRateAvailable, 0) * 100) / 100,
      },
    }))
    .sort((a, b) => a.category.localeCompare(b.category))

  const allRows = categories.flatMap((c) => c.rows)
  const totalUnits = allRows.reduce((s, r) => s + r.totalUnits, 0)
  const out = allRows.reduce((s, r) => s + r.out, 0)

  return {
    generatedAtLabel: formatDateTime(now),
    horizonDays,
    horizonLabel: `${formatDate(now)} – ${formatDate(horizonEnd)}`,
    summary: {
      totalUnits,
      inStock: allRows.reduce((s, r) => s + r.inStock, 0),
      out,
      reserved: allRows.reduce((s, r) => s + r.reserved, 0),
      maintenance: allRows.reduce((s, r) => s + r.maintenance, 0),
      goingOut: allRows.reduce((s, r) => s + r.goingOut, 0),
      lateToShip: allRows.reduce((s, r) => s + r.lateToShip, 0),
      comingBack: allRows.reduce((s, r) => s + r.comingBack, 0),
      overdueBack: allRows.reduce((s, r) => s + r.overdueBack, 0),
      recurringOut: allRows.reduce((s, r) => s + r.recurringOut, 0),
      quoted: allRows.reduce((s, r) => s + r.quoted, 0),
      projectedAvailable: allRows.reduce((s, r) => s + r.projectedAvailable, 0),
      utilizationPercent: totalUnits > 0 ? Math.round((out / totalUnits) * 100) : 0,
      monthlyRateOut: Math.round(allRows.reduce((s, r) => s + r.monthlyRateOut, 0) * 100) / 100,
      monthlyRateAvailable: Math.round(allRows.reduce((s, r) => s + r.monthlyRateAvailable, 0) * 100) / 100,
    },
    categories,
  }
}
