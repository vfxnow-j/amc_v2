import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { IN_FLEET, OPEN_CHECKOUT } from "@/lib/inventory/availability";
import { UNSETTLED } from "@/lib/queries/accounting";
import { daysUntil } from "@/lib/format";

/**
 * What puts rows in the `Notification` table.
 *
 * The model, the enum and the feed's whole reason to exist were inherited from
 * v1, but nothing in v2 ever wrote to it: v1's only producer was
 * `lib/actions/marketing.ts`, which raised a lead follow-up reminder, and
 * marketing is exactly what notifications replace. The table is empty in the
 * restored database and would have stayed empty, so the bell would have read
 * zero forever and the feed would have been a screen that could not be tested.
 *
 * So this module is the producer, and it is deliberately not an event bus.
 * Nothing calls it on write; it is a sweep, run once a day by
 * `/api/cron/daily-digest`, that asks the database the five questions the
 * `NotificationType` enum already names and records the answers. That choice
 * matters:
 *
 * - It is restartable. A missed night costs nothing, because the conditions are
 *   still true tomorrow — an event bus that drops a message loses it for good.
 * - It cannot drift from the screens. "Overdue" here is `OPEN_CHECKOUT` past
 *   `expectedReturn`, the same definition the Reservations hub and the units
 *   list use, not `Checkout.status = OVERDUE`, which is maintained by a nightly
 *   job and lags. Unsettled invoices come from `UNSETTLED` in `queries/accounting`
 *   for the same reason. A notification that disagrees with the list it links
 *   to is worse than no notification.
 * - SYSTEM is not raised here. It means "the platform needs to tell you
 *   something", and a sweep has nothing to say.
 */

const DAY_MS = 86_400_000;

/** Expiries this far out are worth a warning; nearer than this is not new news. */
const EXPIRY_HORIZON_DAYS = 30;

/**
 * How long the same fact stays quiet after being raised.
 *
 * `Notification` carries no dedupe key and no unique constraint — adding one is
 * a schema change — so identity is (userId, type, link), which is what a person
 * would call "the same alert about the same thing". Re-raising is what makes a
 * still-unfixed condition come back after somebody has dismissed it, and seven
 * days is a working week: long enough not to nag, short enough that a genuinely
 * abandoned overdue order resurfaces.
 */
const QUIET_DAYS = 7;

type Draft = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
};

/** What a rule found, before it is addressed to anyone. */
type Alert = Omit<Draft, "userId">;

/**
 * Address a rule's findings to each of its recipients.
 *
 * Three of the five rules go to every admin, and each was writing the same
 * nested loop to fan one finding out across them.
 */
function addressedTo(recipients: string[], alerts: Alert[]): Draft[] {
  return alerts.flatMap((alert) =>
    recipients.map((userId) => ({ userId, ...alert })),
  );
}

export type RaiseResult = {
  /** Rows written. */
  raised: number;
  /** Conditions found but already spoken for — held back by the quiet period. */
  suppressed: number;
  byType: Partial<Record<NotificationType, number>>;
};

/** Everyone who gets alerts that belong to the business rather than a person. */
async function adminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// The five questions
// ---------------------------------------------------------------------------

/**
 * Units held past their return date, one notification per order rather than per
 * unit. Ten orders currently hold 112 late units between them in the restored
 * database; a hundred and twelve rows in a feed is not a feed, it is a wall,
 * and nobody chases a unit — they chase the order it went out on.
 *
 * Addressed to whoever checked those units out. That is the person with the
 * client relationship, and `Checkout.createdById` is required, so there is
 * always someone to tell.
 */
