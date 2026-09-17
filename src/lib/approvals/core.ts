import { prisma } from "@/lib/prisma";
import type {
  ApprovalRecordType,
  ApprovalRequest,
  UserRole,
} from "@/generated/prisma/client";
import { APP_URL, isEmailConfigured } from "@/lib/email/client";
import { sendBatch } from "@/lib/email/send";
import { getAllNotificationPreferences } from "@/lib/notifications/preferences";
import {
  approvalDecidedEmail,
  approvalRequestedEmail,
  type ApprovalEmailFact,
} from "@/lib/email/templates";
import { dayYear, moneyExact } from "@/lib/format";
import {
  APPROVAL_TYPE_NOUN,
  APPROVAL_TYPE_RELEASES,
  APPROVAL_TYPES,
  SCOPABLE_ROLES,
} from "@/lib/approvals/labels";

/**
 * Approvals — the one mechanism (docs/procurement.md, Phase 6).
 *
 * A purchase order, a funding request and a client quote are each *released*
 * at one moment: the PO goes to the vendor, the request is approved to spend,
 * the quote goes to the client. Everything here hangs off that moment.
 *
 * - **Cleared** means the record's latest approval is APPROVED *at the amount
 *   the record carries now*. The comparison is the whole of "editing an approved
 *   record in a way that changes money sends it back": a total that moved is not
 *   the total anybody approved, whichever write path moved it. The edit screens
 *   raise the new request straight away (so approvers hear of it); the gate is
 *   what makes it true for the write paths that don't.
 * - **The gate** sits in the transition itself, in the lowest function that
 *   performs it — the ported `"use server"` actions — because every one of those
 *   is reachable by a direct POST whatever the screen shows. The screens call it
 *   first too, with `raise`, so a person pressing Submit gets "held, and here is
 *   who was asked" rather than a refusal.
 * - **An approver's own act goes straight through.** It is recorded as an
 *   `automatic` APPROVED row with them as both requester and decider, so the
 *   trail still says who put the money through and at what figure, and nobody
 *   mistakes it for a second person's sign-off. It is not "approving your own":
 *   nobody else's request is involved, and the queue never shows it.
 * - **Records that pre-date this** carry no history. A record that has not yet
 *   been released is judged when it is (`always`); one released before approvals
 *   existed is left alone at the later steps (receiving, marking funded,
 *   committing an order) until something raises a request against it.
 *
 * This is a plain server module, not a `"use server"` file: nothing in it may be
 * called from a browser on its own. `lib/approvals/actions.ts` is the surface.
 */

export type Actor = { id: string; role: UserRole; name: string };

/** The signed-in user as the mechanism needs them — names are snapshotted onto rows. */
export async function actorFor(userId: string, role: UserRole): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return { id: userId, role, name: user?.name || user?.email || "Unknown user" };
}

const cents = (value: number) => Math.round(value * 100);
export const sameMoney = (a: number, b: number) => cents(a) === cents(b);

