import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  ActivityCard,
  BillingCard,
  Card,
  CardSkeleton,
  LinesCard,
} from "@/components/reservations/record-cards";
import { CheckoutPanel } from "@/components/reservations/checkout-panel";
import { getReservationHeader } from "@/lib/queries/reservation-record";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";
import type { ReservationStatus } from "@/generated/prisma/client";

type Params = { params: Promise<{ id: string }> };

/** States in which checkoutReservationItem will accept a scan. */
const CHECKOUT_STATES: ReservationStatus[] = ["PREPARING", "SHIPPED", "ACTIVE"];

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getReservationHeader(id);
  return { title: header?.reservationNumber ?? "Order" };
}

/**
 * Operate → Reservations → the record.
 *
 * This is where check-out and check-in live, rather than on a separate desk:
 * the lines, the assigned units, the rates and the sign-off are all already
 * here, and a second surface would be a second place to keep them right.
 *
 * A card per Suspense boundary — the activity log and the invoice list never
 * hold up the lines.
 */
export default async function ReservationRecordPage({ params }: Params) {
  const { id } = await params;
  const header = await getReservationHeader(id);
  if (!header) notFound();

  const { progress } = header;
  // The counters are cumulative — check-in never decrements checkedOutCount —
  // so what is actually with the client is the difference. A unit checked out,
  // returned and sent out again counts twice in `out`, which is why this is the
  // only figure the panel derives rather than displaying raw.
  const outNow = Math.max(0, progress.out - progress.returned);
  const outstanding = Math.max(0, progress.ordered - outNow);

  return (
    <>
      <PageHeader
        eyebrow={`Operate · ${TYPE_LABEL[header.type]}`}
        title={header.reservationNumber}
        blurb={
          <>
            <Link
              href={`/dashboard/clients/${header.client.id}`}
              className="text-accent-text hover:underline"
            >
              {header.client.name}
            </Link>
            {header.projectName ? ` · ${header.projectName}` : ""} ·{" "}
            {DAY.format(header.start)} – {DAY.format(header.end)}
            {header.isRecurring ? " · recurring" : ""}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {STATUS_LABEL[header.status]}
            </span>
            <span className="text-page-title text-[20px] tabular-nums">
              {MONEY.format(header.totals.total)}
            </span>
          </>
        }
      />

      {/* Handover at a glance, before any card has to load. */}
      <section className="flex items-center gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Progress label="Ordered" value={progress.ordered} />
        <Progress label="Assigned" value={progress.assigned} />
        <Progress label="Out now" value={outNow} />
        <Progress label="Returned" value={progress.returned} />
        <p className="ml-auto text-detail text-ink-muted">
          {progress.ordered === 0
            ? "No physical units on this order"
            : outstanding > 0
              ? `${outstanding} of ${progress.ordered} still to go out`
              : `${outNow} of ${progress.ordered} still with the client`}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Lines" rows={10} />}>
          <LinesCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {/* checkoutReservationItem refuses before PREPARING, so the panel is
              only offered where it can actually work. */}
          {CHECKOUT_STATES.includes(header.status) ? (
            <CheckoutPanel reservationId={header.id} />
          ) : (
            <Card title="Check out">
              <p className="px-4 pb-4 text-body text-ink-muted">
                This order is {STATUS_LABEL[header.status].toLowerCase()}. Units
                can be scanned out once it starts preparing.
              </p>
            </Card>
          )}

          <Suspense fallback={<CardSkeleton title="Billing" rows={3} />}>
            <BillingCard id={id} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Activity" rows={5} />}>
            <ActivityCard id={id} />
          </Suspense>
          {header.notes || header.internalNotes ? (
            <Card title="Notes">
              <div className="flex flex-col gap-2 px-4 pb-4 text-detail">
                {header.notes ? (
                  <p className="whitespace-pre-line">{header.notes}</p>
                ) : null}
                {header.internalNotes ? (
                  <p className="whitespace-pre-line rounded-well bg-sunken p-2 text-ink-muted">
                    <span className="text-micro uppercase">Internal</span>
                    <br />
                    {header.internalNotes}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex min-w-[86px] flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em]">
        {value}
      </span>
    </span>
  );
}