async function overdueReturns(now: Date): Promise<Draft[]> {
  const late = await prisma.checkout.findMany({
    where: { ...OPEN_CHECKOUT, expectedReturn: { lt: now } },
    select: {
      createdById: true,
      expectedReturn: true,
      reservationId: true,
      reservation: { select: { reservationNumber: true } },
      client: { select: { id: true, name: true, companyName: true } },
    },
  });

  type Group = {
    link: string;
    what: string;
    client: string;
    units: number;
    oldest: Date;
    owners: Set<string>;
  };
  const groups = new Map<string, Group>();

  for (const row of late) {
    // The where-clause compares it against `now`, so it is never null here.
    const due = row.expectedReturn;
    if (!due) continue;

    // A checkout with no order is a `SIMPLE` one-off against a client, so the
    // client record is the only place that can show it in context.
    const key = row.reservationId ?? `client:${row.client.id}`;
    const link = row.reservationId
      ? `/dashboard/orders/${row.reservationId}`
      : `/dashboard/clients/${row.client.id}`;
    const what = row.reservation
      ? `order ${row.reservation.reservationNumber}`
      : "a direct checkout";

    const group = groups.get(key) ?? {
      link,
      what,
      client: row.client.companyName || row.client.name,
      units: 0,
      oldest: due,
      owners: new Set<string>(),
    };
    group.units += 1;
    if (due < group.oldest) group.oldest = due;
    group.owners.add(row.createdById);
    groups.set(key, group);
  }

  const drafts: Draft[] = [];
  for (const group of groups.values()) {
    const over = -daysUntil(group.oldest, now);
    for (const userId of group.owners) {
      drafts.push({
        userId,
        type: "OVERDUE_RETURN",
        title: `${plural(group.units, "unit")} overdue · ${group.client}`,
        message: `${group.units === 1 ? "A unit is" : `${group.units} units are`} still out on ${group.what}. The oldest is ${plural(over, "day")} past its return date.`,
        link: group.link,
      });
    }
  }
  return drafts;
}

/**
 * Invoices that are unsettled and past due, one per invoice so each can be
 * dismissed as it is chased. Deliberately computed from the due date rather
 * than read off `Invoice.status` — see `UNSETTLED`.
 */
async function invoiceReminders(now: Date, admins: string[]): Promise<Draft[]> {
  const invoices = await prisma.invoice.findMany({
    // The same `AND` the Invoices list's "overdue" view is built from, so the
    // notification and the screen it links to can never disagree.
    where: { AND: [UNSETTLED, { dueDate: { lt: now } }] },
    select: {
      invoiceNumber: true,
      dueDate: true,
      total: true,
      amountPaid: true,
      client: { select: { name: true, companyName: true } },
    },
  });

  return addressedTo(
    admins,
    invoices.map((invoice) => {
      const outstanding = Number(invoice.total) - Number(invoice.amountPaid);
      const over = -daysUntil(invoice.dueDate, now);
      const client = invoice.client.companyName || invoice.client.name;
      return {
        type: "INVOICE_REMINDER",
        title: `${invoice.invoiceNumber} is ${plural(over, "day")} past due`,
        message: `${client} owes $${outstanding.toLocaleString("en-US", { maximumFractionDigits: 2 })} on this invoice.`,
        link: `/dashboard/invoices?view=all&q=${encodeURIComponent(invoice.invoiceNumber)}`,
      };
    }),
  );
}

/**
 * The only rule here with an unambiguous recipient: `CheckoutApproval` names its
 * approver, so this goes to that person and nobody else. Copying an admin in
 * would turn a decision someone owns into a decision everyone watches.
 */
async function approvalRequests(): Promise<Draft[]> {
  const pending = await prisma.checkoutApproval.findMany({
    where: { status: "PENDING" },
    select: {
      approverId: true,
      checkout: {
        select: {
          reservationId: true,
          client: { select: { name: true, companyName: true } },
          assetUnit: { select: { asset: { select: { name: true } } } },
        },
      },
    },
  });

  return pending.map((approval) => ({
    userId: approval.approverId,
    type: "APPROVAL_REQUEST" as const,
    title: `Approval waiting · ${approval.checkout.client.companyName || approval.checkout.client.name}`,
    message: `A checkout of ${approval.checkout.assetUnit.asset.name} needs your sign-off before it can leave.`,
    link: approval.checkout.reservationId
      ? `/dashboard/orders/${approval.checkout.reservationId}`
      : "/dashboard/orders",
  }));
}

