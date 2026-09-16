import { cache } from "react";
import type { LeadStatus, ReservationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import { CLOSED_ASK_STATUSES, type Band, type Tier } from "@/lib/tracker/labels";
import {
  CADENCE_SETTING_KEY,
  parseCadence,
  playFor,
  queueReasonsFor,
  temperatureOf,
  tiersOf,
  daysSince,
  type AccountFacts,
  type OpenStep,
  type Play,
  type QueueReason,
  type Temperature,
  type TouchFact,
} from "@/lib/tracker/temperature";
import { orderValues } from "./order-value";

/**
 * Queries behind the Client Tracker (docs/client-tracker.md).
 *
 * The whole tracker is computed in one pass per request and shared through
 * `cache`: a tier is a percentile, so no account's tier can be known without
 * every account's booked value, and the record card and the Tracker page must
 * read the same answer. At 94 accounts that is a handful of queries; if it ever
 * is not, this is the one place to narrow.
 */

/** Booked = approved and beyond, the dashboard's definition (`queries/dashboard`). */
const BOOKED: ReservationStatus[] = [...OPEN_STATUSES, "COMPLETED"];

/**
 * An enquiry is on the tracker only while it has no account. Once it converts
 * or binds, the account's row carries it — and its conversations, which are
 * followed through the lead at read time rather than copied.
 */
const LIVE_LEAD: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "PROSPECT"];

const YEAR = 365 * 86_400_000;
/** Older touches cannot change a band (Dead is a year) — kept out of the load. */
const TOUCH_LOOKBACK = 400 * 86_400_000;

export type TrackerRow = {
  /** `client:<id>` or `lead:<id>`. */
  key: string;
  kind: "client" | "lead";
  id: string;
  name: string;
  company: string | null;
  href: string;
  owner: { id: string; name: string } | null;
  temperature: Temperature;
  band: Band;
  tier: Tier;
  /** Trailing-12-month booked value from the approved package. Zero for a lead. */
  booked: number;
  play: Play;
  /** The earliest open next step, due or not. */
  nextStep: OpenStep | null;
  reasons: QueueReason[];
  /** Days the oldest due item has waited. 0 when due today; null when nothing is due. */
  overdueDays: number | null;
  seasonalMonths: number[];
};

export const getCadence = cache(async () => {
  const row = await prisma.setting.findUnique({ where: { key: CADENCE_SETTING_KEY } });
  return parseCadence(row?.value);
});

