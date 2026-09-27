/**
 * What the billing run would invoice next, before and after "invoice what the
 * quote says each month" (2026-09-26). Read-only:
 *   npx tsx scripts/check-billing-run.ts
 *
 * For every ACTIVE recurring RENTAL/CLOUD order it prices the next invoice two
 * ways — the old run (Σ rate × qty × share over every line, taxed, no
 * discount, no term stop) and the new one (cycleInvoice over the chosen
 * option's lines, clipped to the committed term) — and attributes each change.
 * Everything runs inside one transaction that throws at the end, so nothing
 * could persist even if a write crept in. It never calls runBillingCycle.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { anchorAfter, billedPeriods, intendedDay, isAnchoredCycle, toDateInput } from "@/lib/billing/calendar";
import { ACTIVE_PACKAGE_SHIPPING, cycleInvoice, cycleTermsForOrder, scopeChosenItems, toCycleLine } from "@/lib/billing/cycle-invoice";
import { termEnd } from "@/lib/billing/payment-schedule";
import { priorCycleInvoiceWhere } from "@/lib/billing/first-cycle";
import { roundMoney } from "@/lib/pricing/periods";
import { BILLING_ANCHOR_KEY, parseBillingAnchor } from "@/lib/settings/business";

class Rollback extends Error {}

const money = (n: number) => n.toFixed(2).padStart(10);

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // The same read getBillingAnchor does, without React's request cache.
      const row = await tx.setting.findUnique({ where: { key: BILLING_ANCHOR_KEY } });
      const anchor = parseBillingAnchor(row?.value);
      console.log(`Anchor: monthly ${anchor.monthly}, weekly ${anchor.weekly} (setting row ${row ? "present" : "absent → default"})`);

      const orders = await tx.reservation.findMany({
        where: {
          status: "ACTIVE",
          isRecurring: true,
          billingCycleType: { not: "ONE_TIME" },
          reservationType: { in: ["RENTAL", "CLOUD"] },
        },
        include: {
          // Unfiltered, unlike CHOSEN_OPTION_ITEMS — the latent counts below need
          // to see items an inactive package left unbilled, not just the scope
          // that actually prices.
          items: { include: { asset: true, package: { select: { isActive: true } } } },
          packages: ACTIVE_PACKAGE_SHIPPING,
        },
        orderBy: { reservationNumber: "asc" },
      });

      const counts = { orders: orders.length, notBilled: 0, noNextDate: 0, priced: 0, changed: 0, discount: 0, included: 0, unchosen: 0, oneTime: 0, delivery: 0, termStop: 0 };
      let oldSum = 0;
      let newSum = 0;

      // What every order carries, whether or not it has a next billing date:
      // the faults are latent on an order the run doesn't reach yet.
      const latent = { discount: 0, included: 0, unchosen: 0, oneTime: 0, term: 0 };
      for (const r of orders) {
        if (r.discountType && Number(r.discountValue) > 0) latent.discount++;
        if (r.items.some((i) => i.includedInParent)) latent.included++;
        if (r.items.some((i) => i.packageId !== null && !i.package?.isActive)) latent.unchosen++;
        if (r.items.some((i) => i.isOneTime)) latent.oneTime++;
        if (r.termMonths) latent.term++;
      }

      for (const r of orders) {
        if (r.notBilled) { counts.notBilled++; continue; }
        if (!r.nextBillingDate) { counts.noNextDate++; continue; }
        counts.priced++;
        const billingDate = r.nextBillingDate;
        const cycle = r.billingCycleType as string;
        const anchoredNext = isAnchoredCycle(cycle) ? anchorAfter(billingDate, cycle, anchor) : null;
        const taxRate = Number(r.taxRate) || 0;

        // Old: every line, rate × qty × share, taxed, no discount, no term.
        const oldShare = isAnchoredCycle(cycle) && anchoredNext ? billedPeriods(billingDate, anchoredNext, cycle, anchor) : 1;
        let oldSub = 0;
        for (const i of r.items) oldSub += roundMoney((Number(i.quantity) || 1) * Number(i.rate) * oldShare);
        const oldTotal = oldSub + oldSub * (taxRate / 100);

        // New.
        const termStop = r.termMonths ? termEnd(r.startDate, r.termMonths) : null;
        const causes: string[] = [];
        let newTotal = 0;
        let detail = "";
        if (termStop && intendedDay(billingDate).getTime() >= termStop.getTime()) {
          causes.push("term ended");
          detail = `term ended ${toDateInput(termStop)} → no invoice`;
        } else {
          const stretchEnd = anchoredNext && termStop && anchoredNext.getTime() > termStop.getTime() ? termStop : anchoredNext;
          if (stretchEnd !== anchoredNext) causes.push("term clips stretch");
          const share = isAnchoredCycle(cycle) && stretchEnd ? billedPeriods(billingDate, stretchEnd, cycle, anchor) : 1;
          const prior = await tx.invoice.count({ where: priorCycleInvoiceWhere(r.id) });
          const first = prior === 0;
          const scoped = scopeChosenItems(r.items);
          const priced = cycleInvoice({
            lines: scoped.map(toCycleLine),
            share,
            first,
            terms: cycleTermsForOrder(r),
          });
          newTotal = priced.total;
          if (priced.discount > 0) causes.push("discount");
          if (scoped.some((i) => i.includedInParent)) causes.push("included parts");
          if (scoped.length < r.items.length) causes.push("unchosen options");
          if (!first && scoped.some((i) => i.isOneTime && !i.includedInParent)) causes.push("one-time lines");
          if (priced.oneTimeCharges > 0) causes.push("delivery/return on first");
          detail = `share ${share.toFixed(4)}${first ? ", first" : ""} · lines ${priced.itemsSubtotal.toFixed(2)} − disc ${priced.discount.toFixed(2)} + tax ${priced.taxAmount.toFixed(2)} + once ${priced.oneTimeCharges.toFixed(2)}`;
        }

        oldSum += oldTotal;
        newSum += newTotal;
        const changed = Math.abs(roundMoney(oldTotal) - newTotal) >= 0.005;
        if (!changed) continue;
        counts.changed++;
        if (causes.includes("discount")) counts.discount++;
        if (causes.includes("included parts")) counts.included++;
        if (causes.includes("unchosen options")) counts.unchosen++;
        if (causes.includes("one-time lines")) counts.oneTime++;
        if (causes.includes("delivery/return on first")) counts.delivery++;
        if (causes.includes("term ended") || causes.includes("term clips stretch")) counts.termStop++;
        console.log(
          `${r.reservationNumber.padEnd(14)} next ${toDateInput(intendedDay(billingDate))} old ${money(oldTotal)} new ${money(newTotal)}  [${causes.join(", ") || "rounding/other"}]  ${detail}`,
        );
      }

      console.log("\nSummary");
      console.log(`  active recurring rental/cloud orders: ${counts.orders} (not billed: ${counts.notBilled}, no next billing date: ${counts.noNextDate}, priced: ${counts.priced})`);
      console.log(`  next invoice changes: ${counts.changed}`);
      console.log(`    discount: ${counts.discount}`);
      console.log(`    included parts: ${counts.included}`);
      console.log(`    unchosen options: ${counts.unchosen}`);
      console.log(`    one-time lines: ${counts.oneTime}`);
      console.log(`    delivery/return on the first invoice: ${counts.delivery}`);
      console.log(`    term stop (ended or clipped): ${counts.termStop}`);
      console.log(`  orders carrying each (all ${counts.orders}): discount ${latent.discount}, included parts ${latent.included}, unchosen options ${latent.unchosen}, one-time lines ${latent.oneTime}, committed term ${latent.term}`);
      console.log(`  Σ next invoice old ${oldSum.toFixed(2)} → new ${newSum.toFixed(2)}`);
      throw new Rollback("rolled back — read-only check");
    },
    { timeout: 120_000 },
  );
}

main()
  .catch((e) => {
    if (e instanceof Rollback) { console.log(`\n${e.message}`); return; }
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
