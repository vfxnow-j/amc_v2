import { prisma } from "@/lib/prisma";
import type { NavCounts } from "@/lib/nav/counts";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/**
 * The real figures behind the rail's cluster counts.
 *
 * Kept out of `lib/nav/counts.ts` on purpose: that module is imported by
 * `cluster-bubble.tsx`, a client component, and anything reaching `lib/prisma`
 * from there would drag the pg driver into the browser bundle.
 *
 * Each number is the cluster's *live workload*, not a grand total — the rail is
 * a "where is there work" signal, and a count that never moves teaches people to
 * stop reading it. The one exception is Inventory, where the fleet size is the
 * useful number and matches the denominator Overview divides utilization by.
 *
 * Four indexed counts on every shell render. If that ever shows up in a trace,
 * the fix is to stream the rail's counts behind their own boundary rather than
 * to cache them — a stale badge is worse than a late one.
 */
export async function getNavCounts(): Promise<NavCounts> {
  const [openOrders, rentableUnits, openWorkOrders, unpaidInvoices, activeClients] =
    await Promise.all([
      prisma.reservation.count({
        where: { status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] } },
      }),
      // Retired and sold units aren't fleet any more.
      prisma.assetUnit.count({
        where: { status: { notIn: ["RETIRED", "SOLD"] } },
      }),
      prisma.workOrder.count({
        where: { status: { in: OPEN_WORK_ORDER_STATUSES } },
      }),
      prisma.invoice.count({
        where: { status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
      }),
      // `Client` has no active flag, so "active" is what the data can prove:
      // a client with an order currently running.
      prisma.client.count({
        where: {
          reservations: {
            some: {
              status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] },
            },
          },
        },
      }),
    ]);

  return {
    clusters: {
      operate: openOrders,
      inventory: rentableUnits,
      service: openWorkOrders,
      accounting: unpaidInvoices,
      clients: activeClients,
      // Insight carries no count in the reference — it's a read surface.
    },
    pages: {},
  };
}
