"use server";

import { requireEditor } from "@/lib/auth-utils";
import { getOutgoing } from "@/lib/queries/today";
import { getReservationHeader } from "@/lib/queries/reservation-record";
import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import type { ReservationStatus, ReservationType } from "@/generated/prisma/client";

/**
 * What the standalone scan surface needs to know before it writes anything.
 *
 * Reads only, and gated the same way the writes are. They live in a
 * `"use server"` module rather than being fetched from the page because the
 * scan session is a long-lived client surface — it picks an order *after* the
 * page rendered, so the data cannot come down with it.
 *
 * Nothing here is a new query. `getOutgoing` already answers "what should be
 * out of the door" for the Calendar queues, and `getReservationHeader` already
 * returns the number, client, dates, type, status and unit progress the confirm
 * step needs. A second version of either would be a second definition of what
 * counts as outstanding, and there is exactly one — `{assetId: not null,
 * parentId: null}` — shared by `markShipped`, `getOutgoing` and the order
 * record's handover figure.
 */

export type ScanOrderRow = {
  id: string;
  number: string;
  clientName: string;
  projectName: string | null;
  status: ReservationStatus;
  unitsOutstanding: number;
  daysLate: number;
};

export type ScanOrderBrief = {
  id: string;
  number: string;
  type: ReservationType;
  status: ReservationStatus;
  clientName: string;
  projectName: string | null;
  start: string;
  end: string;
  ordered: number;
  out: number;
  returned: number;
  outstanding: number;
};

/**
 * The default list: orders due out by now with units still to pull.
 *
 * The common case needs no typing at all — a person at the packing bench is
 * almost always working the queue, and making them search for an order they can
 * see on the wall is the sort of friction that gets a scanner abandoned.
 */
export async function scanOrderQueue(): Promise<ScanOrderRow[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];

  const { rows } = await getOutgoing(new Date(), 25);
  return rows.map((row) => ({
    id: row.reservationId,
    number: row.reservationNumber,
    clientName: row.clientName,
    projectName: row.projectName,
    status: row.status,
    unitsOutstanding: row.units,
    daysLate: row.daysLate,
  }));
}

/**
 * Anything else, by number or client.
 *
 * Scoped to open orders: a completed or cancelled order cannot take a checkout,
 * and offering one only to have the server refuse the first scan wastes the
 * trip to the shelf.
 */
export async function scanOrderSearch(query: string): Promise<ScanOrderRow[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const contains = { contains: trimmed, mode: "insensitive" } as const;
  const rows = await prisma.reservation.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      OR: [
        { reservationNumber: contains },
        { client: { name: contains } },
        { projectName: contains },
      ],
    },
    orderBy: { startDate: "asc" },
    take: 15,
    select: {
      id: true,
      reservationNumber: true,
      projectName: true,
      status: true,
      client: { select: { name: true } },
      items: {
        where: { assetId: { not: null }, parentId: null },
        select: { quantity: true, checkedOutCount: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    number: row.reservationNumber,
    clientName: row.client.name,
    projectName: row.projectName,
    status: row.status,
    // The same shortfall the ship gate counts: services and component rows can
    // never be scanned, so they are not outstanding.
    unitsOutstanding: row.items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity - item.checkedOutCount),
      0,
    ),
    daysLate: 0,
  }));
}

/**
 * The brief a person confirms before scanning a single unit against an order.
 *
 * The owner's ask: dates, name and client shown before proceeding. Picking the
 * wrong order is the expensive mistake here — every scan after it writes a
 * checkout against somebody else's job — and it is cheap to prevent by showing
 * what was picked.
 */