function sentence(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Who approves
// ---------------------------------------------------------------------------

/**
 * The record types this person may decide. SUPER_ADMIN is every type without a
 * row; ADMIN and STAFF only what the owner tagged; anyone else nothing, even if
 * a row somehow exists for them.
 */
export async function approverTypesFor(
  userId: string,
  role: UserRole,
): Promise<ApprovalRecordType[]> {
  if (role === "SUPER_ADMIN") return [...APPROVAL_TYPES];
  if (!(SCOPABLE_ROLES as string[]).includes(role)) return [];
  const rows = await prisma.userApprovalScope.findMany({
    where: { userId },
    select: { recordType: true },
  });
  return APPROVAL_TYPES.filter((type) => rows.some((row) => row.recordType === type));
}

export async function isApprover(
  actor: { id: string; role: UserRole },
  type: ApprovalRecordType,
): Promise<boolean> {
  return (await approverTypesFor(actor.id, actor.role)).includes(type);
}

/** Everyone who could decide a request of this type, bar the person who asked. */
export async function approversFor(type: ApprovalRecordType, except?: string | null) {
  return prisma.user.findMany({
    where: {
      id: except ? { not: except } : undefined,
      OR: [
        { role: "SUPER_ADMIN" },
        {
          role: { in: SCOPABLE_ROLES as UserRole[] },
          approvalScopes: { some: { recordType: type } },
        },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// The record, as an approver needs to see it
// ---------------------------------------------------------------------------

export type RecordBrief = {
  type: ApprovalRecordType;
  id: string;
  label: string;
  href: string;
  /** The figure an approval is given at: PO total, amount requested, order total. */
  amount: number;
  party: ApprovalEmailFact | null;
  facts: ApprovalEmailFact[];
  lines: string[];
  why: string | null;
  /** Nothing further will happen to it, so there is nothing to approve. */
  closed: boolean;
  closedAs: string;
  /** Past the moment it goes out — for records with no approval history. */
  released: boolean;
  raisedById: string | null;
};

const LINE_LIMIT = 12;

function lineList<T>(rows: T[], format: (row: T) => string): string[] {
  const shown = rows.slice(0, LINE_LIMIT).map(format);
  if (rows.length > LINE_LIMIT) shown.push(`…and ${rows.length - LINE_LIMIT} more`);
  return shown;
}

export async function briefFor(
  type: ApprovalRecordType,
  id: string,
): Promise<RecordBrief | null> {
  if (type === "PURCHASE_ORDER") {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        poNumber: true,
        status: true,
        total: true,
        notes: true,
        orderDate: true,
        expectedDate: true,
        raisedById: true,
        vendor: { select: { name: true } },
        items: { select: { description: true, quantity: true, unitPrice: true } },
        fundingRequests: { select: { requestNumber: true } },
      },
    });
    if (!po) return null;
    const facts: ApprovalEmailFact[] = [{ label: "Ordered", value: dayYear(po.orderDate) }];
    if (po.expectedDate) facts.push({ label: "Expected", value: dayYear(po.expectedDate) });
    if (po.fundingRequests.length) {
      facts.push({
        label: "Funding request",
        value: po.fundingRequests.map((r) => r.requestNumber).join(", "),
      });
    }
    return {
      type,
      id,
      label: po.poNumber,
      href: `/dashboard/purchase-orders/${id}`,
      amount: Number(po.total),
      party: { label: "Vendor", value: po.vendor.name },
      facts,
      lines: lineList(
        po.items,
        (item) => `${item.quantity} × ${item.description} @ ${moneyExact(Number(item.unitPrice))}`,
      ),
      why: po.notes,
      closed: po.status === "CANCELLED",
      closedAs: "canceled",
      released: po.status !== "DRAFT" && po.status !== "CANCELLED",
      raisedById: po.raisedById,
    };
  }

  if (type === "FUNDING_REQUEST") {
    const request = await prisma.fundingRequest.findUnique({
      where: { id },
      select: {
        requestNumber: true,
        status: true,
        amountRequested: true,
        businessPurpose: true,
        equipmentSummary: true,
        projectName: true,
        lender: true,
        neededByDate: true,
        requestedById: true,
        client: { select: { name: true } },
        items: {
          select: { description: true, quantity: true, unitCost: true },
          orderBy: { sortOrder: "asc" },
        },
        purchaseOrders: { select: { poNumber: true } },
      },
    });
    if (!request) return null;
    const facts: ApprovalEmailFact[] = [];
    if (request.neededByDate) facts.push({ label: "Needed by", value: dayYear(request.neededByDate) });
    if (request.lender) facts.push({ label: "Lender", value: request.lender });
    if (request.purchaseOrders.length) {
      facts.push({
        label: "Purchase orders",
        value: request.purchaseOrders.map((po) => po.poNumber).join(", "),
      });
    }
    const why = [request.businessPurpose, request.equipmentSummary].filter(Boolean).join("\n\n");
    return {
      type,
      id,
      label: request.requestNumber,
      href: `/dashboard/funding/${id}`,
      amount: Number(request.amountRequested),
      party: {
        label: "For",
        value: request.client?.name ?? request.projectName ?? "General inventory",
      },
      facts,
      lines: lineList(
        request.items,
        (item) => `${item.quantity} × ${item.description} @ ${moneyExact(Number(item.unitCost))}`,
      ),
      why: why || null,
      closed: request.status === "CANCELLED" || request.status === "FULFILLED",
      closedAs: request.status === "CANCELLED" ? "canceled" : "fulfilled",
      released: ["APPROVED", "FUNDED", "FULFILLED"].includes(request.status),
      raisedById: request.requestedById,
    };
  }

  const order = await prisma.reservation.findUnique({
    where: { id },
    select: {
      reservationNumber: true,
      status: true,
      total: true,
      startDate: true,
      endDate: true,
      projectName: true,
      notes: true,
      createdById: true,
      client: { select: { name: true, companyName: true } },
      items: {
        where: { includedInParent: false },
        select: { description: true, quantity: true, subtotal: true, asset: { select: { name: true } } },
      },
    },
  });
  if (!order) return null;
  return {
    type,
    id,
    label: order.reservationNumber,
    href: `/dashboard/orders/${id}`,
    amount: Number(order.total),
    party: { label: "Client", value: order.client.companyName || order.client.name },
    facts: [
      { label: "Window", value: `${dayYear(order.startDate)} – ${dayYear(order.endDate)}` },
      ...(order.projectName ? [{ label: "Project", value: order.projectName }] : []),
    ],
    lines: lineList(
      order.items,
      (item) =>
        `${item.quantity} × ${item.asset?.name ?? item.description ?? "Line"} — ${moneyExact(Number(item.subtotal))}`,
    ),
    why: order.notes,
    closed: ["CANCELLED", "LOST", "COMPLETED"].includes(order.status),
    closedAs: order.status.toLowerCase(),
    released: order.status !== "DRAFT" && order.status !== "REVISION",
    raisedById: order.createdById,
  };
}

// ---------------------------------------------------------------------------
// Where a record stands
// ---------------------------------------------------------------------------

export async function historyFor(type: ApprovalRecordType, id: string) {
  return prisma.approvalRequest.findMany({
    where: { recordType: type, recordId: id },
    orderBy: { requestedAt: "desc" },
  });
}

export type Standing =
  | { kind: "none" }
  | { kind: "pending"; request: ApprovalRequest }
  | { kind: "approved"; request: ApprovalRequest; matches: boolean }
  | { kind: "denied"; request: ApprovalRequest };

/** The latest request that was not replaced, read against today's amount. */
export function standingOf(history: ApprovalRequest[], amount: number): Standing {
  const latest = history.find((row) => row.status !== "SUPERSEDED");
  if (!latest) return { kind: "none" };
  if (latest.status === "PENDING") return { kind: "pending", request: latest };
  if (latest.status === "DENIED") return { kind: "denied", request: latest };
  return {
    kind: "approved",
    request: latest,
    matches: sameMoney(Number(latest.amountAtDecision ?? latest.amountAtRequest), amount),
  };
}

// ---------------------------------------------------------------------------
// Notifying
// ---------------------------------------------------------------------------

export type NotifyReport = { names: string[]; emailed: boolean; emailError?: string };

/** One sentence for the person who pressed the button. */
export function describeReport(report: NotifyReport): string {
  if (report.names.length === 0) {
    return "Nobody can decide it yet — there is no other approver for this. A super admin tags approvers in Settings → Users.";
  }
  const named = listNames(report.names);
  if (report.emailed) return `${named} ${report.names.length === 1 ? "was" : "were"} told in the app and by email (except anyone who has approval email switched off).`;
  if (isEmailConfigured() && !report.emailError) {
    return `${named} ${report.names.length === 1 ? "was" : "were"} told in the app. Nobody was emailed: approval email is switched off in ${report.names.length === 1 ? "their" : "each of their"} notification preferences.`;
  }
  return `${named} ${report.names.length === 1 ? "was" : "were"} told in the app. Email is ${
    isEmailConfigured() ? `failing here (${report.emailError ?? "unknown error"})` : "switched off on this instance"
  }, so nobody was emailed — this is who would have been.`;
}

/**
 * The people who haven't switched off email for approvals.
 *
 * An approval ask is emailed straight away rather than waiting for the digest,
 * so it doesn't depend on the digest opt-in — but a person who has unticked
 * "Approvals waiting on you" under Email in their preferences has said they
 * don't want it by mail, and that holds here. They are still told in the app,
 * and Procurement → Approvals still lists what waits on them.
 */
async function wantsApprovalEmail(userIds: string[]): Promise<Set<string>> {
  const preferences = await getAllNotificationPreferences();
  return new Set(userIds.filter((id) => preferences.get(id)?.types.APPROVAL_REQUEST.email !== false));
}

async function sendAll(
  messages: { to: string; subject: string; html: string; text?: string }[],
): Promise<Pick<NotifyReport, "emailed" | "emailError">> {
  if (messages.length === 0) return { emailed: false };
  const result = await sendBatch(messages);
  return { emailed: result.success, emailError: result.error };
}

export async function notifyApprovers(
  request: ApprovalRequest,
  brief: RecordBrief,
): Promise<NotifyReport> {
  const approvers = await approversFor(request.recordType, request.requestedById);
  if (approvers.length === 0) return { names: [], emailed: false };

  const amount = moneyExact(Number(request.amountAtRequest));
  const noun = APPROVAL_TYPE_NOUN[request.recordType];

  await prisma.notification.createMany({
    data: approvers.map((user) => ({
      userId: user.id,
      type: "APPROVAL_REQUEST" as const,
      title: `Approval waiting · ${brief.label}`,
      message: `${request.requestedByName} asks for a yes on ${brief.label}${
        brief.party ? ` (${brief.party.value})` : ""
      } at ${amount}.${request.note ? ` ${request.note}.` : ""}`,
      link: brief.href,
    })),
  });

  const emailable = await wantsApprovalEmail(approvers.map((user) => user.id));
  const sent = await sendAll(
    approvers.filter((user) => emailable.has(user.id)).map((user) => {
      const template = approvalRequestedEmail({
        recipientName: user.name,
        noun,
        recordLabel: brief.label,
        party: brief.party,
        amount,
        requestedBy: request.requestedByName,
        note: request.note,
        why: brief.why,
        facts: brief.facts,
        lines: brief.lines,
        releases: APPROVAL_TYPE_RELEASES[request.recordType],
        url: `${APP_URL}${brief.href}`,
      });
      return { to: user.email, subject: template.subject, html: template.html, text: template.text };
    }),
  );

  return { names: approvers.map((user) => user.name), ...sent };
}

const NEXT_STEP: Record<ApprovalRecordType, { approved: string; denied: string }> = {
  PURCHASE_ORDER: {
    approved: "It can be submitted to the vendor from the record now.",
    denied: "It stays a draft. Change what the reason asks for and submit it again, which asks again.",
  },
  FUNDING_REQUEST: {
    approved: "The request is approved and can be funded against a loan.",
    denied: "The request is declined. Pull it back to draft, change it and submit it again to ask again.",
  },
  QUOTE: {
    approved: "It can be sent to the client from the order now.",
    denied: "It has not gone to the client. Change what the reason asks for and send it again, which asks again.",
  },
};

async function notifyRequester(request: ApprovalRequest, brief: RecordBrief): Promise<NotifyReport> {
  if (!request.requestedById || request.requestedById === request.decidedById) {
    return { names: [], emailed: false };
  }
  const requester = await prisma.user.findUnique({
    where: { id: request.requestedById },
    select: { id: true, name: true, email: true },
  });
  if (!requester) return { names: [], emailed: false };

  const approved = request.status === "APPROVED";
  const amount = moneyExact(Number(request.amountAtDecision ?? request.amountAtRequest));
  const next = NEXT_STEP[request.recordType][approved ? "approved" : "denied"];

  await prisma.notification.create({
    data: {
      userId: requester.id,
      type: "APPROVAL_REQUEST",
      title: `${approved ? "Approved" : "Denied"} · ${brief.label}`,
      message: `${request.decidedByName} ${approved ? "approved" : "denied"} it at ${amount}.${
        request.reason ? ` ${approved ? "Note" : "Why"}: ${request.reason}` : ""
      } ${next}`,
      link: brief.href,
    },
  });

  const template = approvalDecidedEmail({
    recipientName: requester.name,
    noun: APPROVAL_TYPE_NOUN[request.recordType],
    recordLabel: brief.label,
    approved,
    decidedBy: request.decidedByName ?? "An approver",
    amount,
    reason: request.reason,
    next,
    url: `${APP_URL}${brief.href}`,
  });
  const sent = (await wantsApprovalEmail([requester.id])).has(requester.id)
    ? await sendAll([{ to: requester.email, subject: template.subject, html: template.html, text: template.text }])
    : { emailed: false };
  return { names: [requester.name], ...sent };
}

// ---------------------------------------------------------------------------
// Writing rows
// ---------------------------------------------------------------------------

export async function supersedePending(type: ApprovalRecordType, id: string): Promise<number> {
  const { count } = await prisma.approvalRequest.updateMany({
    where: { recordType: type, recordId: id, status: "PENDING" },
    data: { status: "SUPERSEDED", supersededAt: new Date() },
  });
  return count;
}

async function openRequest(
  brief: RecordBrief,
  requester: { id: string | null; name: string },
  note: string | null,
) {
  return prisma.approvalRequest.create({
    data: {
      recordType: brief.type,
      recordId: brief.id,
      recordLabel: brief.label,
      requestedById: requester.id,
      requestedByName: requester.name,
      amountAtRequest: brief.amount,
      note,
    },
  });
}

/** An approver acting on their own record: cleared on the spot, and said so. */
async function clearAutomatically(brief: RecordBrief, actor: Actor, note: string | null) {
  const now = new Date();
  return prisma.approvalRequest.create({
    data: {
      recordType: brief.type,
      recordId: brief.id,
      recordLabel: brief.label,
      status: "APPROVED",
      automatic: true,
      requestedById: actor.id,
      requestedByName: actor.name,
      requestedAt: now,
      amountAtRequest: brief.amount,
      note,
      decidedById: actor.id,
      decidedByName: actor.name,
      decidedAt: now,
      amountAtDecision: brief.amount,
    },
  });
}

/**
 * Decide a PENDING row, conditioned on it still being PENDING — so two
 * approvers pressing at once record one decision, and a decided row can never
 * be decided again. Returns null if somebody got there first.
 */
async function settle(
  request: ApprovalRequest,
  actor: Actor,
  approved: boolean,
  amount: number,
  reason: string | null,
  extra?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
): Promise<ApprovalRequest | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: approved ? "APPROVED" : "DENIED",
        decidedById: actor.id,
        decidedByName: actor.name,
        decidedAt: new Date(),
        amountAtDecision: amount,
        reason,
      },
    });
    if (count === 0) return null;
    if (extra) await extra(tx);
    return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type GateResult =
  | { status: "clear"; automatic: boolean }
  | { status: "held"; message: string; raised: boolean };

