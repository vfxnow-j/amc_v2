import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/reservations/record-cards";
import { WorkOrderActions } from "@/components/service/work-order-actions";
import { getUnitCoverage, getWorkOrder, QC_LABEL, WORK_ORDER_LABEL } from "@/lib/queries/service";

type Params = { params: Promise<{ id: string }> };

const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const workOrder = await getWorkOrder(id);
  return { title: workOrder?.number ?? "Work order" };
}

function duration(seconds: number | null) {
  if (!seconds) return "—";
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m` : `${(minutes / 60).toFixed(1)}h`;
}

export default async function WorkOrderPage({ params }: Params) {
  const { id } = await params;
  const workOrder = await getWorkOrder(id);
  if (!workOrder) notFound();

  const unit = workOrder.assetUnit;
  const coverage = await getUnitCoverage(unit.id);

  return (
    <>
      <PageHeader
        eyebrow="Service center"
        title={`${workOrder.number} — ${workOrder.fault}`}
        blurb={
          <>
            {unit.barcode} · {unit.asset.name} · opened{" "}
            {STAMP.format(workOrder.openedAt)}
            {workOrder.openedBy ? ` by ${workOrder.openedBy.name}` : ""} ·{" "}
            {workOrder.billable ? "billable to the client" : "client not billed"}
            {workOrder.openedFromReservation ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/dashboard/orders/${workOrder.openedFromReservation.id}`}
                  className="text-accent-text hover:underline"
                >
                  from {workOrder.openedFromReservation.reservationNumber}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
            {WORK_ORDER_LABEL[workOrder.status]}
          </span>
        }
      />

      <div className="grid flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Card
          title="Test runs"
          meta={
            workOrder.testRuns.length === 0
              ? undefined
              : `${workOrder.testRuns.length} filed`
          }
        >
          {workOrder.testRuns.length === 0 ? (
            <p className="px-4 pb-4 text-body text-ink-muted">
              Nothing run yet — file the first test from the panel on the right,
              or let the bench rig post it.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
              {workOrder.testRuns.map((run) => (
                <li
                  key={run.id}
                  className={`grid grid-cols-[1fr_72px_64px_92px] items-center gap-2 rounded-row p-2 text-detail ${
                    run.result === "FAIL" ? "bg-accent-tint" : ""
                  }`}
                >
                  <span className="truncate">
                    {run.testName}
                    {run.output ? (
                      <span className="block truncate text-ink-faint">
                        {run.output}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={
                      run.result === "FAIL"
                        ? "font-bold text-accent-text"
                        : "text-ink-muted"
                    }
                  >
                    {QC_LABEL[run.result]}
                  </span>
                  <span className="text-right tabular-nums text-ink-muted">
                    {duration(run.durationSec)}
                  </span>
                  <span className="text-right text-ink-faint">
                    {run.ranAt ? STAMP.format(run.ranAt) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          <Card
            title="The bench"
            meta={workOrder.assignedTech?.name ?? "Unassigned"}
          >
            <WorkOrderActions
              workOrderId={workOrder.id}
              status={workOrder.status}
              notes={workOrder.notes}
              passedTests={workOrder.testRuns.filter((run) => run.result === "PASS").length}
              rma={{
                provider: workOrder.rmaProvider,
                number: workOrder.rmaNumber,
                sentAt: workOrder.rmaSentAt?.toISOString() ?? null,
                returnedAt: workOrder.rmaReturnedAt?.toISOString() ?? null,
              }}
              suggestedProvider={coverage.find((row) => row.active && row.provider)?.provider ?? null}
            />
          </Card>

          <Card title="Unit">
            <div className="px-4 pb-4 text-detail">
              <p className="font-bold">{unit.barcode}</p>
              <p className="text-ink-muted">{unit.asset.name}</p>
              <p className="text-ink-muted">
                {unit.serialNumber ?? "No serial recorded"} ·{" "}
                {unit.status.toLowerCase().replace("_", " ")}
              </p>
            </div>
          </Card>

          {/* Whether someone else is on the hook: the model's coverage (run from
              the unit's purchase date), the unit's own contracts and plans, and
              its warranty. */}
          <Card title="Coverage" meta={coverage.some((row) => row.active) ? "covered" : coverage.length ? "lapsed" : "none recorded"}>
            {coverage.length === 0 ? (
              <p className="px-4 pb-4 text-detail text-ink-muted">
                Nothing recorded. Add coverage on the{" "}
                <Link href={`/dashboard/assets/${unit.asset.id}`} className="text-accent-text hover:underline">
                  asset record
                </Link>{" "}
                — e.g. a 3-year warranty — and every unit shows it.
              </p>
            ) : (
              <ul className="flex flex-col gap-px px-2 pb-3">
                {coverage.map((row, index) => (
                  <li
                    key={`${row.source}-${index}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 rounded-row px-2 py-[5px] text-detail odd:bg-row-alt"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-bold">{row.name}</span>
                      {row.provider ? <span className="text-ink-muted"> · {row.provider}</span> : null}
                      <span className="text-ink-faint"> · {row.source === "model" ? "every unit of this model" : row.source === "unit" ? "this unit" : row.source === "plan" ? `this unit · ${row.status?.toLowerCase()}` : "unit warranty"}</span>
                    </span>
                    <span className={row.active ? "text-ink" : "text-destructive"}>
                      {row.endDate
                        ? `${row.active ? "until" : "ended"} ${row.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : row.source === "plan"
                          ? row.active ? "end date unknown" : row.status?.toLowerCase()
                          : "no purchase date"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
