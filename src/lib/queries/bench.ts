import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/**
 * Who is carrying the bench, and what is on it that nobody is carrying.
 *
 * The maintenance tile answers "what is broken". This answers "who is fixing
 * it", which is a different question with a different reader: one is for the
 * person deciding what to chase, the other for the person deciding who to give
 * it to.
 *
 * The reading that earns the tile is the last field. A unit sits in
 * `MAINTENANCE` status and is out of bookable stock; a work order is the record
 * of somebody actually doing something about it. Nothing in the schema ties the
 * two together, so a unit can be off the shelf indefinitely with no work order,
 * no assigned tech and no clock running on it — and nothing in v1 or v2 counts
 * that. In this database it is every single one of the 46 units in service.
 *
 * Not repaired here, and deliberately not: opening work orders for 46 units by
 * script would invent a fault description, an opening date and an owner for
 * hardware whose real story is in somebody's head. It is reported instead.
 */

export type BenchTech = {
  id: string;
  name: string;
  open: number;
  /** The longest anything on this bench has been waiting. */
  oldestOpenedAt: Date;
};

export type BenchLoad = {
  /** Work orders in any open state. */
  open: number;
  /** Of those, how many nobody owns. */
  unassigned: number;
  /** Waiting on somebody else entirely. */
  atRma: number;
  /** Per tech, busiest first. */
  techs: BenchTech[];
  /** Units held out of bookable stock by their status. */
  unitsInService: number;
  /**
   * Units in service with no open work order against them. Off the shelf, and
   * tracked by nothing.
   */
  untracked: number;
  /** Days the oldest open work order has been open, or null when there are none. */
  oldestDays: number | null;
};

export const getBenchLoad = cache(async function getBenchLoad(
  now = new Date(),
): Promise<BenchLoad> {
  const open = { status: { in: OPEN_WORK_ORDER_STATUSES } };

  const [workOrders, atRma, unitsInService, untracked] = await Promise.all([
    // Bounded by definition — a bench only holds so much — and read as rows
    // rather than grouped so the tech's name and the oldest date come back in
    // one pass instead of a groupBy plus a lookup.
    prisma.workOrder.findMany({
      where: open,
      orderBy: { openedAt: "asc" },
      select: {
        openedAt: true,
        assignedTech: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.workOrder.count({ where: { status: "RMA" } }),
    prisma.assetUnit.count({ where: { status: "MAINTENANCE" } }),
    prisma.assetUnit.count({
      where: {
        status: "MAINTENANCE",
        workOrders: { none: open },
      },
    }),
  ]);

  const byTech = new Map<string, BenchTech>();
  let unassigned = 0;

  for (const workOrder of workOrders) {
    const tech = workOrder.assignedTech;
    if (!tech) {
      unassigned += 1;
      continue;
    }
    const existing = byTech.get(tech.id);
    if (existing) {
      existing.open += 1;
      continue;
    }
    byTech.set(tech.id, {
      id: tech.id,
      // A user row can carry no name. The email local part is a person, an
      // empty string is not.
      name: tech.name ?? tech.email?.split("@")[0] ?? "Unnamed",
      open: 1,
      // Rows arrive oldest-first, so the first one seen for a tech is theirs.
      oldestOpenedAt: workOrder.openedAt,
    });
  }

  return {
    open: workOrders.length,
    unassigned,
    atRma,
    techs: [...byTech.values()].sort((a, b) => b.open - a.open),
    unitsInService,
    untracked,
    oldestDays:
      workOrders.length === 0
        ? null
        : Math.floor(
            (now.getTime() - workOrders[0].openedAt.getTime()) / 86_400_000,
          ),
  };
});
