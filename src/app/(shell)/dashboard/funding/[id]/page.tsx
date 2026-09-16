import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardEmpty, CardSkeleton, Unset } from "@/components/record/record-card";
import {
  FundingDocumentsCard,
  Grid,
  Prose,
  Value,
  moneyOrNull,
} from "@/components/procurement/funding-cards";
import { FundingEvidence } from "@/components/procurement/funding-evidence";
import { FundingLifecycle } from "@/components/procurement/funding-lifecycle";
import { FundingMarkers } from "@/components/procurement/funding-markers";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { dayYear, moneyExact } from "@/lib/format";
import {
  CUSTOMER_COMMITMENT_LABEL,
  FUNDING_CAN_RAISE_PO,
  FUNDING_LOCKED,
  FUNDING_PURCHASE_TYPE_LABEL,
  FUNDING_STATUS_LABEL,
} from "@/lib/procurement/funding-labels";
import {
  getFundingAttachOptions,
  getFundingLeases,
  getFundingRecord,
  type FundingRecord,
} from "@/lib/queries/funding";
import { STATUS_LABEL as ORDER_STATUS_LABEL, TYPE_LABEL as ORDER_TYPE_LABEL } from "@/lib/reservations/status";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { computeFundingMetrics } from "@/lib/utils/funding";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const record = await getFundingRecord(id);
  return { title: record?.requestNumber ?? "Funding request" };
}

/**
 * Procurement → Funding requests → the record.
 *
 * The left column is the paper form, section by section, as the requester
 * filled it. The right column is what happened to it: where it is in its
 * lifecycle and the controls to move it, who signed off, the loan that paid
 * for it, and the evidence behind it — the purchase orders it funds and the
 * client orders that justify it.
 *
 * The payback markers are computed from the request's own figures and are
 * labelled as the requester's estimates. Nothing on this screen is a measured
 * return; the rental that would earn it hasn't billed when the request is
 * written.
 *
 * Money figures shown are the request's own (asked, itemised, borrowed) and
 * each PO's own total. None is summed across the attachments: a PO can back
 * more than one request, so its total is not this request's to add up.
 */
