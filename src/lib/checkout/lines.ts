import type { Prisma } from '@/generated/prisma/client'

/**
 * Which order lines hold physical units that go out the door.
 *
 * A part configured into a system (a GPU under its workstation) is a real unit
 * and checks out like any line. A cloud-host config row (parentId and
 * cloudProductId both set) is pricing detail only. And only the quote option the
 * client went ahead with ships — an alternative they didn't choose has nothing
 * to send. Ported from v1 3fd469e; v2 adds the chosen-option rule.
 */
export const CHECKOUT_LINE_WHERE = {
  NOT: { parentId: { not: null }, cloudProductId: { not: null } },
  OR: [{ packageId: null }, { package: { isActive: true } }],
} as const satisfies Prisma.ReservationItemWhereInput

export type ScanLine = { id: string; parentId: string | null; quantity: number; checkedOutCount: number }

/**
 * The line a scanned unit goes onto, from the lines for its asset (in sort order).
 * The line this exact unit is already assigned to comes first; then a machine's
 * line with room; then a part with room; then the first machine line stretches;
 * then the first part. Null means no line matches and the caller adds one ad hoc.
 */
export function pickScanLine<T extends ScanLine>(lines: T[], assignedLineId: string | null): T | null {
  const hasRoom = (l: T) => l.checkedOutCount < l.quantity
  const top = lines.filter((l) => l.parentId === null)
  const parts = lines.filter((l) => l.parentId !== null)
  return (
    (assignedLineId ? lines.find((l) => l.id === assignedLineId) : undefined) ??
    top.find(hasRoom) ??
    parts.find(hasRoom) ??
    top[0] ??
    parts[0] ??
    null
  )
}

/** A part that is part of its system's base price is charged nothing on checkout. */
export function unitChargeFor(item: { includedInParent: boolean }, charge: number): number {
  return item.includedInParent ? 0 : charge
}