/**
 * The one hold a quote had before this: a client row materialised for somebody
 * who has not onboarded (`Client.prospectAt`). Folded in here so there is one
 * gate at each release point rather than two side by side — the message is the
 * one `order-stage.ts` always gave.
 */
async function prospectHold(orderId: string, act: string): Promise<string | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: orderId },
    select: {
      client: {
        select: { name: true, prospectAt: true, convertedLeads: { select: { id: true }, take: 1 } },
      },
    },
  });
  const client = order?.client;
  if (!client?.prospectAt) return null;
  const lead = client.convertedLeads[0];
  return `${client.name} has not onboarded. ${sentence(act)} would ${
    act.startsWith("send")
      ? "put the full rate card in an inbox nobody has verified"
      : "commit stock to an account nobody has verified"
  }. Record their onboarding${lead ? " on their lead" : ""} first — that is what releases this quote.`;
}

export type GateInput = {
  type: ApprovalRecordType;
  id: string;
  /** Null only for the client portal, where nobody signed in is acting. */
  actor: Actor | null;
  /** Lower-case verb phrase: "sending it to the vendor". */
  act: string;
  /**
   * True from a screen, where pressing the button *is* asking: a held record
   * raises a request and notifies approvers. False in the ported actions, which
   * only refuse — a direct POST cannot open requests in someone's name.
   */
  raise: boolean;
  /**
   * Whether a record with no approval history must still be cleared. True at the
   * release itself; false at the steps after it, so a record released before
   * approvals existed is not newly blocked.
   */
  always: boolean;
  /** Why this was asked, for the approver: "Submit to the vendor". */
  note?: string;
  /**
   * Answer without writing anything — for a read that wants to know whether the
   * act would be allowed (a screen deciding what to offer). An approver who
   * would clear it on the spot reads as clear; no row is written until they act.
   */
  peek?: boolean;
};

