"use server";

import { revalidatePath } from "next/cache";
import type {
  AskCategory,
  AskStatus,
  Business,
  InteractionChannel,
  InteractionDirection,
  InteractionIntent,
  InteractionReach,
  NextStepKind,
  TemperatureBand,
} from "@/generated/prisma/client";
import { isAdmin } from "@/lib/auth";
import { requireAdmin, requireEditor } from "@/lib/auth-utils";
import { oneOf } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import {
  ASK_CATEGORIES,
  ASK_STATUSES,
  BUSINESSES,
  CHANNELS,
  CLOSED_ASK_STATUSES,
  DIRECTIONS,
  INTENTS,
  NEXT_STEPS,
  PIN_BANDS,
  REACHES,
} from "@/lib/tracker/labels";
import { logAudit } from "./audit";

/**
 * The Client Tracker's writes (docs/client-tracker.md).
 *
 * Every export here is a callable Server Function the moment a client component
 * imports this module, so every one checks the role itself — the lesson of
 * `agreement.ts`, which shipped with none. SUPER_ADMIN, ADMIN and STAFF write
 * (`requireEditor`); VIEWER reads. Seasonal months are ADMIN only. Nothing that
 * is not an action lives in this file.
 *
 * Each returns a result rather than throwing, so a form can say what was wrong
 * without an unhandled rejection leaving it stuck busy.
 */

export type TrackerResult = { ok: true } | { ok: false; error: string };

const isBusiness = oneOf<Business>(BUSINESSES);
const isChannel = oneOf<InteractionChannel>(CHANNELS);
const isDirection = oneOf<InteractionDirection>(DIRECTIONS);
const isReach = oneOf<InteractionReach>(REACHES);
const isIntent = oneOf<InteractionIntent>(INTENTS);
const isNextStep = oneOf<NextStepKind>(NEXT_STEPS);
const isCategory = oneOf<AskCategory>(ASK_CATEGORIES);
const isAskStatus = oneOf<AskStatus>(ASK_STATUSES);
const isPinBand = oneOf<TemperatureBand>(PIN_BANDS);

const DAY = 86_400_000;
/** STAFF may pin for at most this long; an administrator for a year. */
const STAFF_PIN_DAYS = 90;
const ADMIN_PIN_DAYS = 365;

/**
 * A `YYYY-MM-DD` from a date input, as local midnight.
 *
 * Local, not UTC: the box runs America/Los_Angeles, and `new Date("2026-09-14")`
 * is UTC midnight — the evening of the 13th here. That seam already buckets 35
 * order start dates a day early elsewhere in this app; a follow-up date is not
 * going to join them.
 */
function localDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function revalidateAccount(target: { clientId?: string | null; leadId?: string | null }) {
  if (target.clientId) revalidatePath(`/dashboard/clients/${target.clientId}`);
  if (target.leadId) revalidatePath(`/dashboard/leads/${target.leadId}`);
  revalidatePath("/dashboard/clients/tracker");
}

/** The account a client or lead id names, confirmed to exist. */
async function resolveTarget(clientId: unknown, leadId: unknown) {
  if (typeof clientId === "string" && clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    return client ? { clientId: client.id, leadId: null } : null;
  }
  if (typeof leadId === "string" && leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, convertedToClientId: true, boundToClientId: true },
    });
    return lead ? { clientId: null, leadId: lead.id, accountId: lead.boundToClientId ?? lead.convertedToClientId } : null;
  }
  return null;
}

/* ── Conversations ──────────────────────────────────────────────────────── */

export type LogInteractionInput = {
  clientId?: string;
  leadId?: string;
  contactId?: string;
  business: string;
  channel: string;
  direction: string;
  reach: string;
  intent?: string;
  nextStep: string;
  /** `YYYY-MM-DD`. */
  nextStepOn?: string;
  /** `YYYY-MM-DD`; today when omitted. */
  occurredOn?: string;
  summary: string;
  notes?: string;
  /** Required when a NO_GO closes open asks. */
  closeReason?: string;
};

/**
 * Log one conversation or attempt.
 *
 * The rules the grading table sets are enforced here, not only in the form:
 * a connected conversation must be graded; an unanswered attempt must not be,
 * and needs a retry date; NOT_NOW needs a revisit date; a NO_GO closes the
 * account's open asks as Lost and so needs the reason.
 *
 * Logging a conversation also closes the record's earlier open next steps for
 * the same business — the follow-up they asked for is this.
 */
