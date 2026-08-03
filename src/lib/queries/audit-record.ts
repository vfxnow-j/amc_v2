import type { AuditItemStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Queries behind the Audits record and the scan-list record.
 *
 * `AuditItem.assetUnitId` and `ScanListItem.assetUnitId` are plain nullable
 * strings with no Prisma relation declared, so the unit behind an item is
 * fetched in a second pass and joined here — the same shape as the document
 * sweep on the Accounts record, and for the same reason.
 */

export async function getAuditHeader(id: string) {
  const audit = await prisma.inventoryAudit.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      scope: true,
      status: true,
      notes: true,
      categoryId: true,
      locationId: true,
      reservationIds: true,
      totalItems: true,
      verifiedCount: true,
      issueCount: true,
      missingCount: true,
      unexpectedCount: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  if (!audit) return null;

  const [category, location, orders] = await Promise.all([
    audit.categoryId
      ? prisma.assetCategory.findUnique({
          where: { id: audit.categoryId },
          select: { name: true },
        })
      : null,
    audit.locationId
      ? prisma.location.findUnique({
          where: { id: audit.locationId },
          select: { name: true },
        })
      : null,
    audit.reservationIds.length > 0
      ? prisma.reservation.findMany({
          where: { id: { in: audit.reservationIds } },
          select: { id: true, reservationNumber: true },
        })
      : [],
  ]);

  return {
    ...audit,
    categoryName: category?.name ?? null,
    locationName: location?.name ?? null,
    orders,
  };
}

export const AUDIT_ITEM_STATUSES: AuditItemStatus[] = [
  "PENDING",
  "VERIFIED",
  "ISSUE",
  "MISSING",
  "UNEXPECTED",
];

/**
 * Progress counted from the items, with the stored counters beside it.
 *
 * `InventoryAudit.verifiedCount` and friends are denormalised — every scan
 * increments them in the same transaction that updates the item — so they can
 * drift if any write ever lands outside that path. The items are the physical
 * record and the counters are the derived value, so the screen counts the items
 * and reports a disagreement rather than letting the counter overrule them.
 */
export async function getAuditProgress(id: string) {
  const [groups, audit] = await Promise.all([
    prisma.auditItem.groupBy({
      by: ["status"],
      where: { auditId: id },
      _count: true,
    }),
    prisma.inventoryAudit.findUnique({
      where: { id },
      select: {
        totalItems: true,
        verifiedCount: true,
        issueCount: true,
        missingCount: true,
        unexpectedCount: true,
      },
    }),
  ]);

  const count = (status: AuditItemStatus) =>
    groups.find((group) => group.status === status)?._count ?? 0;

  const counted = {
    total: groups.reduce((sum, group) => sum + group._count, 0),
    pending: count("PENDING"),
    verified: count("VERIFIED"),
    issue: count("ISSUE"),
    missing: count("MISSING"),
    unexpected: count("UNEXPECTED"),
  };

  const stored = {
    total: audit?.totalItems ?? 0,
    verified: audit?.verifiedCount ?? 0,
    issue: audit?.issueCount ?? 0,
    missing: audit?.missingCount ?? 0,
    unexpected: audit?.unexpectedCount ?? 0,
  };

  // UNEXPECTED items are scanned in on top of the scope, so the stored
  // totalItems legitimately trails the item count by that many.
  const drifted =
    stored.total + counted.unexpected !== counted.total ||
    stored.verified !== counted.verified ||
    stored.issue !== counted.issue ||
    stored.missing !== counted.missing;

  return { counted, stored, drifted };
}

export type AuditItemRow = {
  id: string;
  status: AuditItemStatus;
  barcode: string | null;
  unitId: string | null;
  assetName: string | null;
  currentStatus: string | null;
  currentLocation: string | null;
  expectedLocation: string | null;
  expectedStatus: string | null;
  issueType: string | null;
  issueNotes: string | null;
  scannedAt: Date | null;
};

/**
 * The audit's items, exceptions first.
 *
 * Anything that failed to match is what the screen exists for, so UNEXPECTED,
 * ISSUE and MISSING come before the pending count and the verified tail. Within
 * a status the order is by scan time, newest first, so the thing just scanned is
 * at the top of the group where the person scanning is looking.
 */
export async function getAuditItems(id: string, take = 60) {
  const EXCEPTION_FIRST: AuditItemStatus[] = [
    "UNEXPECTED",
    "ISSUE",
    "MISSING",
    "PENDING",
    "VERIFIED",
  ];

  const [items, total] = await Promise.all([
    prisma.auditItem.findMany({
      where: { auditId: id },
      orderBy: [{ scannedAt: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        barcode: true,
        assetUnitId: true,
        expectedLocationId: true,
        expectedStatus: true,
        issueType: true,
        issueNotes: true,
        scannedAt: true,
      },
    }),
    prisma.auditItem.count({ where: { auditId: id } }),
  ]);

  const unitIds = items
    .map((item) => item.assetUnitId)
    .filter((value): value is string => value !== null);
  const locationIds = items
    .map((item) => item.expectedLocationId)
    .filter((value): value is string => value !== null);

  const [units, locations] = await Promise.all([
    unitIds.length > 0
      ? prisma.assetUnit.findMany({
          where: { id: { in: unitIds } },
          select: {
            id: true,
            barcode: true,
            status: true,
            asset: { select: { name: true } },
            location: { select: { name: true } },
          },
        })
      : [],
    locationIds.length > 0
      ? prisma.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const locationById = new Map(
    locations.map((location) => [location.id, location.name]),
  );

  const rows: AuditItemRow[] = items.map((item) => {
    const unit = item.assetUnitId ? unitById.get(item.assetUnitId) : undefined;
    return {
      id: item.id,
      status: item.status,
      barcode: unit?.barcode ?? item.barcode,
      unitId: unit?.id ?? null,
      assetName: unit?.asset.name ?? null,
      currentStatus: unit?.status ?? null,
      currentLocation: unit?.location?.name ?? null,
      expectedLocation: item.expectedLocationId
        ? (locationById.get(item.expectedLocationId) ?? null)
        : null,
      expectedStatus: item.expectedStatus,
      issueType: item.issueType,
      issueNotes: item.issueNotes,
      scannedAt: item.scannedAt,
    };
  });

  rows.sort(
    (a, b) =>
      EXCEPTION_FIRST.indexOf(a.status) - EXCEPTION_FIRST.indexOf(b.status),
  );

  return { rows: rows.slice(0, take), total };
}

/* ── Scan lists ─────────────────────────────────────────────────────────── */

export async function getScanListRecord(id: string) {
  const list = await prisma.scanList.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!list) return null;

  const items = await prisma.scanListItem.findMany({
    where: { listId: id },
    orderBy: { scannedAt: "desc" },
    select: {
      id: true,
      barcode: true,
      assetUnitId: true,
      scannedAt: true,
      notes: true,
    },
  });

  const unitIds = items
    .map((item) => item.assetUnitId)
    .filter((value): value is string => value !== null);

  const units =
    unitIds.length > 0
      ? await prisma.assetUnit.findMany({
          where: { id: { in: unitIds } },
          select: {
            id: true,
            status: true,
            asset: { select: { name: true } },
            location: { select: { name: true } },
          },
        })
      : [];

  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  return {
    ...list,
    items: items.map((item) => {
      const unit = item.assetUnitId ? unitById.get(item.assetUnitId) : undefined;
      return {
        id: item.id,
        barcode: item.barcode,
        unitId: unit?.id ?? null,
        assetName: unit?.asset.name ?? null,
        status: unit?.status ?? null,
        locationName: unit?.location?.name ?? null,
        scannedAt: item.scannedAt,
        notes: item.notes,
      };
    }),
  };
}