export async function releaseGate(input: GateInput): Promise<GateResult> {
  const { type, id, actor, act } = input;

  if (type === "QUOTE" && actor) {
    const prospect = await prospectHold(id, act);
    if (prospect) return { status: "held", message: prospect, raised: false };
  }

  const brief = await briefFor(type, id);
  // Missing records are the ported action's refusal to give, in its own words.
  if (!brief) return { status: "clear", automatic: false };

  const history = await historyFor(type, id);
  const standing = standingOf(history, brief.amount);

  if (standing.kind === "approved" && standing.matches) return { status: "clear", automatic: false };
  if (standing.kind === "none" && !input.always) return { status: "clear", automatic: false };

  const amount = moneyExact(brief.amount);

  if (actor && (await isApprover(actor, type))) {
    const othersAsk =
      standing.kind === "pending" && standing.request.requestedById !== actor.id;
    if (input.peek) {
      return othersAsk
        ? {
            status: "held",
            raised: false,
            message: `${heldMessage(brief, standing, act)} You approve these — decide it on the record first.`,
          }
        : { status: "clear", automatic: true };
    }
    if (othersAsk && !input.raise) {
      // Somebody else is waiting on an answer, and this is not a button the
      // approver pressed to release it — minting a quote link when a dialog
      // opens, say. Silently approving on that would make opening a dialog a
      // decision. The answer is given on the record.
      return {
        status: "held",
        raised: false,
        message: `${heldMessage(brief, standing, act)} You approve these — decide it on the record first.`,
      };
    }
    if (othersAsk && sameMoney(Number(standing.request.amountAtRequest), brief.amount)) {
      // The approver pressed the release button on exactly the figure somebody
      // asked about: that is their answer, recorded as a real decision (not an
      // automatic one — another person asked) and sent back to the requester.
      const settled = await settle(standing.request, actor, true, brief.amount, null);
      if (settled) await notifyRequester(settled, brief);
      return { status: "clear", automatic: false };
    }
    await supersedePending(type, id);
    await clearAutomatically(brief, actor, input.note ?? null);
    return { status: "clear", automatic: true };
  }

  if (!actor || !input.raise || input.peek) {
    return { status: "held", message: heldMessage(brief, standing, act), raised: false };
  }

  if (
    standing.kind === "pending" &&
    sameMoney(Number(standing.request.amountAtRequest), brief.amount)
  ) {
    return {
      status: "held",
      raised: false,
      message: `${heldMessage(brief, standing, act)} Nobody was asked again.`,
    };
  }

  await supersedePending(type, id);
  const request = await openRequest(
    brief,
    { id: actor.id, name: actor.name },
    input.note ??
      (standing.kind === "approved"
        ? `Approved at ${moneyExact(Number(standing.request.amountAtDecision))}; now ${amount}`
        : null),
  );
  const report = await notifyApprovers(request, brief);
  return {
    status: "held",
    raised: true,
    message: `Held for approval: ${brief.label} at ${amount} needs an approver's yes before ${act}. ${describeReport(report)}`,
  };
}