export async function logInteraction(input: LogInteractionInput): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const target = await resolveTarget(input.clientId, input.leadId);
  if (!target) return { ok: false, error: "That account or lead no longer exists." };

  if (!isBusiness(input.business)) return { ok: false, error: "Choose VFXNow or GPL." };
  if (!isChannel(input.channel)) return { ok: false, error: "Choose how you spoke." };
  if (!isDirection(input.direction)) return { ok: false, error: "Choose who reached out." };
  if (!isReach(input.reach)) return { ok: false, error: "Say whether you reached them." };
  if (!isNextStep(input.nextStep)) return { ok: false, error: "Choose a next step." };

  const summary = text(input.summary, 200);
  if (!summary) return { ok: false, error: "Add a one-line summary." };
  const notes = text(input.notes, 5000) || null;

  const connected = input.reach === "CONNECTED";
  const intent = connected && isIntent(input.intent) ? input.intent : null;
  if (connected && !intent) return { ok: false, error: "Grade the conversation — how interested are they?" };
  if (!connected && input.intent) {
    return { ok: false, error: "An unanswered attempt has nobody to grade. Clear the intent." };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const occurredDay = input.occurredOn ? localDay(input.occurredOn) : today;
  if (!occurredDay) return { ok: false, error: "That date isn't valid." };
  if (occurredDay > today) return { ok: false, error: "A conversation can't have happened in the future." };
  // Today's conversation keeps its real time, so two logged today still sort.
  const occurredAt = occurredDay.getTime() === today.getTime() ? new Date() : occurredDay;

  const nextStep = input.nextStep;
  const nextStepAt = nextStep === "NONE" ? null : localDay(input.nextStepOn);
  if (nextStep !== "NONE" && !nextStepAt) return { ok: false, error: "Give the next step a date." };
  if (!connected && nextStep === "NONE") return { ok: false, error: "Nobody answered — set a retry date." };
  if (intent === "NOT_NOW" && nextStep === "NONE") {
    return { ok: false, error: "Not now needs a revisit date." };
  }

  let contactId: string | null = null;
  if (input.contactId) {
    const contact = target.clientId
      ? await prisma.clientContact.findFirst({
          where: { id: input.contactId, clientId: target.clientId },
          select: { id: true },
        })
      : null;
    if (!contact) return { ok: false, error: "That contact isn't on this account." };
    contactId = contact.id;
  }

  const askScope = target.clientId
    ? {
        OR: [
          { clientId: target.clientId },
          { lead: { convertedToClientId: target.clientId } },
          { lead: { boundToClientId: target.clientId } },
        ],
      }
    : { leadId: target.leadId! };
  const closeReason = text(input.closeReason, 500);
  if (intent === "NO_GO") {
    const open = await prisma.clientAsk.count({
      where: { AND: [askScope, { status: { notIn: CLOSED_ASK_STATUSES } }] },
    });
    if (open > 0 && !closeReason) {
      return {
        ok: false,
        error: `A no-go closes ${open} open ${open === 1 ? "ask" : "asks"} as lost — say why.`,
      };
    }
  }

  const business = input.business;
  const now = new Date();
  await prisma.$transaction([
    prisma.interaction.updateMany({
      where: {
        clientId: target.clientId,
        leadId: target.clientId ? undefined : target.leadId,
        business,
        nextStepDoneAt: null,
        nextStepAt: { not: null },
      },
      data: { nextStepDoneAt: now },
    }),
    prisma.interaction.create({
      data: {
        clientId: target.clientId,
        leadId: target.leadId,
        contactId,
        business,
        channel: input.channel,
        direction: input.direction,
        reach: input.reach,
        intent,
        nextStep,
        nextStepAt,
        summary,
        notes,
        occurredAt,
        createdById: auth.userId,
      },
    }),
    ...(intent === "NO_GO" && closeReason
      ? [
          prisma.clientAsk.updateMany({
            where: { AND: [askScope, { status: { notIn: CLOSED_ASK_STATUSES } }] },
            data: { status: "LOST" as const, lostReason: closeReason, closedAt: now },
          }),
        ]
      : []),
  ]);

  revalidateAccount({ clientId: target.clientId ?? ("accountId" in target ? target.accountId : null), leadId: target.leadId });
  return { ok: true };
}

/** Mark a next step done without logging a conversation — it happened elsewhere. */
export async function completeNextStep(interactionId: string): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const row = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { id: true, clientId: true, leadId: true, nextStepDoneAt: true },
  });
  if (!row) return { ok: false, error: "That conversation no longer exists." };
  if (!row.nextStepDoneAt) {
    await prisma.interaction.update({ where: { id: row.id }, data: { nextStepDoneAt: new Date() } });
  }
  revalidateAccount(row);
  return { ok: true };
}

/* ── Asks ───────────────────────────────────────────────────────────────── */

