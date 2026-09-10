import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  POAssetsCard,
  POCostsCard,
  PODocumentsCard,
  POLinesCard,
} from "@/components/revenue/po-cards";
import { ReceivePanel } from "@/components/revenue/receive-panel";
import { dayYear, moneyExact } from "@/lib/format";
import {
  getPOHeader,
  getPOLines,
  getReceivingLocations,
} from "@/lib/queries/po-record";
import { PO_STATUS_LABEL } from "@/lib/revenue/labels";

type Params = { params: Promise<{ id: string }> };

/** The states in which `receivePurchaseOrder` will accept a receipt. */
const RECEIVABLE = ["SUBMITTED", "PARTIAL"];

const ORDER_TYPE_LABEL: Record<string, string> = {
  HARDWARE_RENTAL: "Hardware to rent out",
  HARDWARE_RENTAL_COMPONENTS: "Components for rental hardware",
  HARDWARE_RESALE: "Hardware to resell",
  HARDWARE_RESALE_COMPONENTS: "Components for resale hardware",
};

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CREDIT: "Credit card",
  LOAN: "Lease or loan",
  EXCHANGE: "Transfer",
  VENDOR_CREDIT: "Vendor credit",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getPOHeader(id);
  return { title: header?.poNumber ?? "Purchase order" };
}

/**
 * Revenue → Purchase orders → the record.
 *
 * The screen where bought hardware becomes bookable stock. Receiving is the
 * whole point of it, so the receive panel is offered wherever the ported action
 * will accept one, and the header leads with the outstanding count rather than
 * with the money — a PO half received has hardware standing on a loading dock
 * that nothing in the app can book.
 *
 * `receivePurchaseOrder` refuses outside SUBMITTED and PARTIAL, so the panel is
 * only offered where it can work, and the card that replaces it says which step
 * is missing rather than leaving a gap.
 */
