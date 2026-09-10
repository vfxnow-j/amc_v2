import type { AssetStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { IN_FLEET, OPEN_CHECKOUT } from "@/lib/inventory/availability";
import { tallyUnits } from "@/lib/queries/inventory";

/**
 * Queries behind the Locations record. One per card, so each Suspends alone.
 *
 * A location is a shelf, not a document: nothing is filed *on* it, everything is
 * filed *at* it. So every query here counts or lists units, and the one rule the
 * whole module obeys is that its numbers must be the numbers the locations list
 * shows for the same row — which is why the breakdown goes through `tallyUnits`
 * in `queries/inventory` rather than being re-derived here. A record that
 * disagrees with the list it was opened from is the bug this screen would
 * otherwise introduce.
 */

/** How many units of a location's list of units the record shows before it links out. */
export const UNITS_SHOWN = 14;
/** How many distinct assets the breakdown shows before it links out. */
export const ASSETS_SHOWN = 12;

/**
 * The location, its place in the hierarchy, and what is filed at it.
 *
 * Two round trips rather than one: the child locations have to be known before
 * their units can be tallied, and tallying parent and children in a single
 * `groupBy` is what keeps this at two however deep the hierarchy goes.
 */
export async function getLocationHeader(id: string) {
  const location = await prisma.location.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      description: true,
      taxRate: true,
      taxLabel: true,
      createdAt: true,
      parentLocation: { select: { id: true, name: true } },
      childLocations: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      },
    },
  });

  if (!location) return null;

  const childIds = location.childLocations.map((child) => child.id);
  const groups = await prisma.assetUnit.groupBy({
    by: ["locationId", "status"],
    where: { locationId: { in: [id, ...childIds] } },
    _count: true,
  });

  const at = (locationId: string) =>
    tallyUnits(groups.filter((group) => group.locationId === locationId));

  return {
    id: location.id,
    name: location.name,
    address: location.address,
    description: location.description,
    // A rate of exactly zero is a decision somebody recorded — tax-free — and
    // reads differently from a location nobody has set a rate on at all.
    taxRate: location.taxRate === null ? null : Number(location.taxRate),
    taxLabel: location.taxLabel,
    createdAt: location.createdAt,
    parent: location.parentLocation,
    children: location.childLocations.map((child) => ({
      ...child,
      ...at(child.id),
    })),
    /**
     * This location's own units only. A child's stock is *not* rolled up into
     * it: the locations list counts every location on its own row, and a record
     * that silently added its children's units would report a bigger warehouse
     * than the list does for the same name.
     */
    tally: at(id),
  };
}

export type LocationUnitRow = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  asset: { id: string; name: string };
  status: AssetStatus;
  holder: { id: string; name: string } | null;
};

/**
 * What is on the shelf here, in-fleet first.
 *
 * Retired and sold units keep the location they were last at, so listing them
 * alongside the live stock would make a shelf look fuller than it is. They are
 * counted in the tally and named in the footer instead — the same treatment the
 * locations list gives them.
 */
