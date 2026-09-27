/**
 * Proves the atomic-claim fix in approveQuote (src/lib/actions/quote-tokens.ts):
 * two concurrent claims of the same QuoteToken must not both succeed. ALWAYS
 * ROLLS BACK — everything runs inside one transaction that ends by throwing, so
 * nothing is ever kept. Never calls approveQuote itself (that sends a real staff
 * email via RESEND_API_KEY); this only exercises the claim primitive it relies
 * on: `tx.quoteToken.updateMany({ where: { id, usedAt: null }, data: { usedAt } })`.
 *
 * Then the order-level guard: two DIFFERENT links for one order each win their
 * own token claim, so approveQuote also moves the order with
 * `tx.reservation.updateMany({ where: { id, status: { in: QUOTE_ANSWERABLE_STATUSES } } })`
 * — the second approval (and a later decline or change request, which write
 * through the same guard) must match 0 rows. The order's status is set to
 * QUOTE_SENT inside the same rolled-back transaction; nothing is kept.
 *
 *   npx tsx scripts/check-quote-claim.ts
 */
import 'dotenv/config'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { QUOTE_ANSWERABLE_STATUSES } from '@/lib/quotes/quote-answer'

class Rollback extends Error {}

async function main() {
  const reservation = await prisma.reservation.findFirst({ select: { id: true, reservationNumber: true, status: true } })
  if (!reservation) throw new Error('No reservation in the database to attach a throwaway QuoteToken to.')

  const token = `SMOKE-CLAIM-${crypto.randomUUID()}`
  let tokenId = ''
  let first: { count: number } = { count: -1 }
  let second: { count: number } = { count: -1 }
  const order = { linkA: -1, approveA: -1, linkB: -1, approveB: -1, declineAfter: -1, statusAfter: '' }
  const guard = { in: [...QUOTE_ANSWERABLE_STATUSES] }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.quoteToken.create({
        data: {
          token,
          reservationId: reservation.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      tokenId = created.id

      // The exact claim approveQuote now runs first, inside its transaction,
      // before any other write — run it twice back to back to simulate two
      // concurrent approvals racing the same link.
      first = await tx.quoteToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: new Date() },
      })
      second = await tx.quoteToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: new Date() },
      })

      // Order-level guard: one order, two separate links, both racing to approve.
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'QUOTE_SENT' } })
      const expiresAt = new Date(Date.now() + 60_000)
      const tokenA = await tx.quoteToken.create({ data: { token: `${token}-A`, reservationId: reservation.id, expiresAt } })
      const tokenB = await tx.quoteToken.create({ data: { token: `${token}-B`, reservationId: reservation.id, expiresAt } })

      order.linkA = (await tx.quoteToken.updateMany({ where: { id: tokenA.id, usedAt: null }, data: { usedAt: new Date() } })).count
      order.approveA = (await tx.reservation.updateMany({
        where: { id: reservation.id, status: guard },
        data: { status: 'APPROVED' },
      })).count
      order.linkB = (await tx.quoteToken.updateMany({ where: { id: tokenB.id, usedAt: null }, data: { usedAt: new Date() } })).count
      order.approveB = (await tx.reservation.updateMany({
        where: { id: reservation.id, status: guard },
        data: { status: 'APPROVED' },
      })).count
      // A decline (denyQuote) writes through the same guard — it can't lose an approved order.
      order.declineAfter = (await tx.reservation.updateMany({
        where: { id: reservation.id, status: guard },
        data: { status: 'LOST' },
      })).count
      order.statusAfter = (await tx.reservation.findUnique({ where: { id: reservation.id }, select: { status: true } }))!.status

      // Never commit any of this.
      throw new Rollback('always rolled back')
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  console.log(`Reservation used: ${reservation.reservationNumber} (${reservation.id})`)
  console.log(`Throwaway token:  ${token}`)
  console.log(`First claim:  count=${first.count} (expected 1)`)
  console.log(`Second claim: count=${second.count} (expected 0)`)

  if (first.count !== 1) throw new Error(`Expected the first claim to win with count 1, got ${first.count}`)
  if (second.count !== 0) throw new Error(`Expected the second claim to lose with count 0, got ${second.count}`)

  console.log(`\nTwo links, one order:`)
  console.log(`  Link A claim: count=${order.linkA} (expected 1), approve A: count=${order.approveA} (expected 1)`)
  console.log(`  Link B claim: count=${order.linkB} (expected 1), approve B: count=${order.approveB} (expected 0 — refused by the status guard)`)
  console.log(`  Decline after approval: count=${order.declineAfter} (expected 0), status in tx: ${order.statusAfter} (expected APPROVED)`)
  if (order.linkA !== 1 || order.approveA !== 1) throw new Error('The first approval should have claimed its link and moved the order.')
  if (order.linkB !== 1) throw new Error('The second link should still claim its own token (the claim is per link).')
  if (order.approveB !== 0) throw new Error(`The second approval on the same order must be refused, got count ${order.approveB}`)
  if (order.declineAfter !== 0 || order.statusAfter !== 'APPROVED') throw new Error('A decline after approval must not move the order.')

  // Confirm nothing persisted — the transaction threw, so these rows must not exist.
  const persisted = await prisma.quoteToken.findMany({ where: { token: { startsWith: token } } })
  console.log(`Persisted after rollback: ${persisted.length ? 'FOUND (BUG)' : 'none, as expected'}`)
  if (persisted.length) throw new Error('A throwaway QuoteToken survived the rollback — nothing may persist.')
  const after = await prisma.reservation.findUnique({ where: { id: reservation.id }, select: { status: true } })
  console.log(`Order status after rollback: ${after?.status} (expected ${reservation.status})`)
  if (after?.status !== reservation.status) throw new Error('The order status survived the rollback — nothing may persist.')

  console.log('\nPASS: one claim per token, one approval per order, and nothing was left behind.')
}

main()
  .catch((error) => {
    console.error('FAIL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