function heldMessage(brief: RecordBrief, standing: Standing, act: string): string {
  const amount = moneyExact(brief.amount);
  switch (standing.kind) {
    case "pending":
      return `${brief.label} is waiting on approval — asked by ${standing.request.requestedByName} on ${dayYear(
        standing.request.requestedAt,
      )} at ${moneyExact(Number(standing.request.amountAtRequest))}. ${sentence(act)} can happen once an approver says yes.`;
    case "denied":
      return `${brief.label} was denied by ${standing.request.decidedByName}: “${standing.request.reason}”. Change it and ask again before ${act}.`;
    case "approved":
      return `${brief.label} was approved at ${moneyExact(
        Number(standing.request.amountAtDecision),
      )} and now comes to ${amount}. The new figure needs approving before ${act}.`;
    default:
      return `${brief.label} needs an approver's yes before ${act}.`;
  }
}

// ---------------------------------------------------------------------------
// Money changing under an approval
// ---------------------------------------------------------------------------

/**
 * Called by the edit paths after a save, with the amount before and after.
 *
 * - A request still waiting is renewed at the new figure, in the original
 *   requester's name — they asked, and they are who hears the answer.
 * - A record that was approved (or released before approvals existed) goes back
 *   for approval, unless the editor approves this type, in which case their
 *   figure is recorded as cleared by them.
 * - A draft nobody has asked about yet, or a denied one, is left alone: its next
 *   release is what asks.
 *
 * Returns a sentence for the save's confirmation, or null when nothing changed.
 */
