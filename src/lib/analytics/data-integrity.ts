import { prisma } from "@/lib/prisma";
import type { Insight } from "@/lib/analytics/insights";
import { MUST_NOT_BE_OUT, OPEN_CHECKOUT } from "@/lib/inventory/availability";

/**
 * Data-quality checks that report rather than repair.
 *
 * Nothing here writes. Where the data disagrees with itself the fix needs
 * someone who knows what actually happened in the warehouse — a backfill picked
 * by guesswork would bury the evidence and make the wrong number permanent.
 */

/**
 * Lines whose counters don't match the units attached to them.
 *
 * Background, because it decides what this check is allowed to conclude. v1
 * records one fact in three places:
 *
 * - `Checkout` — one row per movement, append-only. The real history.
 * - `ReservationItemUnit` — one row per (line, unit). Current state.
 * - `ReservationItem.checkedOutCount` / `checkedInCount` — cumulative counters.
 *
 * The first two agree with each other across this database, so the physical
 * record is sound and the counters are the odd one out. That means this check
 * must never describe units as *missing*: they are on the order, in two tables.
 *
 * What the mismatches actually are, by shape:
 *
 * - **Duplicated line.** Ordered quantity *and* counters are both exactly twice
 *   the units attached. Six ordered against three units is one line imported
 *   twice, not three units gone astray. This is the bulk of them.
 * - **Never scanned.** Counters above zero with no unit rows at all — old
 *   custody imports, where the paperwork was carried across but nothing was
 *   ever put against a barcode.
 * - **Mixed.** Neither shape fits. These need reading one at a time.
 */
type Shape = "duplicated" | "never-scanned" | "mixed";

const SHAPE_COPY: Record<
  Shape,
  (context: {
    lines: string;
    ordered: number;
    attached: number;
    plural: boolean;
  }) => string
> = {
  duplicated: ({ lines, ordered, attached, plural }) =>
    `${lines} ${plural ? "look" : "looks"} imported twice — ${ordered} ordered against ${attached} attached units, with the counters at exactly double as well. The units are on the order; the quantity is what needs correcting.`,
  "never-scanned": ({ lines, plural }) =>
    `${lines} ${plural ? "carry" : "carries"} a checked-out count with no units attached at all. The order came across from an import without anything being scanned, so there is nothing to check back in.`,
  mixed: ({ lines, ordered, attached, plural }) =>
    `${lines} ${plural ? "don't" : "doesn't"} match their attached units in any regular way — ${ordered} ordered, ${attached} attached. Worth reading line by line before trusting either figure.`,
};

export async function getUnitCountDrift(): Promise<Insight[]> {
  const items = await prisma.reservationItem.findMany({
    where: { assetId: { not: null }, parentId: null },
    select: {
      quantity: true,
      checkedOutCount: true,
      checkedInCount: true,
      reservation: { select: { id: true, reservationNumber: true } },
      units: { select: { checkedOutAt: true, checkedInAt: true } },
    },
  });

  type Tally = {
    reservationNumber: string;
    shapes: Record<Shape, number>;
    ordered: number;
    attached: number;
  };
  const byOrder = new Map<string, Tally>();

  for (const item of items) {
    const outNow = item.checkedOutCount - item.checkedInCount;
    const rowsOut = item.units.filter(
      (unit) => unit.checkedOutAt && !unit.checkedInAt,
    ).length;
    if (outNow === rowsOut) continue;

    const shape: Shape =
      item.units.length === 0
        ? "never-scanned"
        : item.quantity === item.units.length * 2 && outNow === rowsOut * 2
          ? "duplicated"
          : "mixed";

    const order = item.reservation;
    const tally = byOrder.get(order.id) ?? {
      reservationNumber: order.reservationNumber,
      shapes: { duplicated: 0, "never-scanned": 0, mixed: 0 },
      ordered: 0,
      attached: 0,
    };
    tally.shapes[shape] += 1;
    tally.ordered += item.quantity;
    tally.attached += item.units.length;
    byOrder.set(order.id, tally);
  }

  return [...byOrder.entries()].map(([reservationId, tally]) => {
    // The dominant shape names the flag; a mixed order says so.
    const [shape, count] = (
      Object.entries(tally.shapes) as [Shape, number][]
    ).sort((a, b) => b[1] - a[1])[0];
    const lines = `${count} ${count === 1 ? "line" : "lines"}`;

    return {
      id: `sys-unit-count-drift-${reservationId}`,
      type: "system",
      category: "system",
      // Nothing is broken for anyone standing at the shelf — the units are
      // recorded and scannable. It's a number to correct, not a fire.
      priority: "low",
      title:
        shape === "duplicated"
          ? "Order quantities look doubled by an import"
          : shape === "never-scanned"
            ? "Imported order with nothing scanned against it"
            : "Line counts don't match the attached units",
      description: `${tally.reservationNumber}: ${SHAPE_COPY[shape]({
        lines,
        ordered: tally.ordered,
        attached: tally.attached,
        plural: count !== 1,
      })}`,
      link: `/dashboard/orders/${reservationId}`,
    } satisfies Insight;
  });
}