export default async function FundingRequestRecordPage({ params }: Params) {
  const { id } = await params;
  const [record, user] = await Promise.all([getFundingRecord(id), getSessionUser()]);
  if (!record) notFound();

  const admin = !!user && isAdminRole(user.role);
  const locked = FUNDING_LOCKED.includes(record.status);
  const canRaisePO = admin && FUNDING_CAN_RAISE_PO.includes(record.status);

  const metrics = computeFundingMetrics({
    totalEquipmentCost: record.totalEquipmentCost,
    amountRequested: record.amountRequested,
    amountBorrowed: record.amountBorrowed,
    financingFees: record.financingFees,
    estimatedTotalInterest: record.estimatedTotalInterest,
    monthlyPayment: record.monthlyPayment,
    customerRentalRate: record.customerRentalRate,
    billableUnits: record.billableUnits,
    customerRentalCharge: record.customerRentalCharge,
    expectedInitialRevenue: record.expectedInitialRevenue,
    expectedGrossProfit: record.expectedGrossProfit,
    expectedAnnualRevenue: record.expectedAnnualRevenue,
    estimatedResaleValue: record.estimatedResaleValue,
    estimatedPaybackMonths: record.estimatedPaybackMonths,
    expectedHoldMonths: record.expectedHoldMonths,
  });

  const customer = record.client?.name ?? record.projectName ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Funding request"
        title={record.requestNumber}
        blurb={
          <>
            {record.client ? (
              <Link
                href={`/dashboard/clients/${record.client.id}`}
                className="text-accent-text hover:underline"
              >
                {record.client.name}
              </Link>
            ) : (
              (customer ?? "General inventory")
            )}
            {` · requested by ${record.requestedBy} · ${dayYear(record.requestDate)}`}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill whitespace-nowrap text-ink">
              {FUNDING_STATUS_LABEL[record.status]}
            </span>
            <a
              href={`/dashboard/funding/${record.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover"
            >
              PDF
            </a>
            {admin && !locked ? (
              <Link
                href={`/dashboard/funding/${record.id}/edit`}
                className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover"
              >
                Edit
              </Link>
            ) : null}
            {canRaisePO ? (
              <Link
                href={`/dashboard/purchase-orders/new?funding=${record.id}`}
                className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill whitespace-nowrap text-accent-on-solid transition-colors hover:bg-accent-800"
              >
                Raise a purchase order
              </Link>
            ) : null}
          </>
        }
      />

      <section className="flex flex-wrap items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Requested" value={moneyExact(record.amountRequested)} loud />
        <Figure
          label="Equipment itemised"
          value={record.items.length > 0 ? moneyExact(record.totalEquipmentCost) : "—"}
        />
        <Figure
          label="Needed by"
          value={record.neededByDate ? dayYear(record.neededByDate) : "—"}
        />
        <p className="ml-auto max-w-[52ch] text-detail text-balance text-ink-muted">
          {whereItStands(record)}
        </p>
      </section>

      <div className="grid flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Card title="1 · Request & purpose">
            <Grid>
              <Value
                label="Purchase type"
                value={record.purchaseType ? FUNDING_PURCHASE_TYPE_LABEL[record.purchaseType] : null}
              />
              <Value label="Requested by" value={record.requestedBy} />
              <Value label="Request date" value={dayYear(record.requestDate)} />
              <Value
                label="Needed by"
                value={record.neededByDate ? dayYear(record.neededByDate) : null}
              />
            </Grid>
            <Prose label="Business purpose" text={record.businessPurpose} />
          </Card>

          <EquipmentCard record={record} />

          <Card title="2 · Customer">
            <Grid>
              <Value
                label="Customer"
                value={
                  record.client ? (
                    <Link
                      href={`/dashboard/clients/${record.client.id}`}
                      className="text-accent-text hover:underline"
                    >
                      {record.client.name}
                    </Link>
                  ) : null
                }
              />
              <Value label="Project" value={record.projectName} />
              <Value
                label="Commitment"
                value={
                  record.customerCommitment
                    ? CUSTOMER_COMMITMENT_LABEL[record.customerCommitment]
                    : null
                }
              />
              <Value label="Payment terms" value={record.paymentTerms} />
              <Value
                label="Monthly rental charge"
                value={
                  metrics.monthlyRentalCharge !== null
                    ? `${moneyExact(metrics.monthlyRentalCharge)}${
                        record.customerRentalRate !== null && record.billableUnits
                          ? ` · ${record.billableUnits} × ${moneyExact(record.customerRentalRate)}`
                          : ""
                      }`
                    : null
                }
              />
              <Value
                label="Initial revenue, expected"
                value={moneyOrNull(record.expectedInitialRevenue)}
              />
              <Value label="Rental period" value={record.rentalPeriod} />
            </Grid>
          </Card>

          <Card title="3 · Financing terms">
            <Grid>
              <Value label="Lender or source" value={record.lender} />
              <Value label="Borrowed" value={moneyOrNull(record.amountBorrowed)} />
              <Value
                label="Interest rate"
                value={
                  record.interestRate === null
                    ? null
                    : `${(Math.round(record.interestRate * 10_000) / 100).toFixed(2)}%`
                }
              />
              <Value
                label="Term"
                value={record.termMonths !== null ? `${record.termMonths} months` : null}
              />
              <Value label="Monthly payment" value={moneyOrNull(record.monthlyPayment)} />
              <Value label="Origination & fees" value={moneyOrNull(record.financingFees)} />
              <Value
                label="Total interest, estimated"
                value={moneyOrNull(record.estimatedTotalInterest)}
              />
              <Value
                label="First payment"
                value={record.firstPaymentDate ? dayYear(record.firstPaymentDate) : null}
              />
              <Value
                label="Expected payoff"
                value={record.expectedPayoffDate ? dayYear(record.expectedPayoffDate) : null}
              />
            </Grid>
          </Card>

          <Card title="4 · Payback & asset plan" meta="as stated on the request">
            <Grid>
              <Value
                label="Gross profit, initial rental"
                value={moneyOrNull(record.expectedGrossProfit)}
              />
              <Value
                label="Payback, stated"
                value={
                  record.estimatedPaybackMonths !== null
                    ? `${record.estimatedPaybackMonths} months`
                    : null
                }
              />
              <Value
                label="Annual utilization"
                value={
                  record.expectedAnnualUtilization !== null
                    ? `${record.expectedAnnualUtilization}%`
                    : null
                }
              />
              <Value
                label="Hold period"
                value={
                  record.expectedHoldMonths !== null ? `${record.expectedHoldMonths} months` : null
                }
              />
              <Value
                label="Ongoing annual revenue"
                value={moneyOrNull(record.expectedAnnualRevenue)}
              />
              <Value label="Resale value" value={moneyOrNull(record.estimatedResaleValue)} />
            </Grid>
            <Prose label="Exit plan" text={record.exitPlan} />
            <div className="px-4 pb-4">
              <FundingMarkers metrics={metrics} />
            </div>
          </Card>

          <Card title="5 · Key risk & approval rationale">
            {record.alternateUsePlan || record.borrowRationale ? (
              <>
                <Prose
                  label="If the initial customer cancels"
                  text={record.alternateUsePlan}
                />
                <Prose
                  label="Why borrow rather than rent, lease or use stock"
                  text={record.borrowRationale}
                />
              </>
            ) : (
              <CardEmpty>
                Neither risk question is answered. Accounting reads these before
                approving — add them on the edit form.
              </CardEmpty>
            )}
          </Card>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Lifecycle" meta={FUNDING_STATUS_LABEL[record.status]}>
            {admin ? (
              <Suspense fallback={<div className="h-[40px]" />}>
                <Lifecycle record={record} userName={user?.name ?? ""} />
              </Suspense>
            ) : (
              <p className="px-4 pb-4 text-body text-ink-muted">
                Moving a request along is for administrators.
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-hairline px-4 py-3 text-detail">
              <Stamp
                label="Submitted"
                at={record.submittedAt}
                by={record.submittedBy}
              />
              <Stamp label="Approved" at={record.approvalDate} />
              <Stamp label="Funded" at={record.fundedAt} />
              <Stamp label="Fulfilled" at={record.fulfilledAt} />
            </dl>
            {record.declineReason ? (
              <Prose label="Declined because" text={record.declineReason} />
            ) : null}
          </Card>

          <Card title="Approvals">
            <Grid>
              <Value label="Operations" value={record.operationsApprovedBy} />
              <Value label="Finance" value={record.financeApprovedBy} />
              <Value label="Executive" value={record.executiveApprovedBy} />
              <Value
                label="Date"
                value={record.approvalDate ? dayYear(record.approvalDate) : null}
              />
            </Grid>
          </Card>

          <Card title="Funded by">
            {record.lease ? (
              <Link
                href={`/dashboard/leases/${record.lease.id}`}
                className="mx-2 mb-3 block rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="font-bold tabular-nums">{record.lease.leaseNumber}</span>
                <span className="text-ink-muted"> · {record.lease.leaseName}</span>
                <span className="block text-ink-faint">{record.lease.lender}</span>
              </Link>
            ) : (
              <CardEmpty>
                No loan is linked. It is named when the request is marked funded.
              </CardEmpty>
            )}
          </Card>

          <Suspense fallback={<CardSkeleton title="Purchase orders" rows={3} />}>
            <Evidence record={record} admin={admin} locked={locked} />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Documents" rows={2} />}>
            <FundingDocumentsCard id={record.id} />
          </Suspense>

          {record.notes ? (
            <Card title="Notes">
              <p className="whitespace-pre-line px-4 pb-4 text-body">{record.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** One sentence on what this request is waiting for. */
function whereItStands(record: FundingRecord): string {
  const pos = record.purchaseOrders.length;
  const received = record.purchaseOrders.filter((po) => po.status === "RECEIVED").length;
  switch (record.status) {
    case "DRAFT":
      return "A draft. Nothing goes to accounting until it is submitted.";
    case "SUBMITTED":
      return `With accounting since ${record.submittedAt ? dayYear(record.submittedAt) : "submission"}, waiting on a decision.`;
    case "APPROVED":
      return pos === 0
        ? "Approved, not yet funded, and no purchase order is attached."
        : `Approved, not yet funded. ${pos} purchase ${pos === 1 ? "order" : "orders"} attached.`;
    case "DECLINED":
      return "Declined. It can still be approved if the case changes.";
    case "FUNDED":
      return pos === 0
        ? "Funded. No purchase order is attached yet."
        : `Funded. ${received} of ${pos} attached purchase ${pos === 1 ? "order" : "orders"} received.`;
    case "FULFILLED":
      return `Closed out${record.fulfilledAt ? ` ${dayYear(record.fulfilledAt)}` : ""}.`;
    case "CANCELLED":
      return "Canceled.";
  }
}

function EquipmentCard({ record }: { record: FundingRecord }) {
  return (
    <Card
      title="2 · Equipment"
      meta={
        record.items.length > 0
          ? `${record.items.length} ${record.items.length === 1 ? "line" : "lines"} · ${moneyExact(record.totalEquipmentCost)}`
          : undefined
      }
    >
      {record.items.length === 0 ? (
        <CardEmpty>
          The equipment isn&rsquo;t itemised, so the markers use the amount
          requested as the hardware cost. Add lines on the edit form.
        </CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_56px_104px_104px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Amount</span>
          </div>
          <ul className="flex flex-col gap-[2px] px-2 pb-3">
            {record.items.map((item, index) => (
              <li
                key={item.id}
                className={`grid grid-cols-[1fr_56px_104px_104px] items-baseline gap-2 rounded-row p-2 text-detail ${index % 2 === 1 ? "bg-row-alt" : ""}`}
              >
                <span className="truncate">{item.description}</span>
                <span className="text-right tabular-nums">{item.quantity}</span>
                <span className="text-right tabular-nums text-ink-muted">{moneyExact(item.unitCost)}</span>
                <span className="text-right tabular-nums">{moneyExact(item.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Prose label="Equipment notes" text={record.equipmentSummary} />
    </Card>
  );
}

async function Lifecycle({ record, userName }: { record: FundingRecord; userName: string }) {
  const leases = await getFundingLeases();
  return (
    <FundingLifecycle
      id={record.id}
      status={record.status}
      currentUserName={userName}
      approvals={{
        operations: record.operationsApprovedBy,
        finance: record.financeApprovedBy,
        executive: record.executiveApprovedBy,
      }}
      leases={leases}
      currentLeaseId={record.leaseId}
      purchaseOrders={record.purchaseOrders.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        leaseId: po.leaseId,
      }))}
    />
  );
}

/**
 * Both evidence lists, behind one boundary because they share the options
 * query. The options are only read when someone can use them.
 */
async function Evidence({
  record,
  admin,
  locked,
}: {
  record: FundingRecord;
  admin: boolean;
  locked: boolean;
}) {
  const editable = admin && !locked;
  const options = editable
    ? await getFundingAttachOptions(record.id)
    : { purchaseOrders: [], orders: [] };

  return (
    <>
      <Card
        title="Purchase orders"
        meta={record.purchaseOrders.length > 0 ? "the hardware this request funds" : undefined}
      >
        <FundingEvidence
          requestId={record.id}
          kind="purchaseOrder"
          editable={editable}
          options={options.purchaseOrders.map((po) => ({
            id: po.id,
            label: `${po.label} · ${moneyExact(po.total)} · ${PO_STATUS_LABEL[po.status]}`,
          }))}
          rows={record.purchaseOrders.map((po) => ({
            id: po.id,
            href: `/dashboard/purchase-orders/${po.id}`,
            title: po.poNumber,
            detail: `${po.vendor.name}${po.lease ? ` · on ${po.lease.leaseNumber}` : ""}`,
            aside: `${moneyExact(po.total)} · ${PO_STATUS_LABEL[po.status]}`,
          }))}
          empty={
            editable
              ? "No purchase order is attached. Attach the PO this request pays for, or raise one once it is approved."
              : "No purchase order is attached."
          }
        />
      </Card>

      <Card
        title="Client orders"
        meta={record.reservations.length > 0 ? "the demand behind it" : undefined}
      >
        <FundingEvidence
          requestId={record.id}
          kind="order"
          editable={editable}
          options={options.orders.map((order) => ({
            id: order.id,
            label: `${order.label} · ${ORDER_STATUS_LABEL[order.status]}`,
          }))}
          rows={record.reservations.map((order) => ({
            id: order.id,
            href: `/dashboard/orders/${order.id}`,
            title: order.reservationNumber,
            detail: `${order.client.name} · ${ORDER_TYPE_LABEL[order.reservationType]}`,
            aside: ORDER_STATUS_LABEL[order.status],
          }))}
          empty={
            editable
              ? "No client quote or order is attached. Attach the one that justifies the spend — a request with no named demand is general inventory."
              : "No client quote or order is attached."
          }
        />
      </Card>
    </>
  );
}

function Stamp({ label, at, by }: { label: string; at: Date | null; by?: string | null }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums">
        {at ? (
          <>
            {dayYear(at)}
            {by ? <span className="text-ink-muted"> · {by}</span> : null}
          </>
        ) : (
          <Unset />
        )}
      </dd>
    </>
  );
}

function Figure({ label, value, loud }: { label: string; value: string; loud?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"}`}
      >
        {value}
      </span>
    </span>
  );
}
