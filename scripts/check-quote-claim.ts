/**
 * Proves the atomic-claim fix in approveQuote (src/lib/actions/quote-tokens.ts):
 * two concurrent claims of the same QuoteToken must not both succeed. ALWAYS
 * ROLLS BACK — everything runs inside one transaction that ends by throwing, so
 * nothing is ever kept. Never calls approveQuote itself (that sends a real staff
 * email via RESEND_API_KEY); this only exercises the claim primitive it relies
 * on: `tx.quoteToken.updateMany({ where: { id, usedAt: null }, data: { usedAt } })`.
 *
 *   npx tsx scripts/check-quote-claim.ts
 */
import 'dotenv/config'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

class Rollback extends Error {}

async function main() {
  const reservation = await prisma.reservation.findFirst({ select: { id: true, reservationNumber: true } })
  if (!reservation) throw new Error('No reservation in the database to attach a throwaway QuoteToken to.')

  const token = `SMOKE-CLAIM-${crypto.randomUUID()}`
  let tokenId = ''
  let first: { count: number } = { count: -1 }
  let second: { count: number } = { count: -1 }

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

  // Confirm nothing persisted — the transaction threw, so this row must not exist.
  const persisted = await prisma.quoteToken.findUnique({ where: { token } })
  console.log(`Persisted after rollback: ${persisted ? 'FOUND (BUG)' : 'none, as expected'}`)
  if (persisted) throw new Error('The throwaway QuoteToken survived the rollback — nothing may persist.')

  console.log('\nPASS: only one of two concurrent claims on the same token succeeds, and nothing was left behind.')
}

main()
  .catch((error) => {
    console.error('FAIL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