/**
 * Units whose inventory status contradicts their checkouts.
 *
 * The rule: **if it's out, it's not available.** `Checkout` is the truth per
 * order; `AssetUnit.status` is how inventory reflects it. Two ways that can
 * break, and they are not equally serious:
 *
 * - **Offered while gone** — a bookable unit carrying an open checkout. This is
 *   the one that costs money and trust: the builder will promise it to a second
 *   client, and someone finds out at the shelf. High priority, always.
 * - **Blocked while free** — marked CHECKED_OUT with nothing open against it.
 *   Only lost capacity: a unit nobody can book that is sitting right there.
 *
 * Deliberately not flagged: SOLD or RETIRED units with an open checkout. A sale
 * leaves exactly that by design, and a unit can be retired while still out.
 * Neither is bookable, so neither can be double-promised — which is the whole
 * point of the check.
 */
export async function getInventoryStateDrift(): Promise<Insight[]> {
  const [offeredWhileGone, blockedWhileFree] = await Promise.all([
    prisma.assetUnit.findMany({
      where: {
        status: { in: MUST_NOT_BE_OUT },
        OR: [
          { checkouts: { some: OPEN_CHECKOUT } },
          { reservationItemUnits: { some: { checkedOutAt: { not: null }, checkedInAt: null } } },
        ],
      },
      select: {
        id: true,
        barcode: true,
        status: true,
        asset: { select: { name: true } },
        reservationItemUnits: {
          where: { checkedOutAt: { not: null }, checkedInAt: null },
          take: 1,
          select: {
            reservationItem: {
              select: { reservation: { select: { id: true, reservationNumber: true } } },
            },
          },
        },
      },
    }),
    prisma.assetUnit.count({
      where: {
        status: "CHECKED_OUT",
        checkouts: { none: OPEN_CHECKOUT },
        reservationItemUnits: { none: { checkedOutAt: { not: null }, checkedInAt: null } },
      },
    }),
  ]);

  const flags: Insight[] = offeredWhileGone.map((unit) => {
    const order =
      unit.reservationItemUnits[0]?.reservationItem.reservation ?? null;
    return {
      id: `sys-unit-offered-while-out-${unit.id}`,
      type: "inventory",
      category: "system",
      // Someone will promise this to a second client and find out at the shelf.
      priority: "high",
      title: "Unit is bookable but already out",
      description: `${unit.barcode} (${unit.asset.name}) reads ${unit.status.toLowerCase()}, so the order builder will offer it${order ? `, but it is checked out on ${order.reservationNumber}` : ", but it has an open checkout against it"}. Check it in, or correct its status.`,
      link: order
        ? `/dashboard/orders/${order.id}`
        : `/dashboard/units?q=${unit.barcode}`,
    } satisfies Insight;
  });

  if (blockedWhileFree > 0) {
    flags.push({
      id: "sys-units-blocked-while-free",
      type: "inventory",
      category: "system",
      // Costs capacity, not trust — nobody is promised anything twice.
      priority: "low",
      title: "Units marked out with nothing checked out",
      description: `${blockedWhileFree} ${blockedWhileFree === 1 ? "unit is" : "units are"} marked checked out with no open checkout behind ${blockedWhileFree === 1 ? "it" : "them"}. ${blockedWhileFree === 1 ? "It is" : "They are"} on the shelf but nobody can book ${blockedWhileFree === 1 ? "it" : "them"}.`,
      link: "/dashboard/units",
    });
  }

  return flags;
}
