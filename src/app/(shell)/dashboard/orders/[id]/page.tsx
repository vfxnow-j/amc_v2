import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  ActivityCard,
  Card,
  CardSkeleton,
  LinesCard,
} from "@/components/reservations/record-cards";
import { CheckoutPanel } from "@/components/reservations/checkout-panel";
import { CheckinSession } from "@/components/orders/checkin-session";
import { OrderOptions } from "@/components/orders/order-options";
import { getOrderOptions } from "@/lib/queries/packages";
import { PACKAGE_EDITABLE_STATUSES } from "@/lib/types";
import { ExtendOrder } from "@/components/orders/extend-order";
import { extensionLines } from "@/lib/queries/extension";
import { unitsOutOn } from "@/lib/queries/checkin";
import {
  CommercialDetailsCard,
  MarginStrip,
  MarginStripSkeleton,
  RtoTermsCard,
} from "@/components/orders/commercial-cards";
import { OrderBillingCard } from "@/components/orders/billing-card";
import { OrderDocumentsCard } from "@/components/orders/documents-card";
import { ShippingCard } from "@/components/orders/shipping-card";
import { ConversionCard } from "@/components/tracker/conversion-card";
import { getSessionUser } from "@/lib/roles";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { OrderActionBar } from "@/components/orders/order-action-bar";
import { StageStrip, StageStripSkeleton } from "@/components/orders/stage-strip";
import { getReservationHeader } from "@/lib/queries/reservation-record";
import {
  ARCHIVE_STATUSES,
  STATUS_LABEL,
  TYPE_LABEL,
} from "@/lib/reservations/status";
import type { ReservationStatus, ReservationType } from "@/generated/prisma/client";
import {
  anchorOnOrBefore,
  businessToday,
  isAnchoredCycle,
  periodFromAnchor,
} from "@/lib/billing/calendar";
import { getBillingAnchor } from "@/lib/settings/business";

type Params = { params: Promise<{ id: string }> };

/** States in which checkoutReservationItem will accept a scan. */
const CHECKOUT_STATES: ReservationStatus[] = ["PREPARING", "SHIPPED", "ACTIVE"];

/** The types that carry cost, margin and payment terms of their own. */
const COMMERCIAL_TYPES: ReservationType[] = ["SALE", "RENT_TO_OWN"];

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

/**
 * What an order's two dates are called, by type. A sale has no term — only the
 * day it was ordered — and only a rental has a date anything comes back on.
 */
