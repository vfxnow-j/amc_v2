import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { createReservationCore } from '@/lib/orders/create-core'
import { buildFlowTermsSnapshot } from '@/lib/flow-terms-server'
import { businessToday } from './quote'
import { PortalError, notFound } from './errors'
import { allocatePortalOrderNumber } from './order-number'
import {
  customerStatus,
  orderableProblem,
  orderRequestHash,
  repriceProblem,
  reservationInputFromRate,
  solutionOf,
  type OrderRequest,
  type StoredRate,
} from './orders-core'
import { priceForAccount } from './price-run'
import { verificationMeets, type PortalSolution } from './tiers'
import { encodeCursor, type Cursor } from './paging'
import type { PortalAccountRef } from './tenancy'

/**
 * POST /v1/orders and the order reads (docs/portal-api.md, Phase 2).
 *
 * Placing an order re-runs the stored quote request now — same engine, same
 * stock rules, the account's standing today — and refuses unless every line is
 * still allowed at the same price. The order is then built from the snapshot by
 * the same core a staff order uses, numbered PRT-, and linked to its rate and
 * Idempotency-Key in the same transaction.
 *
 * A verified account's order (id_verified or better) arrives APPROVED and holds
 * its stock. An unverified account's arrives as a DRAFT flagged for review and
 * holds nothing until staff approve it — so a stranger who just signed up can't
 * lock up the fleet. (Owner to confirm; the one place this is decided is
 * `arrivesApproved`.)
 */

export function arrivesApproved(verificationLevel: string): boolean {
  return verificationMeets(verificationLevel, 'id_verified')
}

// Portal orders are placed one at a time in this process, so two customers
// can't both pass the stock check for the last unit. (Numbering is separately
// safe under a database lock.)
let queue: Promise<unknown> = Promise.resolve()
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

const ORDER_SELECT = {
  id: true,
  reservationNumber: true,
  reservationType: true,
  status: true,
  startDate: true,
  endDate: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  clientId: true,
  items: {
    where: { parentId: null, OR: [{ packageId: null }, { package: { isActive: true } }] },
    orderBy: { sortOrder: 'asc' },
    select: { description: true, quantity: true, asset: { select: { name: true } } },
  },
  portalOrder: {
    select: { idempotencyKey: true, siteExternalId: true, poNumber: true, quotedTotal: true, account: { select: { portalAccountId: true } } },
  },
} satisfies Prisma.ReservationSelect

type OrderRow = Prisma.ReservationGetPayload<{ select: typeof ORDER_SELECT }>