export async function noteMoneyChange(input: {
  type: ApprovalRecordType;
  id: string;
  before: number;
  actor: Actor;
}): Promise<{ message: string; pending: boolean } | null> {
  const brief = await briefFor(input.type, input.id);
  if (!brief || sameMoney(input.before, brief.amount)) return null;

  const change = `Total changed from ${moneyExact(input.before)} to ${moneyExact(brief.amount)} by ${input.actor.name}`;
  const history = await historyFor(input.type, input.id);
  const latest = history.find((row) => row.status !== "SUPERSEDED");

  if (latest?.status === "PENDING") {
    await supersedePending(input.type, input.id);
    const renewed = await openRequest(
      brief,
      { id: latest.requestedById, name: latest.requestedByName },
      change,
    );
    const report = await notifyApprovers(renewed, brief);
    return {
      pending: true,
      message: `The approval request was renewed at ${moneyExact(brief.amount)}. ${describeReport(report)}`,
    };
  }

  const wasCleared = latest?.status === "APPROVED" || (!latest && brief.released);
  if (!wasCleared) return null;

  if (await isApprover(input.actor, input.type)) {
    await clearAutomatically(brief, input.actor, change);
    return {
      pending: false,
      message: `You approve ${APPROVAL_TYPE_NOUN[input.type]}s, so the new figure is recorded as cleared by you.`,
    };
  }

  const request = await openRequest(brief, { id: input.actor.id, name: input.actor.name }, change);
  const report = await notifyApprovers(request, brief);
  return {
    pending: true,
    message: `The money changed, so it is back for approval at ${moneyExact(brief.amount)}. ${describeReport(report)}`,
  };
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export type DecisionOutcome =
  | { status: "ok"; message: string; href: string }
  | { status: "error"; message: string };

export async function decide(
  requestId: string,
  actor: Actor,
  approve: boolean,
  reasonInput: string | null,
): Promise<DecisionOutcome> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) return { status: "error", message: "That approval request no longer exists." };

  if (request.status !== "PENDING") {
    return {
      status: "error",
      message:
        request.status === "SUPERSEDED"
          ? `This request was replaced — ${request.recordLabel} changed after it was asked. Decide the current one on the record.`
          : `Already ${request.status === "APPROVED" ? "approved" : "denied"} by ${request.decidedByName}${
              request.decidedAt ? ` on ${dayYear(request.decidedAt)}` : ""
            }. A decision is not changed afterwards.`,
    };
  }

  if (request.requestedById === actor.id) {
    return {
      status: "error",
      message: "You raised this request, so another approver has to decide it.",
    };
  }
  if (!(await isApprover(actor, request.recordType))) {
    return {
      status: "error",
      message: `You are not an approver for ${APPROVAL_TYPE_NOUN[request.recordType]}s. A super admin sets that in Settings → Users.`,
    };
  }

  const reason = reasonInput?.trim() || null;
  if (!approve && !reason) {
    return {
      status: "error",
      message: `Say why it is denied — the reason goes back to ${request.requestedByName}.`,
    };
  }

  const brief = await briefFor(request.recordType, request.recordId);
  if (!brief || brief.closed) {
    await supersedePending(request.recordType, request.recordId);
    return {
      status: "error",
      message: brief
        ? `${brief.label} is ${brief.closedAs}, so there is nothing left to approve. The request was closed.`
        : `${request.recordLabel} no longer exists. The request was closed.`,
    };
  }

  // The figure on the screen when the approver looked is the figure they are
  // approving. If the record moved since it was asked, the ask is renewed at
  // today's figure and the approver is sent back to look again.
  if (!sameMoney(Number(request.amountAtRequest), brief.amount)) {
    await supersedePending(request.recordType, request.recordId);
    await openRequest(
      brief,
      { id: request.requestedById, name: request.requestedByName },
      `Total changed from ${moneyExact(Number(request.amountAtRequest))} to ${moneyExact(brief.amount)}`,
    );
    return {
      status: "error",
      message: `It was asked at ${moneyExact(Number(request.amountAtRequest))} and now comes to ${moneyExact(
        brief.amount,
      )}. The request has been renewed at the new figure — look again before deciding.`,
    };
  }

  // Set when the funding request refuses the decision; throwing rolls the
  // decision back with it, so neither is written.
  const blocked = { message: "" };
  const settled = await settle(request, actor, approve, brief.amount, reason, async (tx) => {
    if (request.recordType !== "FUNDING_REQUEST") return;
    // A funding request's own lifecycle is where its approval shows: SUBMITTED
    // becomes APPROVED or DECLINED in the same transaction as the decision, so
    // the two can never disagree.
    const { count } = await tx.fundingRequest.updateMany({
      where: { id: request.recordId, status: "SUBMITTED" },
      data: approve
        ? { status: "APPROVED", approvalDate: new Date(), declineReason: null }
        : { status: "DECLINED", declineReason: reason },
    });
    if (count === 0) {
      blocked.message = `${brief.label} is no longer submitted, so it cannot be ${approve ? "approved" : "declined"}. Reload the record.`;
      throw new Error(blocked.message);
    }
  }).catch((error: unknown) => {
    if (blocked.message) return null;
    throw error;
  });

  if (blocked.message) return { status: "error", message: blocked.message };
  if (!settled) {
    const now = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
    return {
      status: "error",
      message: `Somebody decided it first: ${now?.status.toLowerCase()} by ${now?.decidedByName ?? "another approver"}.`,
    };
  }

  const report = await notifyRequester(settled, brief);
  const told =
    report.names.length === 0
      ? ""
      : report.emailed
        ? ` ${report.names[0]} was told in the app and by email.`
        : ` ${report.names[0]} was told in the app; email is switched off here, so they were not emailed.`;

  return {
    status: "ok",
    href: brief.href,
    message: `${approve ? "Approved" : "Denied"} ${brief.label} at ${moneyExact(brief.amount)}.${told}`,
  };
}

