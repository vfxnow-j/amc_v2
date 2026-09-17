import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, CardSkeleton, Field } from "@/components/record/record-card";
import { BusinessBillingForm } from "@/components/settings/business-billing-form";
import { NumberingForm } from "@/components/settings/numbering-form";
import { NUMBER_KINDS, type NumberKind } from "@/lib/numbering/format";
import { getNumbering, highestIssued } from "@/lib/numbering/next";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import {
  addDays,
  businessToday,
  firstBillingStretch,
  WEEKDAY_LABEL,
} from "@/lib/billing/calendar";
import { dayYear } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { describeBillingAnchor, getBillingAnchor } from "@/lib/settings/business";

export const metadata = { title: "Business" };

/**
 * Settings → Business: the billing cycle the whole business runs on.
 *
 * The cycle used to be a per-order field that defaulted to "day 1", so every
 * order could in principle bill on its own day and the only thing keeping them
 * aligned was nobody changing it. The owner's rule is that billing is a business
 * term — the 1st is in the agreements — so it lives here once, and orders only
 * choose *whether* they bill monthly or weekly, never on which day.
 *
 * The right-hand card works the rule through for an order starting today, with
 * the real anchor, so a change to the day can be checked before it is saved
 * rather than discovered on an invoice.
 */
export default async function BusinessSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN")
    return <SettingsDenied id="business" role={user.title} />;

  return (
    <>
      <SettingsHeader id="business" />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Suspense fallback={<CardSkeleton title="Billing cycle" rows={4} />}>
          <BillingCycleCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton title="How an order bills" rows={6} />}>
          <WorkedExampleCard />
        </Suspense>
        <div className="lg:col-span-2">
          <Suspense fallback={<CardSkeleton title="Numbering" rows={9} />}>
            <NumberingCard />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function BillingCycleCard() {
  const [anchor, running] = await Promise.all([
    getBillingAnchor(),
    prisma.reservation.count({
      where: {
        status: "ACTIVE",
        isRecurring: true,
        billingCycleType: { in: ["MONTHLY", "WEEKLY"] },
      },
    }),
  ]);

  return (
    <Card
      title="Billing cycle"
      meta={`${describeBillingAnchor(anchor)} · ${running} running ${
        running === 1 ? "order" : "orders"
      }`}
    >
      <p className="mx-4 mb-3 text-detail text-ink-muted">
        Every monthly and weekly order bills on these days. An order that starts
        between them bills a prorated stretch up to the next one, then whole
        periods. Items are priced at their monthly rate before any discount.
      </p>
      <BusinessBillingForm anchor={anchor} />
    </Card>
  );
}

async function WorkedExampleCard() {
  const anchor = await getBillingAnchor();
  const today = businessToday();
  const monthly = firstBillingStretch(today, "MONTHLY", anchor);
  const weekly = firstBillingStretch(today, "WEEKLY", anchor);
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

  return (
    <Card title="How an order bills" meta={`starting today, ${dayYear(today)}`}>
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Monthly · first invoice">
          {dayYear(monthly.start)} – {dayYear(monthly.end)}
          <span className="block text-micro text-ink-faint">
            {percent(monthly.fraction)} of a month&rsquo;s rate
          </span>
        </Field>
        <Field label="Monthly · then">
          {dayYear(monthly.nextBillingDate)}
          <span className="block text-micro text-ink-faint">
            a whole month, and on that day after
          </span>
        </Field>
        <Field label="Weekly · first invoice">
          {dayYear(weekly.start)} – {dayYear(weekly.end)}
          <span className="block text-micro text-ink-faint">
            {percent(weekly.fraction)} of a week&rsquo;s rate
          </span>
        </Field>
        <Field label="Weekly · then">
          {dayYear(weekly.nextBillingDate)}
          <span className="block text-micro text-ink-faint">
            every {WEEKDAY_LABEL[anchor.weekly]} through{" "}
            {dayYear(addDays(weekly.nextBillingDate, 6))}
          </span>
        </Field>
      </div>

      <ul className="mx-4 mb-4 flex flex-col gap-1 rounded-well bg-sunken p-2 text-detail text-ink-muted">
        <li>
          <span className="font-bold text-ink">Rental</span> — a term; bills
          monthly or weekly.
        </li>
        <li>
          <span className="font-bold text-ink">Cloud</span> — a term; bills
          monthly or weekly.
        </li>
        <li>
          <span className="font-bold text-ink">Rent to own</span> — a term;
          always monthly.
        </li>
        <li>
          <span className="font-bold text-ink">Sale</span> — no term. An order
          date, billed once.
        </li>
      </ul>
    </Card>
  );
}

/**
 * What every kind of record is numbered, and what it will be numbered next.
 * Seeded with the formats in use today, so nothing changes until a pattern is
 * edited (lib/numbering/format.ts).
 */
async function NumberingCard() {
  const rules = await getNumbering();
  const year = businessToday().getUTCFullYear();
  const highest = Object.fromEntries(
    await Promise.all(
      NUMBER_KINDS.map(async (kind) => [
        kind,
        (await highestIssued(kind, rules[kind], year)).highest,
      ]),
    ),
  ) as Record<NumberKind, number>;

  return (
    <Card title="Numbering" meta="orders, quotes, invoices and the rest">
      <NumberingForm rules={rules} highest={highest} year={year} />
    </Card>
  );
}
