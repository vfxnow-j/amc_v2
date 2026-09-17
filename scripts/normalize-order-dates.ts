/**
 * Rewrite v2's stored order dates to the one convention: a calendar day at
 * 12:00 UTC (src/lib/billing/calendar.ts).
 *
 *   npx tsx scripts/normalize-order-dates.ts           # dry run: counts and samples
 *   npx tsx scripts/normalize-order-dates.ts --apply   # write
 *
 * Why it exists: order dates reached the database three ways — UTC midnight
 * from v2's builder, Pacific midnight from v1, and raw creation timestamps —
 * and a UTC-midnight date shows a day early on a Pacific screen. Each value is
 * mapped to the day it was meant to be (`intendedDay`), then:
 *
 *  - a sale's end date becomes its order date, because a sale has no term;
 *  - an anchored, recurring order with no invoice yet gets its next billing
 *    date recomputed from its start and the business anchor. The old rule put
 *    a start stored at UTC midnight on the 1st on a next billing date of that
 *    same day, so the checkout invoice and the run both billed the first month.
 *    Nothing is lost by moving a stale date forward: the first invoice bills
 *    from the term start up to the next billing date, however many periods
 *    that is. An order that has an invoice keeps its schedule, only normalized.
 *
 * Re-run after scripts/refresh-from-v1.sh: v1 still writes its own format, and
 * a refresh brings it back. Only ever touches v2 — the Prisma client refuses any
 * other database (src/lib/db-guard.ts). Idempotent.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { intendedDay, isAnchoredCycle, toDateInput } from "@/lib/billing/calendar";
import { calculateNextBillingDate } from "@/lib/utils/billing";
import { getBillingAnchor } from "@/lib/settings/business";
import type { BillingCycleType } from "@/lib/types";

const APPLY = process.argv.includes("--apply");

const RESERVATION_DAY_FIELDS = [
  "startDate",
  "endDate",
  "quoteExpiresAt",
  "nextBillingDate",
  "recurrenceEndDate",
  "deliveryDate",
  "returnDate",
  "rtoStartDate",
] as const;

type Change = { field: string; from: Date | null; to: Date | null };

const same = (a: Date | null, b: Date | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

const show = (d: Date | null) => (d ? `${d.toISOString()} (${toDateInput(d)})` : "null");

async function main() {
  const anchor = await getBillingAnchor();
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} · anchor monthly=${anchor.monthly} weekly=${anchor.weekly}\n`);

  const orders = await prisma.reservation.findMany({
    select: {
      id: true,
      reservationNumber: true,
      reservationType: true,
      status: true,
      isRecurring: true,
      billingCycleType: true,
      billingCycleDay: true,
      billingCycleDays: true,
      billingPeriodsCompleted: true,
      lastBilledDate: true,
      _count: { select: { invoices: true } },
      ...Object.fromEntries(RESERVATION_DAY_FIELDS.map((f) => [f, true])),
    },
  });

  const counts: Record<string, number> = {};
  let ordersChanged = 0;
  const samples: string[] = [];

  for (const order of orders) {
    const row = order as unknown as Record<string, Date | null> & typeof order;
    const changes: Change[] = [];
    const next: Record<string, Date | null> = {};

    for (const field of RESERVATION_DAY_FIELDS) {
      const from = row[field] as Date | null;
      const to = from ? intendedDay(from) : null;
      next[field] = to;
      if (!same(from, to)) changes.push({ field, from, to });
    }

    if (order.reservationType === "SALE" && next.startDate && !same(next.endDate, next.startDate)) {
      const existing = changes.find((c) => c.field === "endDate");
      if (existing) existing.to = next.startDate;
      else changes.push({ field: "endDate", from: row.endDate as Date, to: next.startDate });
      next.endDate = next.startDate;
      counts["sale end → order date"] = (counts["sale end → order date"] ?? 0) + 1;
    }

    const neverBilled =
      order._count.invoices === 0 &&
      order.billingPeriodsCompleted === 0 &&
      order.lastBilledDate === null;
    const live = !["COMPLETED", "CANCELLED", "LOST"].includes(order.status);
    if (
      live &&
      neverBilled &&
      order.isRecurring &&
      isAnchoredCycle(order.billingCycleType) &&
      next.startDate
    ) {
      const recomputed = calculateNextBillingDate(
        next.startDate,
        order.billingCycleType as BillingCycleType,
        order.billingCycleDay,
        order.billingCycleDays ?? undefined,
        anchor,
      );
      if (!same(next.nextBillingDate, recomputed)) {
        const before = row.nextBillingDate as Date | null;
        const existing = changes.find((c) => c.field === "nextBillingDate");
        if (existing) existing.to = recomputed;
        else changes.push({ field: "nextBillingDate", from: before, to: recomputed });
        if (before && recomputed && toDateInput(intendedDay(before)) !== toDateInput(recomputed)) {
          counts["next billing moved to a different day"] =
            (counts["next billing moved to a different day"] ?? 0) + 1;
          if (samples.length < 40) {
            samples.push(
              `${order.reservationNumber} ${order.status} start ${toDateInput(next.startDate)}: next billing ${toDateInput(intendedDay(before))} → ${toDateInput(recomputed)}`,
            );
          }
        }
      }
    }

    if (changes.length === 0) continue;
    ordersChanged++;
    for (const c of changes) counts[c.field] = (counts[c.field] ?? 0) + 1;

    if (APPLY) {
      await prisma.reservation.update({
        where: { id: order.id },
        data: Object.fromEntries(changes.map((c) => [c.field, c.to])),
      });
    } else if (ordersChanged <= 5) {
      console.log(order.reservationNumber, order.reservationType);
      for (const c of changes) console.log(`   ${c.field}: ${show(c.from)} → ${show(c.to)}`);
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: { OR: [{ periodStartDate: { not: null } }, { periodEndDate: { not: null } }] },
    select: { id: true, periodStartDate: true, periodEndDate: true },
  });
  let invoicesChanged = 0;
  for (const invoice of invoices) {
    const start = invoice.periodStartDate ? intendedDay(invoice.periodStartDate) : null;
    const end = invoice.periodEndDate ? intendedDay(invoice.periodEndDate) : null;
    if (same(start, invoice.periodStartDate) && same(end, invoice.periodEndDate)) continue;
    invoicesChanged++;
    if (APPLY) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { periodStartDate: start, periodEndDate: end },
      });
    }
  }

  console.log(`\n${orders.length} orders read · ${ordersChanged} ${APPLY ? "rewritten" : "would change"}`);
  for (const [field, n] of Object.entries(counts).sort()) console.log(`   ${field}: ${n}`);
  console.log(`${invoices.length} invoices with a period · ${invoicesChanged} ${APPLY ? "rewritten" : "would change"}`);
  if (samples.length) {
    console.log("\nNext billing dates that move to a different day (orders with no invoice yet):");
    for (const line of samples) console.log(`   ${line}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
