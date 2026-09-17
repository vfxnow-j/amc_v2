import { prisma } from "@/lib/prisma";

/**
 * What is still to be checked out before an order may ship or be activated —
 * the stop gap (owner, 2026-09-17): an order is not activated, shipped, or
 * otherwise moved on as if the kit were out unless every matching item is
 * checked out.
 *
 * One definition, read by the order page (`getOrderLifecycle`), the ship gate
 * (`markShipped`), activation (`activateReservation`) and the stage dialogs:
 *
 * - every asset-backed line on the order's chosen option (or on no option, for
 *   older orders), including a part chosen from stock under a configured
 *   machine — a GPU is scanned like its workstation;
 * - a line is short by `quantity − checkedOutCount`. Services, fees and spec
 *   parts (RAM, a drive) have no asset and are never counted.
 *
 * A cloud order is exempt from activation's gate — its backing hardware is
 * allocated, not scanned, and activation is what marks it in use.
 */

export type MissingLine = {
  itemId: string;
  /** The asset on the line. */
  label: string;
  /** The machine it goes in, when the line is a part. */
  parentLabel: string | null;
  ordered: number;
  out: number;
  missing: number;
};

export type Handover = {
  missing: MissingLine[];
  /** Units still to check out across those lines. */
  units: number;
  /** Nothing on the order has a unit to scan. */
  nothingToScan: boolean;
};

type Db = Pick<typeof prisma, "reservationItem">;

export async function handoverShortfall(reservationId: string, db: Db = prisma): Promise<Handover> {
  const lines = await db.reservationItem.findMany({
    where: {
      reservationId,
      assetId: { not: null },
      OR: [{ packageId: null }, { package: { isActive: true } }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      quantity: true,
      checkedOutCount: true,
      asset: { select: { name: true } },
      parent: { select: { description: true, asset: { select: { name: true } } } },
    },
  });

  const missing = lines
    .filter((line) => line.checkedOutCount < line.quantity)
    .map((line) => ({
      itemId: line.id,
      label: line.asset?.name ?? "Item",
      parentLabel: line.parent ? (line.parent.asset?.name ?? line.parent.description ?? "Machine") : null,
      ordered: line.quantity,
      out: line.checkedOutCount,
      missing: line.quantity - line.checkedOutCount,
    }));

  return {
    missing,
    units: missing.reduce((sum, line) => sum + line.missing, 0),
    nothingToScan: lines.length === 0,
  };
}

/** The refusal, in words — for the server when there is no dialog to show it. */
export function shortfallMessage(handover: Handover, move: "activate" | "ship"): string {
  const { units, missing } = handover;
  return `${units} ${units === 1 ? "unit is" : "units are"} still to be checked out across ${missing.length} ${
    missing.length === 1 ? "line" : "lines"
  }. Scan everything out before ${move === "ship" ? "shipping" : "activating"}.`;
}