export async function getLocationUnits(id: string, take = UNITS_SHOWN) {
  const where = { locationId: id, status: { in: IN_FLEET } };

  const [records, total] = await Promise.all([
    prisma.assetUnit.findMany({
      where,
      orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
      take,
      select: {
        id: true,
        barcode: true,
        serialNumber: true,
        status: true,
        asset: { select: { id: true, name: true } },
        checkouts: {
          // Custody is the open checkout, never the status column — the same
          // rule the unit record and the Units list read it by.
          where: OPEN_CHECKOUT,
          orderBy: { checkoutDate: "desc" },
          take: 1,
          select: { client: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.assetUnit.count({ where }),
  ]);

  const rows: LocationUnitRow[] = records.map((record) => ({
    id: record.id,
    barcode: record.barcode,
    serialNumber: record.serialNumber,
    asset: record.asset,
    status: record.status,
    holder: record.checkouts[0]?.client ?? null,
  }));

  return { rows, total };
}

/**
 * What kinds of thing are here, biggest holding first.
 *
 * The question a warehouse actually gets asked is not "which units are here"
 * but "have we got a Venice here and is one free", and 684 rows cannot answer
 * that. One `groupBy` over asset and status answers it for every asset at once;
 * the names are fetched only for the handful shown.
 */
export async function getLocationAssets(id: string, take = ASSETS_SHOWN) {
  const groups = await prisma.assetUnit.groupBy({
    by: ["assetId", "status"],
    where: { locationId: id, status: { in: IN_FLEET } },
    _count: true,
  });

  const byAsset = new Map<string, { status: AssetStatus; _count: number }[]>();
  for (const group of groups) {
    const rows = byAsset.get(group.assetId) ?? [];
    rows.push({ status: group.status, _count: group._count });
    byAsset.set(group.assetId, rows);
  }

  const tallied = [...byAsset.entries()]
    .map(([assetId, rows]) => ({ assetId, ...tallyUnits(rows) }))
    .sort((a, b) => b.inFleet - a.inFleet || b.free - a.free);

  const top = tallied.slice(0, take);
  const assets = await prisma.asset.findMany({
    where: { id: { in: top.map((row) => row.assetId) } },
    select: { id: true, name: true },
  });
  const name = new Map(assets.map((asset) => [asset.id, asset.name]));

  return {
    total: tallied.length,
    rows: top.map((row) => ({
      id: row.assetId,
      // An asset row whose asset has since been deleted would otherwise render
      // a blank, clickable line.
      name: name.get(row.assetId) ?? "Unnamed asset",
      inFleet: row.inFleet,
      free: row.free,
      out: row.out,
      service: row.service,
    })),
  };
}

/**
 * Everything that has moved in or out of here.
 *
 * `AssetTransfer` has no status column — a row *is* a completed move — so this
 * is a log and never a queue of pending work, the same reading the locations
 * screen and the unit record give it.
 */
export async function getLocationTransfers(id: string, take = 10) {
  const where = {
    OR: [{ fromLocationId: id }, { toLocationId: id }],
  };

  const [records, total] = await Promise.all([
    prisma.assetTransfer.findMany({
      where,
      orderBy: { transferDate: "desc" },
      take,
      select: {
        id: true,
        transferDate: true,
        assetUnit: {
          select: {
            id: true,
            barcode: true,
            asset: { select: { id: true, name: true } },
          },
        },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
      },
    }),
    prisma.assetTransfer.count({ where }),
  ]);

  return {
    total,
    rows: records.map((record) => ({
      id: record.id,
      date: record.transferDate,
      unit: { id: record.assetUnit.id, barcode: record.assetUnit.barcode },
      asset: record.assetUnit.asset,
      from: record.fromLocation,
      to: record.toLocation,
      /** Which way it went, from this location's point of view. */
      inbound: record.toLocation.id === id,
    })),
  };
}

/**
 * Hardware on its way here.
 *
 * "On order" is SUBMITTED or PARTIAL, the definition the Purchase orders list
 * uses for its own On order tab — a draft has not been placed with anybody and
 * is not arriving.
 */
export async function getLocationPurchaseOrders(id: string, take = 8) {
  const [records, total, onOrder] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { shipToLocationId: id },
      orderBy: { orderDate: "desc" },
      take,
      select: {
        id: true,
        poNumber: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        total: true,
        vendor: { select: { id: true, name: true } },
      },
    }),
    prisma.purchaseOrder.count({ where: { shipToLocationId: id } }),
    prisma.purchaseOrder.count({
      where: { shipToLocationId: id, status: { in: ["SUBMITTED", "PARTIAL"] } },
    }),
  ]);

  return {
    total,
    onOrder,
    rows: records.map((record) => ({
      ...record,
      total: Number(record.total),
    })),
  };
}
