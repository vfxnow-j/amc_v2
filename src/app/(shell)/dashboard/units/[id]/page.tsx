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
  CoverageCard,
  MovementsCard,
  OwnershipCard,
  ServiceHistoryCard,
  TransfersCard,
} from "@/components/inventory/unit-record-cards";
import { dayYear } from "@/lib/format";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import { getUnitHeader } from "@/lib/queries/unit-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getUnitHeader(id);
  return { title: header ? `Unit ${header.barcode}` : "Unit" };
}

/**
 * Inventory → Units → the record.
 *
 * The one screen in the app about a single physical object, and the destination
 * for every barcode: the Units list, the asset record and the mobile scan all
 * end here. It answers, in order, where is it and who has it; where has it been;
 * what has been done to it; and what is it worth.
 *
 * Read-only, deliberately. Scanning a unit out, back in, or into service happens
 * on the order and on the work order, where the rates and the sign-off live — a
 * second place to move stock is exactly what the dropped Desk was, and it would
 * drift from the order's version the moment either changed.
 */
export default async function UnitRecordPage({ params }: Params) {
  const { id } = await params;
  const unit = await getUnitHeader(id);
  if (!unit) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Unit"
        title={unit.barcode}
        blurb={
          <>
            <Link
              href={`/dashboard/assets/${unit.asset.id}`}
              className="text-accent-text hover:underline"
            >
              {unit.asset.name}
            </Link>
            {unit.maker ? ` · ${unit.maker}` : ""} ·{" "}
            {unit.serialNumber
              ? `serial ${unit.serialNumber}`
              : "no serial on file"}{" "}
            · registered {dayYear(unit.registeredAt)}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {UNIT_STATUS_LABEL[unit.status]}
            </span>
            {unit.holder?.orderId ? (
              <Link
                href={`/dashboard/orders/${unit.holder.orderId}`}
                className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
              >
                Its order
              </Link>
            ) : null}
          </>
        }
      />

      <Whereabouts unit={unit} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Movements" rows={10} />}>
            <MovementsCard id={id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense
            fallback={<CardSkeleton title="Service history" rows={4} />}
          >
            <ServiceHistoryCard id={id} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Coverage" rows={3} />}>
            <CoverageCard id={id} />
          </Suspense>
          <Suspense
            fallback={<CardSkeleton title="Location & transfers" rows={3} />}
          >
            <TransfersCard id={id} location={unit.location} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense
            fallback={<CardSkeleton title="Ownership & value" rows={5} />}
          >
            <OwnershipCard id={id} />
          </Suspense>
          {unit.notes ? (
            <Card title="Notes">
              <p className="whitespace-pre-line px-4 pb-4 text-detail text-ink-muted">
                {unit.notes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

type Unit = NonNullable<Awaited<ReturnType<typeof getUnitHeader>>>;

/**
 * Where it is and who has it, above every Suspense boundary — the two facts
 * somebody standing in the warehouse opened this screen for, and they must not
 * wait on the movement log.
 *
 * Custody reads off the open checkout rather than off `AssetUnit.status`,
 * because those two can disagree and the movement log is the physical record. An
 * open work order is called out here rather than only in Service history: a unit
 * on the bench is not bookable, and that belongs at the top.
 */
function Whereabouts({ unit }: { unit: Unit }) {
  // Late is a comparison against today, not a stored flag: `Checkout.status`
  // carries an OVERDUE value maintained by a nightly job, so a unit can be
  // genuinely late while the column still reads ACTIVE. Same reasoning as the
  // Invoices list, asked of custody instead of money.
  const overdue =
    unit.holder?.dueBack != null && unit.holder.dueBack < new Date();

  return (
    <section className="flex flex-col gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Status">{UNIT_STATUS_LABEL[unit.status]}</Field>
        <Field label="Location">
          {unit.location ? (
            <Link
              href={`/dashboard/locations/${unit.location.id}`}
              className="text-accent-text hover:underline"
            >
              {unit.location.name}
            </Link>
          ) : (
            <Unset>Unlocated</Unset>
          )}
        </Field>
        <Field label="With">
          {unit.holder ? (
            <Link
              href={`/dashboard/clients/${unit.holder.clientId}`}
              className="text-accent-text hover:underline"
            >
              {unit.holder.clientName}
            </Link>
          ) : (
            <Unset>On the shelf</Unset>
          )}
        </Field>
        <Field label="Due back">
          {unit.holder?.dueBack ? (
            <span className={overdue ? "font-bold text-destructive" : ""}>
              {dayYear(unit.holder.dueBack)}
              {overdue ? " · overdue" : ""}
            </span>
          ) : unit.holder ? (
            <Unset>No return date</Unset>
          ) : (
            <Unset>—</Unset>
          )}
        </Field>
      </div>

      {/* A contradiction between two fields on one row, reported rather than
          resolved. See getUnitHeader for why it isn't repaired here. */}
      {unit.retiredButBookable ? (
        <p className="rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint">
          This unit was retired {dayYear(unit.retiredAt!)}, but its status still
          reads {UNIT_STATUS_LABEL[unit.status].toLowerCase()} — so the fleet is
          offering it to the next client. One of the two is wrong and the record
          doesn&rsquo;t say which; check the hardware before promising it, then
          retire it properly or clear the retirement date.
        </p>
      ) : null}

      {unit.holder ? (
        <p className="text-detail text-ink-muted">
          Out since {dayYear(unit.holder.since)}
          {unit.holder.orderNumber ? (
            <>
              {" "}
              on{" "}
              <Link
                href={`/dashboard/orders/${unit.holder.orderId}`}
                className="text-accent-text hover:underline"
              >
                {unit.holder.orderNumber}
              </Link>
            </>
          ) : (
            " on a checkout with no order attached"
          )}
          . Custody comes from the open check-out, not from the status column.
        </p>
      ) : null}

      {unit.workOrder ? (
        <p className="rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint">
          Open work order{" "}
          <Link
            href={`/dashboard/service/work-orders/${unit.workOrder.id}`}
            className="font-bold underline-offset-2 hover:underline"
          >
            {unit.workOrder.number}
          </Link>{" "}
          — {unit.workOrder.fault}. This unit is not bookable until it closes.
        </p>
      ) : null}

      {unit.condition ? (
        <p className="text-detail text-ink-muted">
          Condition on record: {unit.condition}
        </p>
      ) : null}
    </section>
  );
}