export type OrderDto = {
  order_number: string
  portal_quote_id: string | null
  portal_account_id: string
  status: ReturnType<typeof customerStatus>
  solution: ReturnType<typeof solutionOf>
  start_date: string
  end_date: string | null
  total: number
  currency: 'USD'
  site_id: string | null
  po_number: string | null
  lines: { name: string; qty: number }[]
  created_at: string
  updated_at: string
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Explicit mapper — never a spread of a row. The total is what the customer accepted for a portal order. */
export function orderDto(row: OrderRow, portalAccountId: string): OrderDto {
  const po = row.portalOrder
  const solution = solutionOf(row.reservationType)
  return {
    order_number: row.reservationNumber,
    portal_quote_id: po?.idempotencyKey ?? null,
    portal_account_id: po?.account.portalAccountId ?? portalAccountId,
    status: customerStatus(row.status),
    solution,
    start_date: ymd(row.startDate),
    end_date: solution === 'sale' ? null : ymd(row.endDate),
    total: Number(po ? po.quotedTotal : row.total),
    currency: 'USD',
    site_id: po?.siteExternalId ?? null,
    po_number: po?.poNumber ?? null,
    lines: row.items.map((i) => ({ name: i.description || i.asset?.name || 'Item', qty: i.quantity })),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

/**
 * Which of a client's orders the portal sees (plan decision 4): everything it
 * placed, and the client's other orders once they are more than a draft.
 */
function visibleOrders(clientIds: string[]): Prisma.ReservationWhereInput {
  return { clientId: { in: clientIds }, OR: [{ portalOrder: { isNot: null } }, { status: { notIn: ['DRAFT', 'REVISION'] } }] }
}

export async function placePortalOrder(input: {
  portalClientId: string
  account: PortalAccountRef
  request: OrderRequest
  idempotencyKey: string
  now: Date
}): Promise<{ status: 200 | 201; order: OrderDto }> {
  const { portalClientId, account, request, idempotencyKey, now } = input
  const requestHash = orderRequestHash(request)

  const replay = async (): Promise<{ status: 200; order: OrderDto } | null> => {
    const existing = await prisma.portalOrder.findUnique({
      where: { portalClientId_idempotencyKey: { portalClientId, idempotencyKey } },
      select: { requestHash: true, reservationId: true },
    })
    if (!existing) return null
    if (existing.requestHash !== requestHash) {
      throw new PortalError(422, 'idempotency_mismatch', 'This Idempotency-Key was used with a different request.')
    }
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: existing.reservationId }, select: ORDER_SELECT })
    return { status: 200, order: orderDto(row, account.portalAccountId) }
  }

  const first = await replay()
  if (first) return first

  return serially(async () => {
    // Re-check inside the queue: a retry may have landed while this one waited.
    const again = await replay()
    if (again) return again

    const rate = await prisma.portalRateQuote.findUnique({
      where: { id: request.rateId },
      select: { id: true, accountId: true, request: true, lines: true, total: true, validUntil: true, consumedByReservationId: true },
    })
    if (!rate || rate.accountId !== account.id) {
      throw new PortalError(409, 'rate_mismatch', 'That rate was not quoted for this account.')
    }
    if (rate.consumedByReservationId || (await prisma.portalOrder.count({ where: { rateQuoteId: rate.id } }))) {
      throw new PortalError(409, 'rate_mismatch', 'That rate has already been ordered; re-quote.')
    }
    if (rate.validUntil <= now) throw new PortalError(409, 'rate_expired', 'That rate has expired; re-quote.')

    const site = await prisma.portalAccountSite.findFirst({
      where: { accountId: account.id, externalSiteId: request.siteId },
      select: { name: true, address: true },
    })
    if (!site) throw notFound('No such site on this account')

    const stored = { request: rate.request, lines: rate.lines } as unknown as StoredRate
    const unorderable = orderableProblem(stored)
    if (unorderable) throw new PortalError(409, unorderable.code, unorderable.message, { details: unorderable.details })
    if (stored.request.window.start.slice(0, 10) < businessToday(now)) {
      throw new PortalError(409, 'conflict', 'The start date has passed; re-quote.')
    }

    // The same engine, now: price, stock and the account's standing.
    const { result } = await priceForAccount(account, {
      accountId: request.accountId,
      window: {
        start: new Date(stored.request.window.start),
        end: stored.request.window.end ? new Date(stored.request.window.end) : null,
      },
      lines: stored.request.lines.map((l) => ({ offerId: l.offer_id, qty: l.qty, solution: l.solution as PortalSolution, term: l.term_months })),
    }, now)
    const moved = repriceProblem(stored.lines.client, result.lines)
    if (moved) throw new PortalError(409, moved.code, moved.message, { details: 'details' in moved ? moved.details : undefined })

    const data = reservationInputFromRate(stored, {
      clientId: account.clientId,
      site: { label: site.name, address: site.address },
      poNumber: request.poNumber,
      notes: request.notes,
      orderRef: idempotencyKey,
    })
    const approved = arrivesApproved(account.verificationLevel)
    if (!approved) {
      data.actionRequired = true
      data.actionRequiredNote = 'Portal order from an account not yet verified — review, then approve.'
    }

    let reservationId: string
    try {
      const created = await createReservationCore(data, { userId: null }, {
        reservationNumber: (tx) => allocatePortalOrderNumber(tx, now),
        afterCreate: async (tx, id) => {
          await tx.portalOrder.create({
            data: {
              portalClientId,
              accountId: account.id,
              reservationId: id,
              rateQuoteId: rate.id,
              idempotencyKey,
              requestHash,
              siteExternalId: request.siteId,
              poNumber: request.poNumber,
              quotedTotal: rate.total,
            },
          })
          await tx.portalRateQuote.update({ where: { id: rate.id }, data: { consumedByReservationId: id } })
          await tx.statusHistory.create({
            data: { entityType: 'RESERVATION', entityId: id, fromStatus: null, toStatus: 'DRAFT', notes: 'Placed through the client portal' },
          })
        },
      })
      if (!created) throw new Error('Failed to create the order')
      reservationId = created.id
    } catch (error) {
      // Two identical requests racing past the first check: the loser replays.
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await replay()
        if (raced) return raced
      }
      throw error
    }

    if (approved) await approvePortalOrder(reservationId, now)

    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: ORDER_SELECT })
    return { status: 201 as const, order: orderDto(row, account.portalAccountId) }
  })
}