export type CreateAskInput = {
  clientId?: string;
  leadId?: string;
  business: string;
  category: string;
  description: string;
  quantity?: number | null;
};

export async function createAsk(input: CreateAskInput): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const target = await resolveTarget(input.clientId, input.leadId);
  if (!target) return { ok: false, error: "That account or lead no longer exists." };
  if (!isBusiness(input.business)) return { ok: false, error: "Choose VFXNow or GPL." };
  if (!isCategory(input.category)) return { ok: false, error: "Choose what kind of thing they asked for." };

  const description = text(input.description, 500);
  if (!description) return { ok: false, error: "Say what they asked for." };
  const quantity =
    input.quantity === null || input.quantity === undefined ? null : Math.trunc(Number(input.quantity));
  if (quantity !== null && (!Number.isFinite(quantity) || quantity < 1 || quantity > 100_000)) {
    return { ok: false, error: "Quantity should be a whole number, or left blank." };
  }

  await prisma.clientAsk.create({
    data: {
      clientId: target.clientId,
      leadId: target.leadId,
      business: input.business,
      category: input.category,
      description,
      quantity,
      createdById: auth.userId,
    },
  });

  revalidateAccount({ clientId: target.clientId ?? ("accountId" in target ? target.accountId : null), leadId: target.leadId });
  return { ok: true };
}

/**
 * Move an ask. Lost needs a reason, because "why didn't we win it" is the only
 * part of a lost ask anybody will come back for. A closed status stamps
 * `closedAt`; reopening clears it and the reason.
 */
export async function setAskStatus(
  askId: string,
  status: string,
  lostReason?: string,
): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };
  if (!isAskStatus(status)) return { ok: false, error: "That isn't a status an ask can have." };

  const ask = await prisma.clientAsk.findUnique({
    where: { id: askId },
    select: { id: true, clientId: true, leadId: true, status: true },
  });
  if (!ask) return { ok: false, error: "That ask no longer exists." };

  const reason = text(lostReason, 500);
  if (status === "LOST" && !reason) return { ok: false, error: "Say why it was lost." };

  const closed = CLOSED_ASK_STATUSES.includes(status);
  await prisma.clientAsk.update({
    where: { id: ask.id },
    data: {
      status,
      lostReason: status === "LOST" ? reason : null,
      closedAt: closed ? new Date() : null,
    },
  });

  revalidateAccount(ask);
  return { ok: true };
}

/* ── Ownership, pins and seasons ────────────────────────────────────────── */

/**
 * Hand an account to a rep, or back to the pool. Only someone who can work the
 * account can own it — an owner who cannot log a call is a dead end, the same
 * reasoning `getLeadOwners` records.
 */
export async function setClientOwner(clientId: string, userId: string | null): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, ownerId: true },
  });
  if (!client) return { ok: false, error: "That account no longer exists." };

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !["SUPER_ADMIN", "ADMIN", "STAFF"].includes(user.role)) {
      return { ok: false, error: "That person can't work accounts." };
    }
  }
  if (client.ownerId === userId) return { ok: true };

  await prisma.client.update({ where: { id: client.id }, data: { ownerId: userId } });
  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: client.id,
    oldValues: { ownerId: client.ownerId },
    newValues: { ownerId: userId },
    userId: auth.userId,
  });

  revalidateAccount({ clientId: client.id });
  return { ok: true };
}

/**
 * Pin an account's band until a date. A pin always carries a reason and an
 * expiry — an override nobody can explain, or that never lapses, is how a
 * derived band quietly becomes a stored one again.
 */
export async function pinTemperature(input: {
  clientId: string;
  band: string;
  reason: string;
  /** `YYYY-MM-DD`, the last day the pin holds. */
  until: string;
}): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };
  if (!isPinBand(input.band)) return { ok: false, error: "Choose a band to pin." };

  const reason = text(input.reason, 300);
  if (!reason) return { ok: false, error: "A pin needs a reason." };

  const day = localDay(input.until);
  if (!day) return { ok: false, error: "Choose the date the pin ends." };
  // The pin holds through the whole of its last day.
  const until = new Date(day.getTime() + DAY - 1);
  const limit = isAdmin(auth.role) ? ADMIN_PIN_DAYS : STAFF_PIN_DAYS;
  if (until.getTime() <= Date.now()) return { ok: false, error: "The end date has already passed." };
  if (until.getTime() - Date.now() > (limit + 1) * DAY) {
    return { ok: false, error: `A pin can last at most ${limit} days.` };
  }

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, tempPin: true, tempPinReason: true, tempPinUntil: true },
  });
  if (!client) return { ok: false, error: "That account no longer exists." };

  await prisma.client.update({
    where: { id: client.id },
    data: { tempPin: input.band, tempPinReason: reason, tempPinUntil: until, tempPinById: auth.userId },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: client.id,
    oldValues: { tempPin: client.tempPin, tempPinReason: client.tempPinReason, tempPinUntil: client.tempPinUntil },
    newValues: { tempPin: input.band, tempPinReason: reason, tempPinUntil: until },
    userId: auth.userId,
  });

  revalidateAccount({ clientId: client.id });
  return { ok: true };
}

