"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-utils";
import { STATUS_LABEL } from "@/lib/reservations/status";

/**
 * Record search, behind ⌘K.
 *
 * The palette shipped searching the rail's destinations and nothing else, with
 * a footer promising that "orders, units, serials and clients join this search
 * when the data layer lands". It landed. Meanwhile the placeholder said "Search
 * or scan" — and scanning a barcode into it found nothing at all, which is the
 * worst version of this: an input that invites the gun and then says no match.
 *
 * A barcode is the query this exists for. Somebody holding a box wants the unit
 * on screen, so an exact barcode or serial is ranked above everything else and
 * a digits-only query is treated as one — every barcode in this fleet is
 * digits, and a person typing 006586 is not looking for a page called 006586.
 *
 * Capped hard at six per kind. The palette is a jump, not a report: a query
 * that would return forty clients is a query the Clients list should answer,
 * and the row that says so links there.
 */

export type SearchHit = {
  /** Stable across renders; the palette keys and highlights on it. */
  key: string;
  kind: "unit" | "order" | "client" | "model" | "invoice";
  label: string;
  /** The second line — what tells two similar hits apart. */
  detail: string;
  href: string;
  /** Exact identifier matches sort above everything else. */
  exact: boolean;
};

const PER_KIND = 6;

export async function searchRecords(query: string): Promise<SearchHit[]> {
  const auth = await requireAuth();
  if (!auth.authorized) return [];

  const needle = query.trim();
  if (needle.length < 2) return [];

  const contains = { contains: needle, mode: "insensitive" } as const;
  // Every barcode in this fleet is digits. A digits-only query is a scan.
  const scanned = /^\d+$/.test(needle);

  const [units, orders, clients, models, invoices] = await Promise.all([
    prisma.assetUnit.findMany({
      where: {
        OR: [{ barcode: contains }, { serialNumber: contains }],
      },
      take: PER_KIND,
      orderBy: { barcode: "asc" },
      select: {
        id: true,
        barcode: true,
        serialNumber: true,
        status: true,
        asset: { select: { name: true } },
        location: { select: { name: true } },
      },
    }),
    prisma.reservation.findMany({
      where: {
        OR: [{ reservationNumber: contains }, { projectName: contains }],
      },
      take: PER_KIND,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reservationNumber: true,
        projectName: true,
        status: true,
        client: { select: { name: true } },
      },
    }),
    // A scan is never a client name, and running four extra text searches on
    // every keystroke of a barcode is work nobody asked for.
    scanned
      ? []
      : prisma.client.findMany({
          where: { OR: [{ name: contains }, { companyName: contains }] },
          take: PER_KIND,
          orderBy: { name: "asc" },
          select: { id: true, name: true, companyName: true, email: true },
        }),
    scanned
      ? []
      : prisma.asset.findMany({
          where: { OR: [{ name: contains }, { manufacturer: contains }] },
          take: PER_KIND,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            manufacturer: true,
            category: { select: { name: true } },
          },
        }),
    prisma.invoice.findMany({
      where: { invoiceNumber: contains },
      take: PER_KIND,
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const lower = needle.toLowerCase();
  const hits: SearchHit[] = [
    ...units.map((unit) => ({
      key: `unit:${unit.id}`,
      kind: "unit" as const,
      label: unit.barcode || unit.serialNumber || "Unit",
      detail: [
        unit.asset.name,
        unit.status.toLowerCase().replace(/_/g, " "),
        unit.location?.name,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/dashboard/units/${unit.id}`,
      exact:
        unit.barcode?.toLowerCase() === lower ||
        unit.serialNumber?.toLowerCase() === lower,
    })),
    ...orders.map((order) => ({
      key: `order:${order.id}`,
      kind: "order" as const,
      label: order.reservationNumber,
      detail: [
        order.client.name,
        order.projectName,
        STATUS_LABEL[order.status],
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/dashboard/orders/${order.id}`,
      exact: order.reservationNumber.toLowerCase() === lower,
    })),
    ...clients.map((client) => ({
      key: `client:${client.id}`,
      kind: "client" as const,
      label: client.companyName || client.name,
      detail: [client.companyName ? client.name : null, client.email]
        .filter(Boolean)
        .join(" · "),
      href: `/dashboard/clients/${client.id}`,
      exact: client.name.toLowerCase() === lower,
    })),
    ...models.map((model) => ({
      key: `model:${model.id}`,
      kind: "model" as const,
      label: model.name,
      detail: [model.manufacturer, model.category?.name]
        .filter(Boolean)
        .join(" · "),
      href: `/dashboard/assets/${model.id}`,
      exact: model.name.toLowerCase() === lower,
    })),
    ...invoices.map((invoice) => ({
      key: `invoice:${invoice.id}`,
      kind: "invoice" as const,
      label: invoice.invoiceNumber,
      detail: [invoice.client.name, invoice.status.toLowerCase()]
        .filter(Boolean)
        .join(" · "),
      href: `/dashboard/invoices/${invoice.id}`,
      exact: invoice.invoiceNumber.toLowerCase() === lower,
    })),
  ];

  // Exact identifier first, then units — the scan case — then the rest in the
  // order they were gathered.
  const RANK: Record<SearchHit["kind"], number> = {
    unit: 0,
    order: 1,
    invoice: 2,
    client: 3,
    model: 4,
  };
  return hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return RANK[a.kind] - RANK[b.kind];
  });
}
