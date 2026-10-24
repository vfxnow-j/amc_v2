import type { FlagOutcome, FlagSeverity, FlagSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABEL, reasonByCode, type FlagCategory } from "@/lib/flags/catalog";

/**
 * Everything the case panel on an order shows, as plain data (dates are ISO
 * strings, money is a number): the panel is a client component and takes no
 * Prisma types.
 */

export type FlagView = {
  id: string;
  reason: string;
  label: string;
  categoryLabel: string;
  severity: FlagSeverity;
  source: FlagSource;
  note: string | null;
  exposure: number;
  ownerId: string | null;
  ownerName: string | null;
  raisedAt: string;
  raisedByName: string | null;
  nextActionDate: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  claimNumber: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  outcome: FlagOutcome | null;
  outcomeAmount: number | null;
  resolutionNote: string | null;
  steps: { id: string; label: string; doneAt: string | null; note: string | null }[];
  units: { id: string; assetUnitId: string; barcode: string; assetName: string; foundAt: string | null }[];
  timeline: { at: string; text: string }[];
};

export type OrderUnitOption = { id: string; barcode: string; assetName: string };

export async function getOrderFlags(reservationId: string): Promise<{
  open: FlagView[];
  closed: FlagView[];
  unitsOut: OrderUnitOption[];
}> {
  const [flags, out, audit] = await Promise.all([
    prisma.orderFlag.findMany({
      where: { reservationId },
      orderBy: { raisedAt: "desc" },
      include: {
        owner: { select: { name: true } },
        steps: { orderBy: { position: "asc" } },
        units: { include: { assetUnit: { select: { barcode: true, asset: { select: { name: true } } } } } },
      },
    }),
    prisma.reservationItemUnit.findMany({
      where: { reservationItem: { reservationId }, checkedOutAt: { not: null }, checkedInAt: null },
      select: { assetUnit: { select: { id: true, barcode: true, asset: { select: { name: true } } } } },
    }),
    // The case timeline is audit rows on the order that carry a flagId.
    prisma.auditLog.findMany({
      where: { entityType: "Reservation", entityId: reservationId, newValues: { path: ["event"], not: "" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { createdAt: true, newValues: true },
    }),
  ]);

  const peopleIds = [...new Set(flags.flatMap((f) => [f.raisedById, f.resolvedById]).filter((x): x is string => !!x))];
  const people = peopleIds.length
    ? await prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const eventsByFlag = new Map<string, { at: string; text: string }[]>();
  for (const row of audit) {
    const v = row.newValues as { flagId?: unknown; event?: unknown } | null;
    if (!v || typeof v.flagId !== "string" || typeof v.event !== "string") continue;
    const list = eventsByFlag.get(v.flagId) ?? [];
    list.push({ at: row.createdAt.toISOString(), text: v.event });
    eventsByFlag.set(v.flagId, list);
  }

  const views: FlagView[] = flags.map((f) => ({
    id: f.id,
    reason: f.reason,
    label: reasonByCode(f.reason)?.label ?? f.reason,
    categoryLabel: CATEGORY_LABEL[f.category as FlagCategory] ?? f.category,
    severity: f.severity,
    source: f.source,
    note: f.note,
    exposure: Number(f.exposureAmount),
    ownerId: f.ownerId,
    ownerName: f.owner?.name ?? null,
    raisedAt: f.raisedAt.toISOString(),
    raisedByName: f.raisedById ? (nameOf.get(f.raisedById) ?? null) : null,
    nextActionDate: f.nextActionDate ? f.nextActionDate.toISOString() : null,
    carrier: f.carrier,
    trackingNumber: f.trackingNumber,
    claimNumber: f.claimNumber,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    resolvedByName: f.resolvedById ? (nameOf.get(f.resolvedById) ?? null) : null,
    outcome: f.outcome,
    outcomeAmount: f.outcomeAmount === null ? null : Number(f.outcomeAmount),
    resolutionNote: f.resolutionNote,
    steps: f.steps.map((s) => ({ id: s.id, label: s.label, doneAt: s.doneAt ? s.doneAt.toISOString() : null, note: s.note })),
    units: f.units.map((u) => ({
      id: u.id,
      assetUnitId: u.assetUnitId,
      barcode: u.assetUnit.barcode,
      assetName: u.assetUnit.asset.name,
      foundAt: u.foundAt ? u.foundAt.toISOString() : null,
    })),
    timeline: eventsByFlag.get(f.id) ?? [],
  }));

  return {
    open: views.filter((f) => !f.resolvedAt),
    closed: views.filter((f) => f.resolvedAt),
    unitsOut: out.map((o) => ({ id: o.assetUnit.id, barcode: o.assetUnit.barcode, assetName: o.assetUnit.asset.name })),
  };
}
