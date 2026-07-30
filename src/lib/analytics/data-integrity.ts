import { prisma } from "@/lib/prisma";
import type { Insight } from "@/lib/analytics/insights";

/**
 * Data-quality checks that report rather than repair.
 *
 * Nothing here writes. Where the data disagrees with itself the fix needs
 * someone who knows which side is true — a backfill picked by guesswork would
 * bury the evidence and make the wrong number permanent. These surface as
 * system flags alongside the other completeness warnings.
 */

/**
 * Line counters that disagree with the unit rows behind them.
 *
 * `ReservationItem.checkedOutCount` and `checkedInCount` are cumulative: a
 * check-out increments the first, a check-in increments the second, and neither
 * is ever decremented. So the units currently out on a line are the difference
 * between them, and the junction rows say the same thing by carrying
 * `checkedOutAt` with no `checkedInAt`.
 *
 * The two are maintained in the same transaction by `checkoutReservationItem`,
 * so live traffic keeps them together. Imported orders are where they part —
 * the import wrote counters without creating rows. It runs both ways, though:
 * a few lines have rows their counters never caught up with.
 *
 * It matters because the app reads both sources. The outgoing queue works from
 * the counters (a line can be ordered with no unit assigned yet, and those are
 * exactly the ones nobody has pulled), while "on rent", the hub's units column
 * and Overview's utilisation all count rows. Where they disagree, only the
 * attached units can actually be checked back in.
 */
export async function getUnitCountDrift(): Promise<Insight[]> {
  const items = await prisma.reservationItem.findMany({
    where: { assetId: { not: null }, parentId: null },
    select: {
      id: true,
      checkedOutCount: true,
      checkedInCount: true,
      reservation: {
        select: { id: true, reservationNumber: true, status: true },
      },
      units: { select: { checkedOutAt: true, checkedInAt: true } },
    },
  });

  type Drift = {
    reservationNumber: string;
    lines: number;
    /** Positive: counters claim more out than rows back. Negative: the reverse. */
    net: number;
  };
  const byOrder = new Map<string, Drift>();

  for (const item of items) {
    const counted = item.checkedOutCount - item.checkedInCount;
    const attached = item.units.filter(
      (unit) => unit.checkedOutAt && !unit.checkedInAt,
    ).length;
    if (counted === attached) continue;

    const order = item.reservation;
    const existing = byOrder.get(order.id);
    if (existing) {
      existing.lines += 1;
      existing.net += counted - attached;
    } else {
      byOrder.set(order.id, {
        reservationNumber: order.reservationNumber,
        lines: 1,
        net: counted - attached,
      });
    }
  }

  return [...byOrder.entries()].map(([reservationId, drift]) => {
    const lines = `${drift.lines} ${drift.lines === 1 ? "line" : "lines"}`;
    const detail =
      drift.net > 0
        ? drift.net === 1
          ? `the counters claim 1 more unit out than there is a unit record to back. It can't be checked back in until it's scanned onto the order.`
          : `the counters claim ${drift.net} more units out than there are unit records to back. Those units can't be checked back in until they're scanned onto the order.`
        : drift.net < 0
          ? `there ${Math.abs(drift.net) === 1 ? "is 1 unit record" : `are ${Math.abs(drift.net)} unit records`} out that the counters don't know about. Checking one in will bring them back into step.`
          : `the counters and the unit records disagree line by line even though they net out. Compare them before trusting either.`;

    return {
      id: `sys-unit-count-drift-${reservationId}`,
      type: "system",
      category: "system",
      // Not high: nothing is broken for anyone standing at the shelf, and the
      // record already says so on the affected line. It needs deciding, not
      // firefighting.
      priority: "medium",
      title: "Unit counts disagree with unit records",
      description: `${drift.reservationNumber}: on ${lines}, ${detail}`,
      link: `/dashboard/reservations/${reservationId}`,
    } satisfies Insight;
  });
}
