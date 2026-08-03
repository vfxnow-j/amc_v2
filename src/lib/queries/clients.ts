import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { LEAD_VIEWS, LEAD_VIEW_STATUS, type LeadView } from "@/lib/clients/labels";
import { OPEN_STATUSES, QUOTE_STATUSES } from "@/lib/reservations/status";

/** Queries behind the Clients cluster. */

export const PAGE_SIZE = 40;

/* ── Accounts ───────────────────────────────────────────────────────────── */

function clientWhere(search: string): Prisma.ClientWhereInput {
  if (!search) return {};
  const contains = { contains: search, mode: "insensitive" } as const;
  return {
    OR: [
      { name: contains },
      { companyName: contains },
      { email: contains },
      { phone: contains },
    ],
  };
}

export async function getClientList({
  search = "",
  page = 1,
}: { search?: string; page?: number } = {}) {
  const where = clientWhere(search);

  const [records, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        paymentTerms: true,
        agreementSignedAt: true,
        _count: { select: { contacts: true, reservations: true } },
      },
    }),
    prisma.client.count({ where }),
  ]);

  const ids = records.map((record) => record.id);

  // Two grouped queries rather than nested selects per row: loading every
  // invoice and every order of every client to show two numbers is what made
  // v1's list slow.
  const [openOrders, invoices] = await Promise.all([
    ids.length
      ? prisma.reservation.groupBy({
          by: ["clientId"],
          where: { clientId: { in: ids }, status: { in: OPEN_STATUSES } },
          _count: true,
        })
      : [],
    ids.length
      ? prisma.invoice.groupBy({
          by: ["clientId"],
          where: {
            clientId: { in: ids },
            status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
          },
          _sum: { total: true, amountPaid: true },
        })
      : [],
  ]);

  const openByClient = new Map(
    openOrders.map((row) => [row.clientId, row._count]),
  );
  const owedByClient = new Map(
    invoices.map((row) => [
      row.clientId,
      Number(row._sum.total ?? 0) - Number(row._sum.amountPaid ?? 0),
    ]),
  );

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      name: record.name,
      companyName: record.companyName,
      email: record.email,
      paymentTerms: record.paymentTerms,
      contacts: record._count.contacts,
      orders: record._count.reservations,
      openOrders: openByClient.get(record.id) ?? 0,
      owed: owedByClient.get(record.id) ?? 0,
      agreementSigned: record.agreementSignedAt !== null,
    })),
  };
}

export async function getClientHeaderStats() {
  const [clients, withOpen] = await Promise.all([
    prisma.client.count(),
    prisma.reservation
      .groupBy({
        by: ["clientId"],
        where: { status: { in: OPEN_STATUSES } },
      })
      .then((rows) => rows.length),
  ]);
  return { clients, withOpen };
}

/* ── Leads ──────────────────────────────────────────────────────────────── */

function leadWhere(view: LeadView, search: string): Prisma.LeadWhereInput {
  const statuses = LEAD_VIEW_STATUS[view];
  const clauses: Prisma.LeadWhereInput[] = [];
  if (statuses) clauses.push({ status: { in: statuses } });
  if (search) {
    const contains = { contains: search, mode: "insensitive" } as const;
    clauses.push({
      OR: [
        { name: contains },
        { companyName: contains },
        { email: contains },
        { phone: contains },
      ],
    });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export async function getLeadViewCounts(search = "") {
  const counts = await Promise.all(
    LEAD_VIEWS.map((view) => prisma.lead.count({ where: leadWhere(view, search) })),
  );
  return Object.fromEntries(
    LEAD_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<LeadView, number>;
}

export async function getLeadList({
  view = "new",
  search = "",
  page = 1,
}: { view?: LeadView; search?: string; page?: number } = {}) {
  const where = leadWhere(view, search);

  const [records, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        source: true,
        status: true,
        estimatedValue: true,
        createdAt: true,
        assignedTo: { select: { name: true } },
        _count: { select: { activities: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      name: record.name,
      companyName: record.companyName,
      email: record.email,
      source: record.source,
      status: record.status,
      value:
        record.estimatedValue === null ? null : Number(record.estimatedValue),
      createdAt: record.createdAt,
      owner: record.assignedTo?.name ?? null,
      activities: record._count.activities,
    })),
  };
}

export async function getLeadHeaderStats() {
  const [unassigned, open] = await Promise.all([
    prisma.lead.count({
      where: { assignedToId: null, status: { in: ["NEW", "CONTACTED"] } },
    }),
    prisma.lead.count({
      where: { status: { in: LEAD_VIEW_STATUS.working ?? [] } },
    }),
  ]);
  return { unassigned, open };
}

/* ── Quotes ─────────────────────────────────────────────────────────────── */

/**
 * Quotes are Reservations at quote stage, not a model of their own.
 *
 * The countdown reads `quoteExpiresAt`, the date the quoted pricing stops being
 * honoured — the same field that drives the quote link's expiry and the "Valid
 * until" line on the PDF. Quotes without one have simply never had a link
 * generated, and are shown as such rather than assigned an invented deadline.
 */
export async function getQuotes({
  search = "",
  page = 1,
}: { search?: string; page?: number } = {}) {
  const clauses: Prisma.ReservationWhereInput[] = [
    { status: { in: QUOTE_STATUSES } },
  ];
  if (search) {
    const contains = { contains: search, mode: "insensitive" } as const;
    clauses.push({
      OR: [
        { reservationNumber: contains },
        { projectName: contains },
        { client: { name: contains } },
        { client: { companyName: contains } },
      ],
    });
  }
  const where: Prisma.ReservationWhereInput =
    clauses.length === 1 ? clauses[0] : { AND: clauses };

  const [records, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy: [{ quoteSentAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reservationNumber: true,
        projectName: true,
        status: true,
        total: true,
        startDate: true,
        endDate: true,
        quoteSentAt: true,
        quoteExpiresAt: true,
        client: { select: { name: true } },
        quoteTokens: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { usedAt: true, expiresAt: true },
        },
      },
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      reservationNumber: record.reservationNumber,
      clientName: record.client.name,
      projectName: record.projectName,
      status: record.status,
      value: Number(record.total),
      start: record.startDate,
      end: record.endDate,
      sentAt: record.quoteSentAt,
      expiresAt: record.quoteExpiresAt,
      /** The client has opened the quote link. */
      viewed: record.quoteTokens[0]?.usedAt != null,
      hasLink: record.quoteTokens.length > 0,
    })),
  };
}

export async function getQuoteHeaderStats(now = new Date()) {
  const [live, expiring] = await Promise.all([
    prisma.reservation.count({ where: { status: { in: QUOTE_STATUSES } } }),
    prisma.reservation.count({
      where: {
        status: { in: QUOTE_STATUSES },
        quoteExpiresAt: {
          gte: now,
          lte: new Date(now.getTime() + 7 * 86_400_000),
        },
      },
    }),
  ]);
  return { live, expiring };
}