export default async function PurchaseOrderRecordPage({ params }: Params) {
  const { id } = await params;
  const po = await getPOHeader(id);
  if (!po) notFound();

  const receivable = RECEIVABLE.includes(po.status);

  return (
    <>
      <PageHeader
        eyebrow="Accounting · Purchase order"
        title={po.poNumber}
        blurb={
          <>
            <Link
              href={`/dashboard/vendors/${po.vendor.id}`}
              className="text-accent-text hover:underline"
            >
              {po.vendor.name}
            </Link>
            {" · ordered "}
            {dayYear(po.orderDate)}
            {po.expectedDate ? ` · expected ${dayYear(po.expectedDate)}` : ""}
            {po.receivedDate ? ` · received ${dayYear(po.receivedDate)}` : ""}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {PO_STATUS_LABEL[po.status]}
            </span>
            <a
              href={`/dashboard/purchase-orders/${po.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              PDF
            </a>
          </>
        }
      />

      <section className="flex items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Ordered" value={String(po.ordered)} />
        <Figure label="Received" value={String(po.received)} />
        <Figure
          label="Outstanding"
          value={String(po.outstanding)}
          loud
          alarm={po.outstanding > 0 && receivable}
        />
        <Figure label="Committed" value={moneyExact(po.total)} />
        <p className="ml-auto max-w-[46ch] text-detail text-balance text-ink-muted">
          {po.ordered === 0
            ? "Nothing is on this order yet."
            : po.outstanding === 0
              ? `All ${po.ordered} received across ${po.lineCount} ${po.lineCount === 1 ? "line" : "lines"}.`
              : receivable
                ? `${po.outstanding} of ${po.ordered} still with the vendor.`
                : po.status === "DRAFT"
                  ? `${po.ordered} on order across ${po.lineCount} ${po.lineCount === 1 ? "line" : "lines"}, not yet sent to the vendor.`
                  : `${po.outstanding} of ${po.ordered} never arrived — this PO was canceled.`}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Lines" rows={8} />}>
          <POLinesCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {receivable ? (
            <Suspense fallback={<CardSkeleton title="Receive" rows={5} />}>
              <Receiving id={id} shipToId={po.shipToLocation?.id ?? null} />
            </Suspense>
          ) : (
            <Card title="Receive">
              <p className="px-4 pb-4 text-body text-ink-muted">
                {po.status === "DRAFT"
                  ? "This PO is still a draft. Submit it to the vendor and hardware can be booked in against it."
                  : po.status === "RECEIVED"
                    ? `Everything on this PO has been received${po.receivedDate ? ` — ${dayYear(po.receivedDate)}` : ""}.`
                    : "This PO is canceled. Nothing further can be received against it."}
              </p>
            </Card>
          )}

          <Suspense fallback={<CardSkeleton title="Cost" rows={4} />}>
            <POCostsCard
              id={id}
              subtotal={po.subtotal}
              discountAmount={po.discountAmount}
              freightAmount={po.freightAmount}
              feesTotal={po.feesTotal}
              taxAmount={po.taxAmount}
              taxExempt={po.taxExempt}
              total={po.total}
            />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Created" rows={3} />}>
            <POAssetsCard id={id} />
          </Suspense>

          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Ship to">
                {po.shipToLocation?.name ?? <Unset>Not set</Unset>}
              </Field>
              <Field label="Bought as">
                {po.orderType ? (
                  ORDER_TYPE_LABEL[po.orderType] ?? po.orderType
                ) : (
                  <Unset>Not recorded</Unset>
                )}
              </Field>
              <Field label="Paid by">
                {po.purchaseMethod ? (
                  <>
                    {METHOD_LABEL[po.purchaseMethod] ?? po.purchaseMethod}
                    {po.creditTerms ? (
                      <span className="text-ink-muted"> · {po.creditTerms}</span>
                    ) : null}
                  </>
                ) : (
                  // Nothing to guess from: units received off a PO with no
                  // method are booked as cash-owned by the ported action.
                  <Unset>Not recorded — units land as cash-owned</Unset>
                )}
              </Field>
              <Field label="Vendor contact">
                {po.vendor.contactEmail ?? po.vendor.contactName ?? (
                  <Unset>None on file</Unset>
                )}
              </Field>
            </div>
            {po.notes ? (
              <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
                {po.notes}
              </p>
            ) : null}
          </Card>

          <Suspense fallback={<CardSkeleton title="Documents" rows={3} />}>
            <PODocumentsCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

/**
 * The receive panel, with only the lines that still have something to come.
 *
 * A fully received line on a partially received PO is noise at the moment
 * somebody is counting a pallet, and leaving it in invites a second receipt
 * against it — which the action would refuse, but only after the count was
 * typed.
 */
async function Receiving({
  id,
  shipToId,
}: {
  id: string;
  shipToId: string | null;
}) {
  const [lines, locations] = await Promise.all([
    getPOLines(id),
    getReceivingLocations(),
  ]);
  const outstanding = lines.filter((line) => line.remaining > 0);

  if (outstanding.length === 0) {
    return (
      <Card title="Receive">
        <p className="px-4 pb-4 text-body text-ink-muted">
          Every line has been received in full, but the PO has not been closed.
          Nothing further can be booked in against it.
        </p>
      </Card>
    );
  }

  if (locations.length === 0) {
    return (
      <Card title="Receive">
        <p className="px-4 pb-4 text-body text-ink-muted">
          There is nowhere to receive into. Add a location before booking
          hardware in, so a unit is never in stock with no idea where it is.
        </p>
      </Card>
    );
  }

  return (
    <ReceivePanel
      purchaseOrderId={id}
      locations={locations}
      defaultLocationId={shipToId}
      lines={outstanding.map((line) => ({
        id: line.id,
        description: line.description,
        remaining: line.remaining,
        mode: line.mode,
      }))}
    />
  );
}

function Figure({
  label,
  value,
  loud,
  alarm,
}: {
  label: string;
  value: string;
  loud?: boolean;
  alarm?: boolean;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"} ${
          alarm ? "text-accent-text" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}