export async function clearTemperaturePin(clientId: string): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, tempPin: true, tempPinReason: true, tempPinUntil: true },
  });
  if (!client) return { ok: false, error: "That account no longer exists." };

  await prisma.client.update({
    where: { id: client.id },
    data: { tempPin: null, tempPinReason: null, tempPinUntil: null, tempPinById: null },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: client.id,
    oldValues: { tempPin: client.tempPin, tempPinReason: client.tempPinReason, tempPinUntil: client.tempPinUntil },
    newValues: { tempPin: null },
    userId: auth.userId,
  });

  revalidateAccount({ clientId: client.id });
  return { ok: true };
}

/** The usual booking months. Administrators only — it changes how an account is chased all year. */
export async function setSeasonalMonths(clientId: string, months: number[]): Promise<TrackerResult> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, error: auth.error };

  if (!Array.isArray(months) || months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
    return { ok: false, error: "Months must be 1 to 12." };
  }
  const clean = [...new Set(months)].sort((a, b) => a - b);
  if (clean.length === 12) {
    return { ok: false, error: "An account that books all year isn't seasonal — clear the months instead." };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, seasonalMonths: true },
  });
  if (!client) return { ok: false, error: "That account no longer exists." };

  await prisma.client.update({ where: { id: client.id }, data: { seasonalMonths: clean } });
  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: client.id,
    oldValues: { seasonalMonths: client.seasonalMonths },
    newValues: { seasonalMonths: clean },
    userId: auth.userId,
  });

  revalidateAccount({ clientId: client.id });
  return { ok: true };
}

/* ── Conversion ─────────────────────────────────────────────────────────── */

/**
 * Link asks and conversations to the order that answered them — only ever on a
 * person's confirmation (docs/client-tracker.md, "Conversion").
 *
 * An ask becomes WON with the order; a conversation records the order it led
 * to. Every id is checked against the order's own account, including the leads
 * that became it, so a crafted call cannot mark another client's ask as won.
 * Something already linked elsewhere is refused rather than moved.
 */
export async function linkToOrder(input: {
  reservationId: string;
  askIds: string[];
  interactionIds: string[];
}): Promise<TrackerResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error };

  const askIds = Array.isArray(input.askIds) ? [...new Set(input.askIds.filter((id) => typeof id === "string"))] : [];
  const interactionIds = Array.isArray(input.interactionIds)
    ? [...new Set(input.interactionIds.filter((id) => typeof id === "string"))]
    : [];
  if (askIds.length === 0 && interactionIds.length === 0) {
    return { ok: false, error: "Choose at least one thing to link." };
  }

  const order = await prisma.reservation.findUnique({
    where: { id: input.reservationId },
    select: { id: true, clientId: true, status: true },
  });
  if (!order) return { ok: false, error: "That order no longer exists." };
  if (order.status === "LOST" || order.status === "CANCELLED") {
    return { ok: false, error: "A lost or canceled order can't be what answered an ask." };
  }

  const scope = {
    OR: [
      { clientId: order.clientId },
      { lead: { convertedToClientId: order.clientId } },
      { lead: { boundToClientId: order.clientId } },
    ],
  };
  const [asks, interactions] = await Promise.all([
    askIds.length
      ? prisma.clientAsk.findMany({
          where: { AND: [scope, { id: { in: askIds }, reservationId: null }] },
          select: { id: true },
        })
      : [],
    interactionIds.length
      ? prisma.interaction.findMany({
          where: { AND: [scope, { id: { in: interactionIds }, reservationId: null }] },
          select: { id: true },
        })
      : [],
  ]);
  if (asks.length !== askIds.length || interactions.length !== interactionIds.length) {
    return { ok: false, error: "Something here belongs to another account or is already linked. Reload and try again." };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.clientAsk.updateMany({
      where: { id: { in: askIds } },
      data: { reservationId: order.id, status: "WON", closedAt: now, lostReason: null },
    }),
    prisma.interaction.updateMany({
      where: { id: { in: interactionIds } },
      data: { reservationId: order.id },
    }),
  ]);

  revalidatePath(`/dashboard/orders/${order.id}`);
  revalidateAccount({ clientId: order.clientId });
  return { ok: true };
}

