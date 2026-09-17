import { prisma } from "@/lib/prisma";
import { pickRate } from "@/lib/queries/order-builder";
import type { Prisma, ReservationStatus } from "@/generated/prisma/client";

/**
 * Reads behind Inventory → Packages and the quote options on an order.
 *
 * Two different things share the word. **Our packages** (`PackageTemplate`) are
 * predefined sets of lines built once and loaded into quotes. **Client
 * packages** are an order's quote options (`Package`) that went ahead: the one
 * the client approved, on an order that was committed. The second is what a
 * reorder starts from and what the client portal will show a client as theirs.
 */

export const PAGE_SIZE = 40;

const toNumber = (value: Prisma.Decimal | null | undefined) => (value == null ? null : Number(value));

/* ── Our packages ───────────────────────────────────────────────────────── */

export type TemplateLine = {
  id: string;
  label: string;
  kind: "asset" | "service" | "text";
  assetId: string | null;
  quantity: number;
  /** The override, when the package sets one. */
  rate: number | null;
  /** What the line prices at if loaded now: the override, or the asset's current rate. */
  effectiveRate: number;
  pricingType: string;
  isOneTime: boolean;
};

function templateLine(item: {
  id: string;
  assetId: string | null;
  serviceId: string | null;
  description: string | null;
  quantity: number;
  rate: Prisma.Decimal | null;
  pricingType: string | null;
  isOneTime: boolean;
  asset: { name: string; monthlyRate: Prisma.Decimal | null; weeklyRate: Prisma.Decimal | null; dailyRate: Prisma.Decimal | null } | null;
  service: { name: string; defaultRate: Prisma.Decimal } | null;
}): TemplateLine {
  const current = item.asset ? pickRate(item.asset) : null;
  return {
    id: item.id,
    label: item.asset?.name ?? item.service?.name ?? item.description ?? "Line",
    kind: item.assetId ? "asset" : item.serviceId ? "service" : "text",
    assetId: item.assetId,
    quantity: item.quantity,
    rate: toNumber(item.rate),
    effectiveRate: toNumber(item.rate) ?? current?.rate ?? Number(item.service?.defaultRate ?? 0),
    pricingType: item.pricingType ?? current?.pricingType ?? "MONTHLY",
    isOneTime: item.isOneTime,
  };
}

const TEMPLATE_ITEM_SELECT = {
  id: true,
  assetId: true,
  serviceId: true,
  description: true,
  quantity: true,
  rate: true,
  pricingType: true,
  isOneTime: true,
  asset: { select: { name: true, monthlyRate: true, weeklyRate: true, dailyRate: true } },
  service: { select: { name: true, defaultRate: true } },
} satisfies Prisma.PackageTemplateItemSelect;

/** What a package's recurring lines come to per period, grouped by unit: "$4,200/mo". */
export function recurringTotals(lines: TemplateLine[]) {
  const totals = new Map<string, number>();
  let once = 0;
  for (const line of lines) {
    const amount = line.effectiveRate * line.quantity;
    if (line.isOneTime) once += amount;
    else totals.set(line.pricingType, (totals.get(line.pricingType) ?? 0) + amount);
  }
  return { byPeriod: [...totals.entries()].map(([pricingType, amount]) => ({ pricingType, amount })), once };
}

export async function listTemplates({ archived = false }: { archived?: boolean } = {}) {
  const templates = await prisma.packageTemplate.findMany({
    where: { isActive: !archived },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      updatedAt: true,
      items: { orderBy: { sortOrder: "asc" }, select: TEMPLATE_ITEM_SELECT },
    },
  });
  const archivedCount = await prisma.packageTemplate.count({ where: { isActive: archived } });
  return {
    archivedCount,
    rows: templates.map((template) => {
      const lines = template.items.map(templateLine);
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        isActive: template.isActive,
        updatedAt: template.updatedAt,
        lines,
        totals: recurringTotals(lines),
      };
    }),
  };
}

