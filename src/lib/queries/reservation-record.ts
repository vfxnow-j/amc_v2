import type {
  AssetStatus,
  InvoiceStatus,
  ReservationStatus,
  ReservationType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Queries behind Operate → Reservations → the record.
 *
 * `actions/reservations.getReservation` exists and returns everything, but it
 * is one deep include used by every caller. The record has cards with their own
 * Suspense boundaries, and a card that only needs the activity log shouldn't
 * wait on the line items — so this module is one function per card.
 */

export type ReservationHeader = {
  id: string;
  reservationNumber: string;
  type: ReservationType;
  status: ReservationStatus;
  start: Date;
  end: Date;
  isRecurring: boolean;
  projectName: string | null;
  projectCode: string | null;
  notes: string | null;
  internalNotes: string | null;
  client: { id: string; name: string; companyName: string | null; email: string | null };
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
  };
  /** Units ordered, assigned, out and back — the handover at a glance. */
  progress: {
    ordered: number;
    assigned: number;
    out: number;
    returned: number;
  };
};

export async function getReservationHeader(
  id: string,
): Promise<ReservationHeader | null> {
  const record = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      reservationNumber: true,
      reservationType: true,
      status: true,
      startDate: true,
      endDate: true,
      isRecurring: true,
      projectName: true,
      projectCode: true,
      notes: true,
      internalNotes: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      total: true,
      client: {
        select: { id: true, name: true, companyName: true, email: true },
      },
      items: {
        where: { assetId: { not: null }, parentId: null },
        select: {
          quantity: true,
          assignedCount: true,
          checkedOutCount: true,
          checkedInCount: true,
        },
      },
    },
  });

  if (!record) return null;

  const items = record.items;
  const sum = (pick: (item: (typeof items)[number]) => number) =>
    items.reduce((total, item) => total + pick(item), 0);

  return {
    id: record.id,
    reservationNumber: record.reservationNumber,
    type: record.reservationType,
    status: record.status,
    start: record.startDate,
    end: record.endDate,
    isRecurring: record.isRecurring,
    projectName: record.projectName,
    projectCode: record.projectCode,
    notes: record.notes,
    internalNotes: record.internalNotes,
    client: record.client,
    totals: {
      subtotal: Number(record.subtotal),
      discount: Number(record.discountAmount),
      tax: Number(record.taxAmount),
      total: Number(record.total),
    },
    progress: {
      ordered: sum((item) => item.quantity),
      assigned: sum((item) => item.assignedCount),
      out: sum((item) => item.checkedOutCount),
      returned: sum((item) => item.checkedInCount),
    },
  };
}

export type RecordUnit = {
  id: string;
  assetUnitId: string;
  barcode: string;
  serialNumber: string | null;
  unitStatus: AssetStatus;
  condition: string | null;
  locationName: string | null;
  assignedAt: Date | null;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
};

export type RecordLine = {
  id: string;
  /** Asset name, or the free-text description for an ad-hoc line. */
  label: string;
  assetId: string | null;
  category: string | null;
  quantity: number;
  rate: number;
  pricingType: string;
  subtotal: number;
  isOneTime: boolean;
  packageName: string | null;
  units: RecordUnit[];
  /** Ordered quantity not yet covered by an assigned or checked-out unit. */
  unassigned: number;
  /**
   * Units currently out on this line, counted two ways.
   *
   * `checkedOutCount` and `checkedInCount` are *cumulative* — check-out
   * increments the first, check-in increments the second and never decrements
   * the first — so what is currently out is the difference between them. The
   * junction rows say the same thing by having `checkedOutAt` set and
   * `checkedInAt` null.
   *
   * They should agree. On some imported orders they don't, because the counters
   * were written without ever creating the rows, and the record has to say so
   * rather than quietly pick one: only an attached unit can be checked back in.
   */
  countedOut: number;
  attachedOut: number;
};

/**
 * The order's lines, each with the physical units attached to it.
 *
 * Component sub-items are folded into their parent's label rather than listed:
 * they are pricing rows, not things anyone pulls off a shelf.
 */