/** Service coverage running out within the horizon. */
async function coverageExpiring(now: Date, admins: string[]): Promise<Draft[]> {
  const horizon = new Date(now.getTime() + EXPIRY_HORIZON_DAYS * DAY_MS);
  const coverages = await prisma.serviceCoverage.findMany({
    where: {
      endDate: { gte: now, lte: horizon },
      unit: { status: { in: IN_FLEET } },
    },
    select: {
      name: true,
      endDate: true,
      provider: true,
      unit: {
        select: { barcode: true, asset: { select: { name: true } } },
      },
    },
  });

  return addressedTo(
    admins,
    coverages.map((coverage) => ({
      type: "COVERAGE_EXPIRING",
      title: `${coverage.name} ends in ${plural(daysUntil(coverage.endDate, now), "day")}`,
      message: `${coverage.unit.asset.name} · ${coverage.unit.barcode}${coverage.provider ? ` · ${coverage.provider}` : ""}. Renew or let it lapse deliberately.`,
      link: "/dashboard/service/coverage",
    })),
  );
}

/** Manufacturer warranty running out within the horizon, fleet units only. */
async function warrantyExpiring(now: Date, admins: string[]): Promise<Draft[]> {
  const horizon = new Date(now.getTime() + EXPIRY_HORIZON_DAYS * DAY_MS);
  const units = await prisma.assetUnit.findMany({
    where: {
      // A date range, so the column cannot be null in anything that comes back.
      warrantyExpiry: { gte: now, lte: horizon },
      status: { in: IN_FLEET },
    },
    select: {
      barcode: true,
      warrantyExpiry: true,
      asset: { select: { name: true } },
    },
  });

  return addressedTo(
    admins,
    units.flatMap((unit) =>
      unit.warrantyExpiry
        ? [
            {
              type: "WARRANTY_EXPIRING" as const,
              title: `Warranty ends in ${plural(daysUntil(unit.warrantyExpiry, now), "day")} · ${unit.barcode}`,
              message: `${unit.asset.name} comes off warranty. Any repair after that is billed to us.`,
              link: `/dashboard/units?q=${encodeURIComponent(unit.barcode)}`,
            },
          ]
        : [],
    ),
  );
}

// ---------------------------------------------------------------------------

/**
 * Run every rule and write what is new.
 *
 * Raises for everybody the rule addresses, regardless of their per-type
 * preferences: muting is applied when the feed and the bell *read*, not when
 * the sweep writes. Filtering at write time would mean turning a type back on
 * showed nothing until the next night's run — and would quietly destroy the
 * record of a condition that was true.
 */
export async function raiseNotifications(now: Date = new Date()): Promise<RaiseResult> {
  // Read once and handed down. Three of the five rules go to every admin, and
  // each used to ask for the list itself — the same query three times a sweep.
  const admins = await adminIds();

  const drafts = (
    await Promise.all([
      overdueReturns(now),
      invoiceReminders(now, admins),
      approvalRequests(),
      coverageExpiring(now, admins),
      warrantyExpiring(now, admins),
    ])
  ).flat();

  const result: RaiseResult = { raised: 0, suppressed: 0, byType: {} };
  if (drafts.length === 0) return result;

  // One read for the whole quiet-period check. Anything unread counts as still
  // being said, however old; anything recent counts whether or not it was read.
  const since = new Date(now.getTime() - QUIET_DAYS * DAY_MS);
  const spoken = await prisma.notification.findMany({
    where: {
      userId: { in: [...new Set(drafts.map((draft) => draft.userId))] },
      OR: [{ read: false }, { createdAt: { gte: since } }],
    },
    select: { userId: true, type: true, link: true },
  });

  const seen = new Set(
    spoken.map((row) => `${row.userId}|${row.type}|${row.link ?? ""}`),
  );

  const fresh: Draft[] = [];
  for (const draft of drafts) {
    const key = `${draft.userId}|${draft.type}|${draft.link}`;
    if (seen.has(key)) {
      result.suppressed += 1;
      continue;
    }
    // Guards against two rules producing the same key in one sweep, which
    // `createMany` would happily insert twice.
    seen.add(key);
    fresh.push(draft);
    result.byType[draft.type] = (result.byType[draft.type] ?? 0) + 1;
  }

  if (fresh.length > 0) {
    await prisma.notification.createMany({ data: fresh });
  }
  result.raised = fresh.length;
  return result;
}