/**
 * What staff approval does that matters for a portal order: Flow terms frozen
 * onto it, APPROVED with its dates, the status history, and staff told. The
 * client email and HubSpot sync are left to the portal and the integration.
 * Not the Phase 6 quote gate: that holds quotes staff price and send, and a
 * portal order is at AMC's own list prices.
 */
async function approvePortalOrder(reservationId: string, now: Date): Promise<void> {
  const order = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { reservationType: true, flowTermsSnapshot: true },
  })
  const flowSnapshot = order.reservationType === 'FLOW' && order.flowTermsSnapshot == null ? await buildFlowTermsSnapshot(reservationId) : null
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'APPROVED',
        approvedAt: now,
        confirmedAt: now,
        ...(flowSnapshot
          ? { flowTermsSnapshot: flowSnapshot as unknown as Prisma.InputJsonValue, flowTermsVersion: flowSnapshot.version }
          : {}),
      },
      select: {
        reservationNumber: true,
        reservationType: true,
        startDate: true,
        endDate: true,
        projectName: true,
        total: true,
        client: { select: { name: true, companyName: true } },
        items: { where: { parentId: null }, select: { quantity: true, description: true, asset: { select: { name: true, category: { select: { name: true } } } } } },
      },
    })
    await tx.statusHistory.create({
      data: { entityType: 'RESERVATION', entityId: reservationId, fromStatus: 'DRAFT', toStatus: 'APPROVED', notes: 'Approved on placement: verified portal account' },
    })
    return row
  })
  try {
    const { notifyReservationConfirmed } = await import('@/lib/notifications/outbound')
    await notifyReservationConfirmed({
      reservationNumber: updated.reservationNumber,
      clientName: updated.client?.companyName || updated.client?.name || 'Unknown',
      startDate: updated.startDate.toLocaleDateString(),
      endDate: updated.endDate.toLocaleDateString(),
      reservationType: updated.reservationType,
      projectName: updated.projectName ?? undefined,
      items: updated.items.map((i) => ({ name: i.asset?.name || i.description || 'Item', quantity: i.quantity, category: i.asset?.category?.name })),
      total: `$${Number(updated.total || 0).toFixed(2)}`,
    })
  } catch (error) {
    console.error('[portal] order approved notification failed:', error)
  }
}

/** One order by its number, if it belongs to one of the calling portal's accounts and is visible. */
export async function getPortalOrder(portalClientId: string, orderNumber: string): Promise<OrderDto> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderNumber)) throw notFound('Order not found')
  const row = await prisma.reservation.findUnique({ where: { reservationNumber: orderNumber }, select: ORDER_SELECT })
  if (!row) throw notFound('Order not found')
  const account = await prisma.portalAccount.findFirst({ where: { portalClientId, clientId: row.clientId }, select: { portalAccountId: true } })
  if (!account) throw notFound('Order not found')
  const visible = await prisma.reservation.count({ where: { id: row.id, ...visibleOrders([row.clientId]) } })
  if (!visible) throw notFound('Order not found')
  return orderDto(row, account.portalAccountId)
}

/**
 * A page of orders in updated order, oldest change first: one account's, or —
 * for the changed-since feed — every account of the calling portal. The cursor
 * is (updated_at, id) of the last row, so no change is skipped or repeated.
 */
export async function listPortalOrders(input: {
  portalClientId: string
  accountId?: string
  updatedSince?: Date
  cursor?: Cursor
  limit: number
}): Promise<{ data: OrderDto[]; next_cursor: string | null }> {
  const accounts = await prisma.portalAccount.findMany({
    where: { portalClientId: input.portalClientId, ...(input.accountId ? { id: input.accountId } : {}) },
    select: { clientId: true, portalAccountId: true },
  })
  if (!accounts.length) return { data: [], next_cursor: null }
  const byClient = new Map(accounts.map((a) => [a.clientId, a.portalAccountId]))
  const after: Prisma.ReservationWhereInput[] = []
  if (input.cursor) {
    after.push({ OR: [{ updatedAt: { gt: input.cursor.at } }, { updatedAt: input.cursor.at, id: { gt: input.cursor.id } }] })
  } else if (input.updatedSince) {
    after.push({ updatedAt: { gte: input.updatedSince } })
  }
  const rows = await prisma.reservation.findMany({
    where: { AND: [visibleOrders([...byClient.keys()]), ...after] },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: ORDER_SELECT,
  })
  const page = rows.slice(0, input.limit)
  const last = page[page.length - 1]
  return {
    data: page.map((r) => orderDto(r, byClient.get(r.clientId)!)),
    next_cursor: rows.length > input.limit && last ? encodeCursor({ at: last.updatedAt, id: last.id }) : null,
  }
}