export async function getTemplate(id: string) {
  const template = await prisma.packageTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      items: { orderBy: { sortOrder: "asc" }, select: TEMPLATE_ITEM_SELECT },
    },
  });
  if (!template) return null;
  const lines = template.items.map(templateLine);
  return { ...template, lines, totals: recurringTotals(lines) };
}

/** Our packages matching a search, for Add line on an order. */
export async function searchTemplates(query: string, take = 6) {
  const needle = query.trim();
  if (!needle) return [];
  const templates = await prisma.packageTemplate.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: needle, mode: "insensitive" } },
        { description: { contains: needle, mode: "insensitive" } },
        { items: { some: { asset: { name: { contains: needle, mode: "insensitive" } } } } },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      description: true,
      items: { orderBy: { sortOrder: "asc" }, select: TEMPLATE_ITEM_SELECT },
    },
  });
  return templates.map((template) => {
    const lines = template.items.map(templateLine);
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      lineCount: lines.length,
      summary: lines.slice(0, 3).map((line) => `${line.quantity}× ${line.label}`).join(", "),
      totals: recurringTotals(lines),
    };
  });
}

/* ── Client packages ────────────────────────────────────────────────────── */

/** An option "went ahead" once the order holding it was committed. */
const COMMITTED: ReservationStatus[] = ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE", "COMPLETED"];

export async function listClientPackages({ page = 1, query = "" }: { page?: number; query?: string } = {}) {
  const needle = query.trim();
  const where: Prisma.PackageWhereInput = {
    isActive: true,
    reservation: {
      status: { in: COMMITTED },
      ...(needle
        ? {
            OR: [
              { client: { name: { contains: needle, mode: "insensitive" } } },
              { client: { companyName: { contains: needle, mode: "insensitive" } } },
              { reservationNumber: { contains: needle, mode: "insensitive" } },
              { projectName: { contains: needle, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };

  const [records, total] = await Promise.all([
    prisma.package.findMany({
      where,
      orderBy: [{ reservation: { startDate: "desc" } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        reservation: {
          select: {
            id: true,
            reservationNumber: true,
            reservationType: true,
            status: true,
            startDate: true,
            projectName: true,
            total: true,
            client: { select: { id: true, name: true } },
            _count: { select: { packages: true } },
          },
        },
        items: {
          where: { parentId: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            quantity: true,
            description: true,
            asset: { select: { name: true } },
            service: { select: { name: true } },
          },
        },
      },
    }),
    prisma.package.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      name: record.name,
      order: {
        id: record.reservation.id,
        number: record.reservation.reservationNumber,
        type: record.reservation.reservationType,
        status: record.reservation.status,
        start: record.reservation.startDate,
        project: record.reservation.projectName,
        total: Number(record.reservation.total),
        options: record.reservation._count.packages,
      },
      client: record.reservation.client,
      lines: record.items.map((item) => ({
        quantity: item.quantity,
        label: item.asset?.name ?? item.service?.name ?? item.description ?? "Line",
      })),
    })),
  };
}

/* ── An order's quote options ───────────────────────────────────────────── */

export type OrderOption = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  rtoTermMonths: number | null;
  lineCount: number;
  /** Sum of the option's line amounts, parts included. Before tax, discount and shipping. */
  subtotal: number;
};

export async function getOrderOptions(reservationId: string): Promise<OrderOption[]> {
  const packages = await prisma.package.findMany({
    where: { reservationId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      rtoTermMonths: true,
      items: { select: { parentId: true, subtotal: true, includedInParent: true } },
    },
  });
  return packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    isActive: pkg.isActive,
    rtoTermMonths: pkg.rtoTermMonths,
    lineCount: pkg.items.filter((item) => !item.parentId).length,
    subtotal: pkg.items.reduce(
      (sum, item) => sum + (item.includedInParent ? 0 : Number(item.subtotal)),
      0,
    ),
  }));
}
