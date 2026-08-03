import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardSkeleton, Field, Unset } from "@/components/record/record-card";
import {
  AuditItemsCard,
  AuditProgressStrip,
} from "@/components/inventory/audit-record-cards";
import { AuditScanPanel } from "@/components/inventory/audit-scan-panel";
import { dayYear } from "@/lib/format";
import { getAuditHeader, getAuditProgress } from "@/lib/queries/audit-record";

type Params = { params: Promise<{ id: string }> };

const SCOPE_LABEL: Record<string, string> = {
  FULL: "Everything in the fleet",
  PARTIAL: "Chosen assets",
  CATEGORY: "One category",
  LOCATION: "One location",
  CLIENT_ORDER: "What a client is holding",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not started",
  IN_PROGRESS: "Counting",
  COMPLETED: "Closed",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getAuditHeader(id);
  return { title: header?.name ?? "Audit" };
}

/**
 * Inventory → Audits & scan lists → the audit record.
 *
 * The scan session the build plan asks for. An audit is the only place in the
 * app that compares the record against the shelf, so the screen is built around
 * one loop: scan, see what didn't match, decide. It reports; it never repairs —
 * `verifyAuditItemByBarcode` writes to audit tables only and never touches a
 * unit, a check-out or an order, which is what makes counting stock safe to do
 * while orders are going out.
 */
export default async function AuditRecordPage({ params }: Params) {
  const { id } = await params;
  const audit = await getAuditHeader(id);
  if (!audit) notFound();

  const counting = audit.status === "IN_PROGRESS";

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Audit"
        title={audit.name}
        blurb={
          <>
            {SCOPE_LABEL[audit.scope] ?? audit.scope}
            {audit.categoryName ? ` · ${audit.categoryName}` : ""}
            {audit.locationName ? ` · ${audit.locationName}` : ""}
            {audit.client ? (
              <>
                {" · "}
                <Link
                  href={`/dashboard/clients/${audit.client.id}`}
                  className="text-accent-text hover:underline"
                >
                  {audit.client.name}
                </Link>
              </>
            ) : null}{" "}
            · opened {dayYear(audit.startedAt ?? audit.createdAt)}
          </>
        }
        actions={
          <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
            {STATUS_LABEL[audit.status] ?? audit.status}
          </span>
        }
      />

      <Suspense
        fallback={
          <div className="h-[68px] animate-pulse rounded-card bg-panel shadow-sm" />
        }
      >
        <AuditProgressStrip id={id} />
      </Suspense>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Items" rows={14} />}>
          <AuditItemsCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {counting ? (
            <Suspense
              fallback={
                <div className="h-40 animate-pulse rounded-card bg-panel shadow-sm" />
              }
            >
              <ScanWell id={id} />
            </Suspense>
          ) : (
            <NotCounting audit={audit} />
          )}

          <Card title="Scope">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Covers">
                {SCOPE_LABEL[audit.scope] ?? audit.scope}
              </Field>
              <Field label="Started">
                {audit.startedAt ? (
                  dayYear(audit.startedAt)
                ) : (
                  <Unset>Not yet</Unset>
                )}
              </Field>
              <Field label="Closed">
                {audit.completedAt ? (
                  dayYear(audit.completedAt)
                ) : (
                  <Unset>Open</Unset>
                )}
              </Field>
              <Field label="Orders">
                {audit.orders.length === 0 ? (
                  <Unset>None</Unset>
                ) : (
                  audit.orders.map((order, index) => (
                    <span key={order.id}>
                      {index > 0 ? ", " : ""}
                      <Link
                        href={`/dashboard/reservations/${order.id}`}
                        className="text-accent-text hover:underline"
                      >
                        {order.reservationNumber}
                      </Link>
                    </span>
                  ))
                )}
              </Field>
            </div>
            {audit.notes ? (
              <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
                {audit.notes}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

/** The panel needs the outstanding count to state what closing would claim. */
async function ScanWell({ id }: { id: string }) {
  const { counted } = await getAuditProgress(id);
  return <AuditScanPanel auditId={id} pending={counted.pending} />;
}

type Audit = NonNullable<Awaited<ReturnType<typeof getAuditHeader>>>;

/**
 * What the card says when there is no session to run.
 *
 * A draft audit cannot be started from v2 yet. `startInventoryAudit` refuses a
 * PARTIAL scope without a list of assets and a CLIENT_ORDER one without orders,
 * and neither picker is built — so the screen names what is missing rather than
 * offering a button that throws when pressed. The one draft in this database is
 * PARTIAL, which is why the picker is the thing worth building next here.
 */
function NotCounting({ audit }: { audit: Audit }) {
  if (audit.status === "COMPLETED") {
    return (
      <Card title="Count closed">
        <p className="px-4 pb-4 text-body text-balance text-ink-muted">
          This count closed{" "}
          {audit.completedAt ? dayYear(audit.completedAt) : "already"}. Anything
          still unscanned at that point was recorded as missing, and the items
          beside this are the finding — they are not re-checked by opening the
          screen again.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Not started">
      <p className="px-4 pb-4 text-body text-balance text-ink-muted">
        This audit has no items yet, so there is nothing to scan against.
        Starting it snapshots every unit in scope, and{" "}
        {audit.scope === "PARTIAL"
          ? "a scope of chosen assets needs those assets picking first"
          : audit.scope === "CLIENT_ORDER"
            ? "a client-order scope needs the orders picking first"
            : "a scope this wide needs confirming before it writes thousands of lines"}
        . That picker isn&rsquo;t built in v2 yet — the count itself is, and
        works the moment an audit has items.
      </p>
    </Card>
  );
}