export async function scanOrderBrief(
  reservationId: string,
): Promise<ScanOrderBrief | null> {
  const auth = await requireEditor();
  if (!auth.authorized) return null;

  const header = await getReservationHeader(reservationId);
  if (!header) return null;

  const { progress } = header;
  // Cumulative counters: check-in never decrements `out`, so what is actually
  // with the client is the difference. The order record derives it the same way
  // and for the same reason.
  const outNow = Math.max(0, progress.out - progress.returned);

  return {
    id: header.id,
    number: header.reservationNumber,
    type: header.type,
    status: header.status,
    clientName: header.client.name,
    projectName: header.projectName,
    start: header.start.toISOString(),
    end: header.end.toISOString(),
    ordered: progress.ordered,
    out: progress.out,
    returned: progress.returned,
    outstanding: Math.max(0, progress.ordered - outNow),
  };
}

/* ── Returns ────────────────────────────────────────────────────────────── */

export type ReturnCandidate = {
  orderId: string;
  number: string;
  clientName: string;
  /** Units of this order still with the client. */
  stillOut: number;
  dueBack: string | null;
  /** Days past the due date; 0 when it is not late. */
  daysLate: number;
};

export type ReturnDiscovery =
  | { kind: "none"; barcode: string; known: boolean }
  | { kind: "one"; barcode: string; unitName: string; order: ReturnCandidate }
  | { kind: "many"; barcode: string; unitName: string; orders: ReturnCandidate[] };

/**
 * The first scan of a return, which has to work out which order it belongs to.
 *
 * `scanUnitIn` already does half of this in its `wrong-order` branch — it looks
 * up where a unit actually is when the order you named is not it. This hoists
 * that lookup to the front so the person never has to name an order at all: the
 * unit in their hand says which one it is.
 *
 * Reservation-less checkouts are deliberately not handled. `Checkout.reservationId`
 * is nullable, so a unit *can* be out with no order behind it — but there are
 * none in this database (336 open checkouts, all with an order), and building a
 * branch for a case with no data means shipping a path nobody can test. If
 * walk-up loans ever start, this is where they would attach.
 */
export async function findOpenReturnsForCode(
  code: string,
): Promise<ReturnDiscovery> {
  const auth = await requireEditor();
  const barcode = code.trim();
  if (!auth.authorized) return { kind: "none", barcode, known: false };

  const unit = await prisma.assetUnit.findFirst({
    where: { OR: [{ barcode }, { serialNumber: barcode }] },
    select: { id: true, asset: { select: { name: true } } },
  });
  if (!unit) return { kind: "none", barcode, known: false };

  const open = await prisma.reservationItemUnit.findMany({
    where: {
      assetUnitId: unit.id,
      checkedOutAt: { not: null },
      checkedInAt: null,
    },
    select: {
      reservationItem: {
        select: {
          reservationId: true,
          reservation: {
            select: {
              id: true,
              reservationNumber: true,
              endDate: true,
              client: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (open.length === 0) {
    return { kind: "none", barcode, known: true };
  }

  // One unit can in principle appear against two orders if data drifted. Group
  // rather than assume, and let a person pick — guessing here would check the
  // unit in against the wrong client's job.
  const byOrder = new Map<string, (typeof open)[number]["reservationItem"]["reservation"]>();
  for (const row of open) {
    const order = row.reservationItem.reservation;
    if (order) byOrder.set(order.id, order);
  }

  const now = Date.now();
  const orders: ReturnCandidate[] = [];
  for (const order of byOrder.values()) {
    const stillOut = await prisma.reservationItemUnit.count({
      where: {
        reservationItem: { reservationId: order.id },
        checkedOutAt: { not: null },
        checkedInAt: null,
      },
    });
    const due = order.endDate;
    orders.push({
      orderId: order.id,
      number: order.reservationNumber,
      clientName: order.client.name,
      stillOut,
      dueBack: due ? due.toISOString() : null,
      daysLate: due
        ? Math.max(0, Math.floor((now - due.getTime()) / 86_400_000))
        : 0,
    });
  }

  const unitName = unit.asset.name;
  if (orders.length === 1) {
    return { kind: "one", barcode, unitName, order: orders[0] };
  }
  return { kind: "many", barcode, unitName, orders };
}

/** What is still out against one order, for the review step. */
export async function returnProgress(reservationId: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return null;
  return scanOrderBrief(reservationId);
}