export async function getReservationLines(id: string): Promise<RecordLine[]> {
  const items = await prisma.reservationItem.findMany({
    where: { reservationId: id, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      description: true,
      category: true,
      quantity: true,
      checkedOutCount: true,
      checkedInCount: true,
      rate: true,
      pricingType: true,
      subtotal: true,
      isOneTime: true,
      assetId: true,
      asset: { select: { name: true, category: { select: { name: true } } } },
      service: { select: { name: true } },
      cloudProduct: { select: { name: true } },
      package: { select: { name: true } },
      units: {
        orderBy: { assetUnit: { barcode: "asc" } },
        select: {
          id: true,
          assetUnitId: true,
          assignedAt: true,
          checkedOutAt: true,
          checkedInAt: true,
          assetUnit: {
            select: {
              barcode: true,
              serialNumber: true,
              status: true,
              condition: true,
              location: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return items.map((item) => {
    const units: RecordUnit[] = item.units.map((unit) => ({
      id: unit.id,
      assetUnitId: unit.assetUnitId,
      barcode: unit.assetUnit.barcode,
      serialNumber: unit.assetUnit.serialNumber,
      unitStatus: unit.assetUnit.status,
      condition: unit.assetUnit.condition,
      locationName: unit.assetUnit.location?.name ?? null,
      assignedAt: unit.assignedAt,
      checkedOutAt: unit.checkedOutAt,
      checkedInAt: unit.checkedInAt,
    }));

    return {
      id: item.id,
      label:
        item.asset?.name ??
        item.service?.name ??
        item.cloudProduct?.name ??
        item.description ??
        "Untitled line",
      assetId: item.assetId,
      category: item.asset?.category?.name ?? item.category,
      quantity: item.quantity,
      rate: Number(item.rate),
      pricingType: item.pricingType,
      subtotal: Number(item.subtotal),
      isOneTime: item.isOneTime,
      packageName: item.package?.name ?? null,
      units,
      // Only asset-backed lines have units to assign; a service line is never
      // "unassigned", it just has no physical side.
      unassigned: item.assetId
        ? Math.max(0, item.quantity - units.filter((u) => !u.checkedInAt).length)
        : 0,
      // Both sides are "currently out": the counters are cumulative, so the
      // difference is what hasn't come back.
      countedOut: item.checkedOutCount - item.checkedInCount,
      attachedOut: units.filter((u) => u.checkedOutAt && !u.checkedInAt).length,
    };
  });
}

export type ActivityEntry = {
  id: string;
  at: Date;
  what: string;
  who: string | null;
  notes: string | null;
};

/**
 * `StatusHistory` for this order. AuditLog is deliberately not merged in yet —
 * it records field-level diffs across every entity, and pulling the order's
 * share of it needs an entityId filter plus a readable rendering of the JSON
 * diff, which is its own piece of work.
 */
export async function getReservationActivity(
  id: string,
  take = 12,
): Promise<ActivityEntry[]> {
  const history = await prisma.statusHistory.findMany({
    where: { entityType: "RESERVATION", entityId: id },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      fromStatus: true,
      toStatus: true,
      notes: true,
      changedBy: { select: { name: true } },
    },
  });

  return history.map((entry) => ({
    id: entry.id,
    at: entry.createdAt,
    what: entry.fromStatus
      ? `${entry.fromStatus} → ${entry.toStatus}`
      : `Created as ${entry.toStatus}`,
    who: entry.changedBy?.name ?? null,
    notes: entry.notes,
  }));
}

export type RecordInvoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  total: number;
  amountPaid: number;
  dueDate: Date;
};

export async function getReservationInvoices(
  id: string,
): Promise<RecordInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { reservationId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      amountPaid: true,
      dueDate: true,
    },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    total: Number(invoice.total),
    amountPaid: Number(invoice.amountPaid),
    dueDate: invoice.dueDate,
  }));
}
