import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES, QUOTE_STATUSES } from "@/lib/reservations/status";

/**
 * Queries behind the Leads record. One per card, so each Suspends alone.
 *
 * Nothing here writes. The record's four mutations — assign, move the status,
 * log an activity, resolve it — all go through the ported `lib/actions/leads`,
 * which already gate on `requireEditor` and write the `LeadActivity` row that
 * makes the change auditable.
 */

export async function getLeadHeader(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      companyName: true,
      source: true,
      channel: true,
      salesRep: true,
      status: true,
      notes: true,
      estimatedValue: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      hubspotContactId: true,
      justcallContactId: true,
      adCampaign: true,
      adPlatform: true,
      adCost: true,
      lostReason: true,
      lostAt: true,
      convertedToClientId: true,
      convertedToClient: { select: { id: true, name: true } },
      convertedReservationId: true,
      convertedAt: true,
      boundToReservationId: true,
      boundToClientId: true,
      boundToClient: { select: { id: true, name: true } },
      boundAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { activities: true } },
    },
  });

  if (!lead) return null;

  // Both order links are bare id columns, not relations, so the number has to
  // be fetched separately — otherwise the outcome card can only offer a link
  // with nothing written on it.
  //
  // Which one wins depends on the outcome, and a bound lead can carry both: it
  // was converted into an order of its own first, then bound to somebody
  // else's when the duplicate was spotted. The binding is the later decision
  // and the one that resolved the enquiry, so BOUND reads that first.
  const orderId =
    lead.status === "BOUND"
      ? (lead.boundToReservationId ?? lead.convertedReservationId)
      : (lead.convertedReservationId ?? lead.boundToReservationId);

  const order = orderId
    ? await prisma.reservation.findUnique({
        where: { id: orderId },
        select: { id: true, reservationNumber: true, status: true },
      })
    : null;

  return {
    ...lead,
    value: lead.estimatedValue === null ? null : Number(lead.estimatedValue),
    adCost: lead.adCost === null ? null : Number(lead.adCost),
    owner: lead.assignedTo,
    activities: lead._count.activities,
    order,
    // The id is set but the order behind it is gone. Reported rather than
    // hidden: a lead filed against an order nobody can open is a broken
    // outcome, and quietly dropping the row makes it look like it never had
    // one.
    orderMissing: orderId !== null && order === null,
  };
}

export type LeadHeader = NonNullable<Awaited<ReturnType<typeof getLeadHeader>>>;

/** The activity log, newest first. Every mutation on a lead writes one. */
export async function getLeadActivity(id: string) {
  const activities = await prisma.leadActivity.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });

  return activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    title: activity.title,
    description: activity.description,
    at: activity.createdAt,
    by: activity.createdBy?.name ?? null,
  }));
}

/**
 * When the lead entered the stage it is in now.
 *
 * Read from the most recent `STATUS_CHANGE` activity rather than from
 * `Lead.updatedAt`, which is what v1's "days in stage" used. `updatedAt` moves
 * when anybody edits a phone number, so it answers "when was this last
 * touched" — a different question, and the one that makes a cold lead look
 * warm the moment somebody fixes a typo on it. A lead that has never changed
 * status has been in its stage since it arrived.
 */
export async function getLeadStageSince(
  id: string,
  createdAt: Date,
  now = new Date(),
) {
  const change = await prisma.leadActivity.findFirst({
    where: { leadId: id, type: "STATUS_CHANGE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const since = change?.createdAt ?? createdAt;
  // Counted here rather than in the card: reading the clock during a render is
  // impure, and the figure belongs beside the date it is measured from.
  return {
    since,
    days: Math.floor((now.getTime() - since.getTime()) / 86_400_000),
  };
}

/**
 * Who a lead can be handed to.
 *
 * VIEWER and FLOW_USER are left out: `assignLead` gates on `requireEditor`, so
 * an owner who cannot then move the lead on is a dead end — the list would
 * stop reading "Unassigned" while nothing had actually been picked up.
 */
export async function getLeadOwners() {
  const users = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN", "STAFF"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return users;
}

/**
 * Orders a lead can be bound to.
 *
 * Binding says "this enquiry is a second contact on business we already have",
 * so only live orders are offered — binding to a completed or canceled one
 * would file the enquiry against something nobody is working. Quote-stage
 * orders count as live: a second person ringing about a quote that is still
 * out is exactly the case this exists for.
 */
const BINDABLE = [...QUOTE_STATUSES, ...OPEN_STATUSES];

export async function getBindCandidates(take = 60) {
  const [orders, total] = await Promise.all([
    prisma.reservation.findMany({
      where: { status: { in: BINDABLE } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        reservationNumber: true,
        projectName: true,
        client: { select: { name: true, companyName: true } },
      },
    }),
    prisma.reservation.count({ where: { status: { in: BINDABLE } } }),
  ]);

  return {
    total,
    rows: orders.map((order) => ({
      id: order.id,
      label: `${order.reservationNumber} · ${order.client.companyName ?? order.client.name}${
        order.projectName ? ` · ${order.projectName}` : ""
      }`,
    })),
  };
}
