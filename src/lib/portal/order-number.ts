import type { Prisma } from '@/generated/prisma/client'

/**
 * Portal order numbers: PRT-{YYYY}-{SEQ}, 5 digits, yearly reset.
 *
 * A series of its own (owner decision 8) so the v1 sync — where v1 wins a clash
 * on a unique number — can never meet one of these and delete it. Allocated
 * inside the order's transaction under a transaction-scoped advisory lock, so
 * two portal orders placed at once can't take the same number: the second
 * waits for the first to commit and then sees its number.
 */

const LOCK_KEY = 'portal_order_number'

export function formatPortalOrderNumber(year: number, seq: number): string {
  return `PRT-${year}-${String(seq).padStart(5, '0')}`
}

/** The highest sequence among numbers of this year's form; 0 when none. */
export function highestSequence(numbers: string[], year: number): number {
  const pattern = new RegExp(`^PRT-${year}-(\\d+)$`)
  let max = 0
  for (const n of numbers) {
    const m = pattern.exec(n)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

export async function allocatePortalOrderNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`
  const year = now.getUTCFullYear()
  const rows = await tx.reservation.findMany({
    where: { reservationNumber: { startsWith: `PRT-${year}-` } },
    select: { reservationNumber: true },
  })
  return formatPortalOrderNumber(year, highestSequence(rows.map((r) => r.reservationNumber), year) + 1)
}
