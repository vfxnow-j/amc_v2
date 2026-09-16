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
  POUnitsCard,
} from "@/components/accounting/po-cards";
import { POControls } from "@/components/procurement/po-controls";
import { POFinancingCard } from "@/components/procurement/po-financing";
import { dayYear, moneyExact } from "@/lib/format";
import { getPOHeader, getPOLines } from "@/lib/queries/po-record";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { PO_METHOD_LABEL, PO_ORDER_TYPE_LABEL } from "@/lib/procurement/po-labels";
import { getPOFinancing } from "@/lib/procurement/po-queries";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

type Params = { params: Promise<{ id: string }> };

/** The states in which `receivePurchaseOrder` will accept a receipt. */
const RECEIVABLE = ["SUBMITTED", "PARTIAL"];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getPOHeader(id);
  return { title: header?.poNumber ?? "Purchase order" };
}

/**
 * Procurement → Purchase orders → the record.
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
 *
 * The record also carries the middle of the trail a unit reads back — which
 * funding requests cite this PO and which loan pays for it — and the controls
 * that move the PO along. Both are admin writes; everyone who can open the
 * record can read them.
 */
export default async function PurchaseOrderRecordPage({ params }: Params) {
  const { id } = await params;
  const [po, user] = await Promise.all([getPOHeader(id), getSessionUser()]);
  if (!po) notFound();
  const admin = user ? isAdminRole(user.role) : false;

  const receivable = RECEIVABLE.includes(po.status);

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Purchase order"
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
              className="h-9 rounded-pill bg-sunken px-3 text-pill leading-9 text-ink hover:bg-row-hover"
            >
              PDF
            </a>
            {admin ? (
              <POControls
                id={po.id}
                poNumber={po.poNumber}
                status={po.status}
                outstanding={po.outstanding}
                unitsReceived={po.unitsReceived}
              />
            ) : null}
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

      <div className="grid flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Lines" rows={8} />}>
          <POLinesCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {receivable ? (
            <Suspense fallback={<CardSkeleton title="Receive" rows={3} />}>
              <Receiving id={id} canReceive={admin} />
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

          <Suspense fallback={<CardSkeleton title="Funding & loan" rows={3} />}>
            <Financing id={id} canEdit={admin} />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Units received" rows={4} />}>
            <POUnitsCard id={id} received={po.received} />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Models created" rows={3} />}>
            <POAssetsCard id={id} />
          </Suspense>

          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Ship to">
                {po.shipToLocation?.name ?? <Unset>Not set</Unset>}
              </Field>
              <Field label="Bought as">
                {po.orderType ? (
                  PO_ORDER_TYPE_LABEL[po.orderType] ?? po.orderType
                ) : (
                  <Unset>Not recorded</Unset>
                )}
              </Field>
              <Field label="Paid by">
                {po.purchaseMethod ? (
                  <>
                    {PO_METHOD_LABEL[po.purchaseMethod] ?? po.purchaseMethod}
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
 * What is still to come, and the way in to receiving it.
 *
 * Receiving has its own screen now — it is where models and units are created,
 * and a pallet of forty units does not fit in a side panel — so the record
 * says what is outstanding, line by line, and hands off.
 */
async function Receiving({ id, canReceive }: { id: string; canReceive: boolean }) {
  const lines = await getPOLines(id);
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

  const unlinked = outstanding.filter((line) => line.mode === "unlinked").length;

  return (
    <Card
      title="Receive"
      meta={`${outstanding.length} ${outstanding.length === 1 ? "line" : "lines"} still to come`}
      action={
        canReceive ? (
          <Link
            href={`/dashboard/purchase-orders/${id}/receive`}
            className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
          >
            Receive hardware
          </Link>
        ) : null
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-2">
        {outstanding.map((line) => (
          <li
            key={line.id}
            className="grid grid-cols-[minmax(0,1fr)_56px] items-baseline gap-2 rounded-row px-2 py-1 text-detail"
          >
            <span className="truncate">{line.description}</span>
            <span className="text-right tabular-nums text-ink-muted">{line.remaining}</span>
          </li>
        ))}
      </ul>
      {unlinked > 0 ? (
        <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
          {unlinked === 1 ? "One fleet line has" : `${unlinked} fleet lines have`} no
          model yet — receiving creates {unlinked === 1 ? "it" : "them"}, with the
          build if there is one.
        </p>
      ) : null}
    </Card>
  );
}

/** Read on the server, changed on the client. */
async function Financing({ id, canEdit }: { id: string; canEdit: boolean }) {
  const financing = await getPOFinancing(id);
  if (!financing) return null;
  return <POFinancingCard poId={id} canEdit={canEdit} {...financing} />;
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
