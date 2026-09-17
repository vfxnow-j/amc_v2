"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { mayReceive } from "@/lib/procurement/access";
import { getPOHeader, getPOLines } from "@/lib/queries/po-record";

/**
 * What the Scan screen's Receive mode needs before it hands off.
 *
 * Reads only. Receive mode collects serials and nothing else; the receipt itself
 * — the model a line becomes, locations, barcodes, and the write — stays on the
 * PO's receive screen, which already holds every check a receipt needs and the
 * approval gate in front of it. A second write path from the scanner would be a
 * second place those checks could drift apart.
 *
 * Gated with `mayReceive`, the same call the receive screen makes, so the
 * scanner never offers a PO the screen it hands off to would refuse.
 */

export type ReceiveQueueRow = {
  id: string;
  poNumber: string;
  vendorName: string;
  /** Units and resale serials still to come — the lines a scan can land on. */
  scannable: number;
  expectedDate: string | null;
  daysLate: number;
};

export type ReceiveBriefLine = {
  id: string;
  description: string;
  remaining: number;
  /** `serials` is resale: the serial is kept on the line and no unit is made. */
  mode: "units" | "unlinked" | "serials";
  assetName: string | null;
};

export type ReceiveBrief = {
  id: string;
  poNumber: string;
  vendorName: string;
  lines: ReceiveBriefLine[];
  /** Counted-only lines with something outstanding; the receive screen takes these. */
  uncounted: number;
};

const OPEN = ["SUBMITTED", "PARTIAL"] as const;

async function allowed() {
  const user = await getSessionUser();
  return Boolean(user && mayReceive(user.role));
}

/**
 * Purchase orders a scan could land on, earliest expected first.
 *
 * A PO whose only outstanding lines are consumables is left out: there is
 * nothing on it to scan, and offering it would open an empty session.
 */
export async function scanReceiveQueue(search?: string): Promise<ReceiveQueueRow[]> {
  if (!(await allowed())) return [];

  const term = search?.trim();
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: [...OPEN] },
      ...(term && term.length >= 2
        ? {
            OR: [
              { poNumber: { contains: term, mode: "insensitive" } },
              { vendor: { name: { contains: term, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
    take: 50,
    select: {
      id: true,
      poNumber: true,
      expectedDate: true,
      vendor: { select: { name: true } },
      items: {
        select: { quantity: true, receivedQuantity: true, isInventoried: true, isResale: true },
      },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rows
    .map((row) => {
      const scannable = row.items
        .filter((item) => item.isInventoried || item.isResale)
        .reduce((sum, item) => sum + Math.max(0, item.quantity - item.receivedQuantity), 0);
      const expected = row.expectedDate;
      const daysLate = expected
        ? Math.max(0, Math.floor((today.getTime() - expected.getTime()) / 86_400_000))
        : 0;
      return {
        id: row.id,
        poNumber: row.poNumber,
        vendorName: row.vendor.name,
        scannable,
        expectedDate: expected ? expected.toISOString() : null,
        daysLate,
      };
    })
    .filter((row) => row.scannable > 0);
}

/** The lines of one PO a serial can be scanned onto, in the PO's own order. */
export async function scanReceiveBrief(id: string): Promise<ReceiveBrief | null> {
  if (!(await allowed())) return null;

  const header = await getPOHeader(id);
  if (!header || !OPEN.includes(header.status as (typeof OPEN)[number])) return null;

  const outstanding = (await getPOLines(id)).filter((line) => line.remaining > 0);

  return {
    id: header.id,
    poNumber: header.poNumber,
    vendorName: header.vendor.name,
    lines: outstanding
      .filter((line) => line.mode !== "consumable")
      .map((line) => ({
        id: line.id,
        description: line.description,
        remaining: line.remaining,
        mode: line.mode as ReceiveBriefLine["mode"],
        assetName: line.assetName,
      })),
    uncounted: outstanding.filter((line) => line.mode === "consumable").length,
  };
}

/**
 * Whether a serial is already on a unit in the fleet.
 *
 * `serialNumber` is unique, so the receipt would refuse it anyway — but at the
 * end, after the whole pallet is scanned. Saying so on the scan, while the box
 * is still in the person's hands, is the difference between setting one box
 * aside and hunting for it in a stack of forty.
 */
export async function scanSerialInFleet(
  serial: string,
): Promise<{ barcode: string; assetName: string } | null> {
  if (!(await allowed())) return null;
  const value = serial.trim();
  if (!value) return null;

  const unit = await prisma.assetUnit.findFirst({
    where: { serialNumber: { equals: value, mode: "insensitive" } },
    select: { barcode: true, asset: { select: { name: true } } },
  });
  return unit ? { barcode: unit.barcode, assetName: unit.asset.name } : null;
}