export const getTrackerRows = cache(async function getTrackerRows(): Promise<TrackerRow[]> {
  const now = new Date();

  const [clients, leads, interactions, cadence] = await Promise.all([
    prisma.client.findMany({
      select: {
        id: true,
        name: true,
        companyName: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        seasonalMonths: true,
        tempPin: true,
        tempPinReason: true,
        tempPinUntil: true,
        reservations: {
          select: {
            id: true,
            reservationNumber: true,
            status: true,
            reservationType: true,
            isRecurring: true,
            createdAt: true,
            completedAt: true,
            quoteSentAt: true,
            endDate: true,
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: {
        status: { in: LIVE_LEAD },
        convertedToClientId: null,
        boundToClientId: null,
      },
      select: {
        id: true,
        name: true,
        companyName: true,
        createdAt: true,
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.interaction.findMany({
      where: {
        OR: [
          { occurredAt: { gte: new Date(now.getTime() - TOUCH_LOOKBACK) } },
          { nextStepDoneAt: null, nextStepAt: { not: null } },
        ],
      },
      select: {
        id: true,
        clientId: true,
        leadId: true,
        lead: { select: { convertedToClientId: true, boundToClientId: true } },
        occurredAt: true,
        reach: true,
        intent: true,
        nextStep: true,
        nextStepAt: true,
        nextStepDoneAt: true,
        summary: true,
      },
    }),
    getCadence(),
  ]);

  // Every order booked in the last year, valued from its approved package.
  const orderClient = new Map<string, string>();
  const bookedIds: string[] = [];
  for (const client of clients) {
    for (const order of client.reservations) {
      orderClient.set(order.id, client.id);
      if (BOOKED.includes(order.status) && now.getTime() - order.createdAt.getTime() <= YEAR) {
        bookedIds.push(order.id);
      }
    }
  }
  const values = bookedIds.length ? await orderValues({ id: { in: bookedIds } }) : [];
  const booked = new Map<string, number>();
  for (const value of values) {
    const clientId = orderClient.get(value.id)!;
    booked.set(clientId, (booked.get(clientId) ?? 0) + value.total);
  }
  const tiers = tiersOf(booked);

  // Touches and open steps, filed under the account they belong to now.
  const touches = new Map<string, TouchFact[]>();
  const steps = new Map<string, OpenStep[]>();
  for (const row of interactions) {
    const clientId = row.clientId ?? row.lead?.boundToClientId ?? row.lead?.convertedToClientId;
    const key = clientId ? `client:${clientId}` : `lead:${row.leadId}`;
    const list = touches.get(key) ?? [];
    list.push({ occurredAt: row.occurredAt, reach: row.reach, intent: row.intent });
    touches.set(key, list);
    if (row.nextStepAt && !row.nextStepDoneAt && row.nextStep !== "NONE") {
      const open = steps.get(key) ?? [];
      open.push({ id: row.id, at: row.nextStepAt, step: row.nextStep, summary: row.summary });
      steps.set(key, open);
    }
  }

  const finish = (
    base: Omit<TrackerRow, "play" | "nextStep" | "reasons" | "overdueDays" | "band">,
    facts: AccountFacts,
  ): TrackerRow => {
    const openSteps = (steps.get(base.key) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    const reasons = queueReasonsFor({
      facts,
      temperature: base.temperature,
      tier: base.tier,
      cadence,
      openSteps,
      now,
    });
    const overdueDays = reasons.length
      ? Math.max(...reasons.map((reason) => Math.max(0, daysSince(reason.due, now))))
      : null;
    return {
      ...base,
      band: base.temperature.band,
      play: playFor(base.temperature.band, base.tier),
      nextStep: openSteps[0] ?? null,
      reasons,
      overdueDays,
    };
  };

  const rows: TrackerRow[] = clients.map((client) => {
    const key = `client:${client.id}`;
    const facts: AccountFacts = {
      createdAt: client.createdAt,
      orders: client.reservations.map((order) => ({
        id: order.id,
        number: order.reservationNumber,
        status: order.status,
        type: order.reservationType,
        isRecurring: order.isRecurring,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
        quoteSentAt: order.quoteSentAt,
        endDate: order.endDate,
      })),
      touches: touches.get(key) ?? [],
      seasonalMonths: client.seasonalMonths,
      pin:
        client.tempPin && client.tempPinUntil
          ? { band: client.tempPin, reason: client.tempPinReason ?? "", until: client.tempPinUntil }
          : null,
    };
    return finish(
      {
        key,
        kind: "client",
        id: client.id,
        name: client.name,
        company: client.companyName,
        href: `/dashboard/clients/${client.id}`,
        owner: client.owner,
        temperature: temperatureOf(facts, now),
        tier: tiers.get(client.id) ?? "C",
        booked: booked.get(client.id) ?? 0,
        seasonalMonths: client.seasonalMonths,
      },
      facts,
    );
  });

  for (const lead of leads) {
    const key = `lead:${lead.id}`;
    const facts: AccountFacts = {
      createdAt: lead.createdAt,
      orders: [],
      touches: touches.get(key) ?? [],
      seasonalMonths: [],
      pin: null,
    };
    const underlying = temperatureOf(facts, now);
    rows.push(
      finish(
        {
          key,
          kind: "lead",
          id: lead.id,
          name: lead.name,
          company: lead.companyName,
          href: `/dashboard/leads/${lead.id}`,
          owner: lead.assignedTo,
          temperature: { ...underlying, band: "PROSPECT", reason: "Open enquiry, no account yet" },
          tier: "C",
          booked: 0,
          seasonalMonths: [],
        },
        facts,
      ),
    );
  }

  return rows.sort(compareRows);
});

/** Matrix cell first, then how long it has waited, then what the account is worth. */
function compareRows(a: TrackerRow, b: TrackerRow): number {
  return (
    a.play.rank - b.play.rank ||
    (b.overdueDays ?? -1) - (a.overdueDays ?? -1) ||
    b.booked - a.booked ||
    a.name.localeCompare(b.name)
  );
}

export async function getTrackerRow(kind: "client" | "lead", id: string) {
  const rows = await getTrackerRows();
  return rows.find((row) => row.key === `${kind}:${id}`) ?? null;
}

/* ── The record cards ───────────────────────────────────────────────────── */

/**
 * Where an account's conversations live: on the account itself, or on any lead
 * that became it. Followed at read time, so no conversion path has to remember
 * to move anything.
 */
export function accountWhere(target: { clientId: string } | { leadId: string }) {
  if ("leadId" in target) return { leadId: target.leadId };
  return {
    OR: [
      { clientId: target.clientId },
      { lead: { convertedToClientId: target.clientId } },
      { lead: { boundToClientId: target.clientId } },
    ],
  };
}

export async function getConversations(
  target: { clientId: string } | { leadId: string },
  take = 30,
) {
  const where = accountWhere(target);
  const [rows, total, asks] = await Promise.all([
    prisma.interaction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take,
      select: {
        id: true,
        business: true,
        channel: true,
        direction: true,
        reach: true,
        intent: true,
        nextStep: true,
        nextStepAt: true,
        nextStepDoneAt: true,
        summary: true,
        notes: true,
        occurredAt: true,
        leadId: true,
        contact: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.interaction.count({ where }),
    prisma.clientAsk.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        business: true,
        category: true,
        description: true,
        quantity: true,
        status: true,
        lostReason: true,
        closedAt: true,
        createdAt: true,
      },
    }),
  ]);

  // Open asks first — what is still in play matters more than what was settled.
  const open = asks.filter((ask) => !CLOSED_ASK_STATUSES.includes(ask.status));
  const closed = asks.filter((ask) => CLOSED_ASK_STATUSES.includes(ask.status));

  return { rows, total, asks: [...open, ...closed], openAsks: open.length };
}

export type ConversationRow = Awaited<ReturnType<typeof getConversations>>["rows"][number];
export type AskRow = Awaited<ReturnType<typeof getConversations>>["asks"][number];

/** People at the account a conversation can be logged against. */
export async function getContactOptions(clientId: string) {
  return prisma.clientContact.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/* ── Conversion suggestions ─────────────────────────────────────────────── */

/** How far back a conversation may be and still have led to an order. */
export const CONVERSION_LOOKBACK_DAYS = 45;

/**
 * What an order might be the answer to (docs/client-tracker.md, "Conversion").
 *
 * Derived on read rather than raised when the order is created: an order can be
 * made in six places, and a suggestion computed here reaches every one of them
 * without touching any. Offered: the account's open or quoted asks that no
 * order answers yet, and its Prospecting-or-better conversations from the 45
 * days before the order was created (or since) that no order is linked to.
 * Nothing is linked until somebody confirms it.
 */
export async function getConversionCandidates(reservationId: string) {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, clientId: true, createdAt: true, status: true },
  });
  if (!order) return null;

  const scope = accountWhere({ clientId: order.clientId });
  const since = new Date(order.createdAt.getTime() - CONVERSION_LOOKBACK_DAYS * 86_400_000);
  const closed = order.status === "LOST" || order.status === "CANCELLED";

  const [asks, conversations, linkedAsks, linkedConversations] = await Promise.all([
    closed
      ? []
      : prisma.clientAsk.findMany({
          where: { AND: [scope, { reservationId: null, status: { in: ["OPEN", "QUOTED"] } }] },
          orderBy: { createdAt: "desc" },
          select: { id: true, business: true, category: true, description: true, quantity: true, status: true },
        }),
    closed
      ? []
      : prisma.interaction.findMany({
          where: {
            AND: [
              scope,
              {
                reservationId: null,
                reach: "CONNECTED",
                intent: { in: ["PROSPECTING", "READY_TO_BUY"] },
                occurredAt: { gte: since },
              },
            ],
          },
          orderBy: { occurredAt: "desc" },
          select: { id: true, business: true, intent: true, summary: true, occurredAt: true },
        }),
    prisma.clientAsk.findMany({
      where: { reservationId },
      select: { id: true, category: true, description: true, quantity: true, status: true },
    }),
    prisma.interaction.findMany({
      where: { reservationId },
      select: { id: true, intent: true, summary: true, occurredAt: true },
    }),
  ]);

  return { order, closed, asks, conversations, linkedAsks, linkedConversations };
}