function dateStamps(
  header: {
    type: ReservationType;
    start: Date;
    end: Date;
    isRecurring: boolean;
  },
  /** The billing period running today, for a recurring rental or cloud order. */
  period: { start: Date; end: Date } | null,
): { label: string; value: string }[] {
  const start = DAY.format(header.start);
  const end = DAY.format(header.end);
  const term = termLength(header.start, header.end);
  // A recurring order's stored end date is its first period's, and nothing
  // moves it: "Period ends Mar 31" on an order still out in September. The
  // period that matters is the one running now.
  if (period && header.type !== "RENT_TO_OWN") {
    return [
      { label: header.type === "CLOUD" ? "Started" : "Went out", value: start },
      {
        label: header.type === "CLOUD" ? "Renews" : "Period ends",
        value: DAY.format(period.end),
      },
      { label: "Term", value: "Rolling, until returned" },
    ];
  }
  switch (header.type) {
    case "SALE":
      return [{ label: "Ordered", value: start }];
    case "RENT_TO_OWN":
      return [
        { label: "Starts", value: start },
        { label: "Ends", value: end },
        { label: "Term", value: term },
      ];
    case "CLOUD":
      return [
        { label: "Starts", value: start },
        { label: "Renews", value: end },
        { label: "Term", value: term },
      ];
    default:
      return [
        { label: "Goes out", value: start },
        { label: header.isRecurring ? "Period ends" : "Due back", value: end },
        { label: "Term", value: term },
      ];
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getReservationHeader(id);
  return { title: header?.reservationNumber ?? "Order" };
}

/**
 * Operate → Orders → the record. One record per order, whatever kind it is.
 *
 * There used to be two. The order record answered the operational questions —
 * what is pulled, what is out, when does it come back — and a separate contract
 * record at the old /dashboard/sales/[id] answered the commercial ones for
 * sales and rent-to-owns. The same order had two pages, each linking to the
 * other, neither complete.
 *
 * Now the type decides which fields appear, which is what a type is for:
 *
 * - every order gets the handover strip, the lines, activity and notes;
 * - a sale or a rent-to-own additionally gets cost, margin and commercial
 *   terms, and an RTO gets its financing schedule;
 * - check-out and check-in are offered only where there are physical units to
 *   scan and the order is far enough along to accept one — which is a fact
 *   about the order, not about its type, so a cloud order with hardware on it
 *   still gets the panel.
 *
 * A card per Suspense boundary: the activity log and the margin figures never
 * hold up the lines.
 */
export default async function OrderRecordPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ option?: string }> }) {
  const { id } = await params;
  const { option: optionParam } = await searchParams;
  const header = await getReservationHeader(id);
  if (!header) notFound();

  // Quote options (the order's packages). The one viewed is the URL's, else the
  // one the order goes ahead with.
  const options = await getOrderOptions(id);
  const viewedOption =
    options.find((option) => option.id === optionParam) ??
    options.find((option) => option.isActive) ??
    options[0];
  const optionsEditable = PACKAGE_EDITABLE_STATUSES.includes(header.status);

  const { progress } = header;
  // The counters are cumulative — check-in never decrements checkedOutCount —
  // so what is actually with the client is the difference. A unit checked out,
  // returned and sent out again counts twice in `out`, which is why this is the
  // only figure the panel derives rather than displaying raw.
  const outNow = Math.max(0, progress.out - progress.returned);
  const outstanding = Math.max(0, progress.ordered - outNow);

  const user = await getSessionUser();
  const commercial = COMMERCIAL_TYPES.includes(header.type);
  // The billing period running today (or the first one, before the start),
  // on the business anchor — what a recurring order's dates should read.
  const anchor = await getBillingAnchor();
  const periodDay = (() => {
    const today = businessToday();
    return header.start > today ? header.start : today;
  })();
  const currentPeriod =
    header.isRecurring && isAnchoredCycle(header.cycle)
      ? periodFromAnchor(anchorOnOrBefore(periodDay, header.cycle, anchor), header.cycle, anchor)
      : null;
  const isRto = header.type === "RENT_TO_OWN";
  const hasUnits = progress.ordered > 0;
  const unitsOut = hasUnits ? await unitsOutOn(header.id) : [];
  // A fixed-term rental that is out: its return date is real, so it can run
  // late and can be extended. Monthly and weekly rentals recur instead.
  const fixedTermOut =
    header.type === "RENTAL" &&
    !header.isRecurring &&
    (header.status === "ACTIVE" || header.status === "SHIPPED");

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
            {/* What the client sees, at whatever stage the order is — a draft
                before it is sent, the live page once it is, what their link
                says after they answer. A preview: no link is issued and nothing
                is marked viewed (app/quote/preview). */}
            <a
              href={`/quote/preview/${header.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink transition-colors hover:bg-row-hover"
            >
              View online quote
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {STATUS_LABEL[header.status]}
            </span>
            <span className="text-page-title text-[20px] tabular-nums">
              {MONEY.format(header.totals.total)}
            </span>
          </>
        }
      />

      {/* Every stage it has passed through, and the move out of the one it is
          at. Both read the same lifecycle map, so the line and the button can
          never disagree about where the order is. */}
      <Suspense fallback={<StageStripSkeleton />}>
        <StageStrip id={id} />
      </Suspense>

      {/* The term and the handover, in one strip and before any card has to
          load. The dates belong beside the counts they govern: "4 of 9 still to
          go out" means something different the day before the start date than
          it does a week after it. */}
      <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-panel px-4 py-3 shadow-sm">
        {dateStamps(header, currentPeriod).map((stamp) => (
          <Stamp key={stamp.label} label={stamp.label} value={stamp.value} />
        ))}
        <span aria-hidden className="h-7 w-px bg-hairline" />
        <Progress label="Ordered" value={progress.ordered} />
        <Progress label="Assigned" value={progress.assigned} />
        <Progress label="Out now" value={outNow} />
        <Progress label="Returned" value={progress.returned} />
        <p className="ml-auto max-w-[42ch] text-detail text-balance text-ink-muted">
          {handover(header, progress.ordered, outNow, outstanding)}
        </p>
      </section>

      {/* Type-dependent: only a sale or a rent-to-own has a cost and a margin. */}
      {commercial ? (
        <Suspense fallback={<MarginStripSkeleton />}>
          <MarginStrip id={id} />
        </Suspense>
      ) : null}

      {/* The options the client chooses between on the online quote. Shown
          while options can still change, and afterwards only when there was
          more than one to choose from. */}
      {viewedOption && (optionsEditable || options.length > 1) ? (
        <OrderOptions
          reservationId={id}
          options={options}
          selectedId={viewedOption.id}
          editable={optionsEditable}
        />
      ) : null}

      <div className="grid flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* Lines can be taken off while the order is still live. The ported
            action refuses on a closed order, so the control is not offered on
            one either — the screen and the server agree rather than the screen
            offering something that will be refused. */}
        <Suspense fallback={<CardSkeleton title="Lines" rows={10} />}>
          <LinesCard
            id={id}
            editable={!ARCHIVE_STATUSES.includes(header.status)}
            window={{
              start: header.start.toISOString(),
              end: header.end.toISOString(),
            }}
            option={
              viewedOption
                ? { id: viewedOption.id, name: viewedOption.name, several: options.length > 1 }
                : undefined
            }
          />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {/* The moves sit directly above the scan well, in the order the work
              happens: prepare the order, then scan units out against it. */}
          <Suspense fallback={<CardSkeleton title="Move it on" rows={2} />}>
            <OrderActionBar id={id} type={header.type} />
          </Suspense>

          {/* Whether the quote is cleared to go to the client, and the trail of
              asks and answers (docs/procurement.md, Phase 6). Quiet on orders
              quoted before approvals existed. */}
          <Suspense fallback={null}>
            <ApprovalCard
              type="QUOTE"
              id={id}
              viewer={user}
              act={
                header.status === "DRAFT" || header.status === "REVISION"
                  ? "sending it to the client"
                  : "committing the order"
              }
              quietWhenUnrecorded
            />
          </Suspense>

          {/* What this order may be the answer to — open asks and recent buying
              conversations on the account. Renders nothing when there are none. */}
          <Suspense fallback={null}>
            <ConversionCard id={id} canEdit={!!user && user.role !== "VIEWER"} />
          </Suspense>

          {/* checkoutReservationItem refuses before PREPARING, and an order with
              no asset-backed lines has nothing to scan either way — so the panel
              is only offered where it can actually work. */}
          {/* A fixed-term rental that is out: when it is due back or how late
              it is, and Extend (monthly and weekly rentals recur instead). */}
          {fixedTermOut ? (
            <ExtendOrder
              reservationId={header.id}
              endDate={header.end.toISOString()}
              lines={await extensionLines(header.id)}
            />
          ) : null}

          {hasUnits && CHECKOUT_STATES.includes(header.status) ? (
            <>
              {/* Out with the client: getting it back is the job now, so the
                  check-in session comes first. It lists the units actually
                  attached and out — the physical record, not the line
                  counters, which drift on imported orders. */}
              {unitsOut.length > 0 ? (
                <CheckinSession reservationId={header.id} out={unitsOut} />
              ) : null}
              <CheckoutPanel reservationId={header.id} />
            </>
          ) : hasUnits ? (
            <Card title="Check out">
              <p className="px-4 pb-4 text-body text-ink-muted">
                This order is {STATUS_LABEL[header.status].toLowerCase()}. Units
                can be scanned out against its lines once it starts preparing —
                use Prepare order above.
              </p>
            </Card>
          ) : null}

          {isRto ? (
            <Suspense fallback={<CardSkeleton title="Rent-to-own terms" rows={4} />}>
              <RtoTermsCard id={id} />
            </Suspense>
          ) : null}

          {/* One card: what it bills on, and what it has billed. The type
              changes only the closing sentence — see billing-card.tsx. */}
          <Suspense fallback={<CardSkeleton title="Billing" rows={6} />}>
            <OrderBillingCard id={id} type={header.type} />
          </Suspense>

          {commercial ? (
            <Suspense fallback={<CardSkeleton title="Commercial terms" rows={4} />}>
              <CommercialDetailsCard id={id} />
            </Suspense>
          ) : null}

          {/* A cloud order has nothing to ship. Everything else does, even when
              the client collects it — "customer collects" is an answer, and the
              absence of one is what this card exists to make visible. */}
          {header.type !== "CLOUD" ? (
            <Suspense fallback={<CardSkeleton title="Shipping" rows={6} />}>
              <ShippingCard id={id} canEdit={user?.role !== "VIEWER"} />
            </Suspense>
          ) : null}

          {/* The paperwork, next to the billing it belongs with — a signed
              quote is the document that says the client agreed to those
              numbers. */}
          <Suspense fallback={<CardSkeleton title="Documents" rows={3} />}>
            <OrderDocumentsCard id={id} status={header.status} />
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

/** Label over value, for a date rather than a count. */
function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-body font-bold">{value}</span>
    </span>
  );
}

/** How long the order runs, said the way a person would say it. */
function termLength(start: Date, end: Date): string {
  const days = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000),
  );
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  const months = Math.round(days / 30);
  return `${months} months`;
}

/**
 * Where the order is against its own dates.
 *
 * The one thing this must not do is call a recurring order late. A recurring
 * order's `endDate` is the end of a **billing period**, not a return date —
 * counting them as returns once read 214 units overdue against a real 35 — so
 * a recurring order is never described as due back or overdue here, whatever
 * its end date says.
 */
function handover(
  header: { type: ReservationType; start: Date; end: Date; isRecurring: boolean },
  ordered: number,
  outNow: number,
  outstanding: number,
): string {
  if (ordered === 0) return "No physical units on this order";

  const now = Date.now();
  const days = (to: Date) => Math.round((to.getTime() - now) / 86_400_000);

  if (outstanding > 0) {
    const until = days(header.start);
    const when =
      until > 1
        ? `, ${until} days before it goes out`
        : until === 1
          ? ", due out tomorrow"
          : until === 0
            ? ", due out today"
            : `, ${Math.abs(until)} days past the start date`;
    return `${outstanding} of ${ordered} still to go out${when}`;
  }

  // Nothing on a sale comes back, and a rent-to-own or cloud term ends in
  // ownership or renewal — neither has a return date to be early or late for.
  if (header.type === "SALE") return `All ${ordered} handed over`;

  if (outNow === 0) return `All ${ordered} back`;

  if (header.type === "RENT_TO_OWN" || header.type === "CLOUD") {
    return `${outNow} of ${ordered} with the client, on a term — its end date is not a return`;
  }

  if (header.isRecurring) {
    return `${outNow} of ${ordered} with the client, on a recurring order — its end date is a billing period, not a return`;
  }

  const left = days(header.end);
  if (left > 1) return `${outNow} of ${ordered} with the client, back in ${left} days`;
  if (left === 1) return `${outNow} of ${ordered} with the client, back tomorrow`;
  if (left === 0) return `${outNow} of ${ordered} with the client, back today`;
  return `${outNow} of ${ordered} still out, ${Math.abs(left)} days past the return date`;
}