// ---------------------------------------------------------------------------
// Reading, for the record screens and the queue
// ---------------------------------------------------------------------------

export type ApprovalRow = {
  id: string;
  status: ApprovalRequest["status"];
  automatic: boolean;
  requestedById: string | null;
  requestedByName: string;
  requestedAt: Date;
  amountAtRequest: number;
  note: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  amountAtDecision: number | null;
  reason: string | null;
};

function toRow(row: ApprovalRequest): ApprovalRow {
  return {
    id: row.id,
    status: row.status,
    automatic: row.automatic,
    requestedById: row.requestedById,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    amountAtRequest: Number(row.amountAtRequest),
    note: row.note,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt,
    amountAtDecision: row.amountAtDecision === null ? null : Number(row.amountAtDecision),
    reason: row.reason,
  };
}

export type ApprovalPanel = {
  label: string;
  amount: number;
  released: boolean;
  closed: boolean;
  standing: "none" | "pending" | "approved" | "stale" | "denied";
  current: ApprovalRow | null;
  history: ApprovalRow[];
  /** Everyone who could decide the current request — for "Pending approval by …". */
  approverNames: string[];
  viewerApproves: boolean;
  /** The viewer may approve or deny the pending request. */
  viewerCanDecide: boolean;
};

export async function approvalPanel(
  type: ApprovalRecordType,
  id: string,
  viewer: { id: string; role: UserRole } | null,
): Promise<ApprovalPanel | null> {
  const brief = await briefFor(type, id);
  if (!brief) return null;
  const history = await historyFor(type, id);
  const standing = standingOf(history, brief.amount);
  const current = standing.kind === "none" ? null : standing.request;
  const viewerApproves = viewer ? await isApprover(viewer, type) : false;
  const approvers =
    standing.kind === "pending" ? await approversFor(type, standing.request.requestedById) : [];

  return {
    label: brief.label,
    amount: brief.amount,
    released: brief.released,
    closed: brief.closed,
    standing:
      standing.kind === "approved" ? (standing.matches ? "approved" : "stale") : standing.kind,
    current: current ? toRow(current) : null,
    history: history.map(toRow),
    approverNames: approvers.map((user) => user.name),
    viewerApproves,
    viewerCanDecide:
      standing.kind === "pending" &&
      viewerApproves &&
      !!viewer &&
      standing.request.requestedById !== viewer.id &&
      !brief.closed,
  };
}

export type QueueItem = ApprovalRow & {
  recordType: ApprovalRecordType;
  recordId: string;
  label: string;
  href: string;
  party: ApprovalEmailFact | null;
  why: string | null;
  currentAmount: number;
  /** Whole days since it was asked. */
  waitingDays: number;
};

/**
 * Everything waiting on this approver, across the types they approve, oldest
 * first. Their own requests are left out (they cannot decide them), and so is
 * anything whose record has closed or gone — those are superseded when someone
 * next tries to decide them, and until then they are nobody's work.
 */
export async function queueFor(viewer: { id: string; role: UserRole }): Promise<{
  types: ApprovalRecordType[];
  items: QueueItem[];
  ownWaiting: number;
}> {
  const types = await approverTypesFor(viewer.id, viewer.role);
  const [rows, ownWaiting] = await Promise.all([
    types.length === 0
      ? Promise.resolve([] as ApprovalRequest[])
      : prisma.approvalRequest.findMany({
          where: {
            status: "PENDING",
            recordType: { in: types },
            OR: [{ requestedById: null }, { requestedById: { not: viewer.id } }],
          },
          orderBy: { requestedAt: "asc" },
        }),
    prisma.approvalRequest.count({ where: { status: "PENDING", requestedById: viewer.id } }),
  ]);

  const items: QueueItem[] = [];
  const now = Date.now();
  for (const row of rows) {
    const brief = await briefFor(row.recordType, row.recordId);
    if (!brief || brief.closed) continue;
    items.push({
      ...toRow(row),
      recordType: row.recordType,
      recordId: row.recordId,
      label: brief.label,
      href: brief.href,
      party: brief.party,
      why: brief.why,
      currentAmount: brief.amount,
      waitingDays: Math.floor((now - row.requestedAt.getTime()) / 86_400_000),
    });
  }
  return { types, items, ownWaiting };
}

/** For the rail: how many requests this person could decide right now. */
export async function pendingCountFor(viewer: { id: string; role: UserRole }): Promise<number | null> {
  const types = await approverTypesFor(viewer.id, viewer.role);
  if (types.length === 0) return null;
  return prisma.approvalRequest.count({
    where: {
      status: "PENDING",
      recordType: { in: types },
      OR: [{ requestedById: null }, { requestedById: { not: viewer.id } }],
    },
  });
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** Before these, a quote has not gone to the client; releasing it is always judged. */
const UNSENT_ORDER = ["DRAFT", "REVISION"];

/**
 * The quote gate, for the several ported write paths that put a quote in front
 * of a client or commit it: minting a link, marking it sent, emailing it, and
 * approving the order. Each is its own `"use server"` export, so each checks.
 *
 * Returns the refusal, or null when it may go ahead. With `raise`, a held quote
 * asks for approval (used where a person pressed the button that means "send").
 */
export async function quoteGate(input: {
  orderId: string;
  userId: string;
  role: UserRole;
  act: string;
  raise: boolean;
  note?: string;
}): Promise<GateResult> {
  const order = await prisma.reservation.findUnique({
    where: { id: input.orderId },
    select: { status: true },
  });
  if (!order) return { status: "clear", automatic: false };
  return releaseGate({
    type: "QUOTE",
    id: input.orderId,
    actor: await actorFor(input.userId, input.role),
    act: input.act,
    raise: input.raise,
    always: UNSENT_ORDER.includes(order.status),
    note: input.note,
  });
}

/**
 * The client portal's check, where nobody is signed in: only a quote whose
 * approval is outstanding is refused — the figure changed after it was
 * approved, or it was never cleared. Quotes sent before approvals existed have
 * no history and are untouched.
 */
export async function portalQuoteHold(orderId: string): Promise<string | null> {
  const gate = await releaseGate({
    type: "QUOTE",
    id: orderId,
    actor: null,
    act: "accepting it",
    raise: false,
    always: false,
  });
  return gate.status === "held"
    ? "This quote is being revised and can't be accepted just now. Your contact at VFXNow will send you the updated version."
    : null;
}
