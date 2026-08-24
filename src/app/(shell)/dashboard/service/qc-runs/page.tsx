import Link from "next/link";
import type { QcResult } from "@/generated/prisma/client";
import { PageHeader } from "@/components/shell/page-header";
import { getTestRuns, QC_LABEL } from "@/lib/queries/service";

export const metadata = { title: "QC test runs" };

const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const FILTERS: (QcResult | "ALL")[] = ["ALL", "FAIL", "RUNNING", "QUEUED", "PASS"];
const COLUMNS = "grid-cols-[108px_92px_1fr_72px_120px]";

/**
 * Service center → QC test runs: every run across every work order, so the
 * bench can see what's failing without opening each one.
 */
export default async function QcRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  const filter = FILTERS.includes(result as QcResult) ? (result as QcResult) : undefined;
  const runs = await getTestRuns(filter);

  return (
    <>
      <PageHeader
        eyebrow="Service center"
        title="QC test runs"
        blurb="Bench results across every work order."
        actions={
          <div role="tablist" className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]">
            {FILTERS.map((option) => {
              const selected = option === (filter ?? "ALL");
              return (
                <Link
                  key={option}
                  role="tab"
                  aria-selected={selected}
                  href={
                    option === "ALL"
                      ? "/dashboard/service/qc-runs"
                      : `/dashboard/service/qc-runs?result=${option}`
                  }
                  className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
                    selected
                      ? "bg-segmented-thumb text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {option === "ALL" ? "All" : QC_LABEL[option]}
                </Link>
              );
            })}
          </div>
        }
      />

      {runs.length === 0 ? (
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-sm text-center text-body text-balance text-ink-muted">
            {filter
              ? `No runs are ${QC_LABEL[filter].toLowerCase()}. Try another result.`
              : "No test runs filed yet. They arrive from the bench, by hand on a work order or posted by a rig."}
          </p>
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
          <div className={`grid ${COLUMNS} gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted`}>
            <span>Work order</span>
            <span>Unit</span>
            <span>Test</span>
            <span>Result</span>
            <span>Ran</span>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
            {runs.map((run, index) => (
              <li key={run.id}>
                <Link
                  href={`/dashboard/service/work-orders/${run.workOrder.id}`}
                  className={`grid ${COLUMNS} items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${
                    run.result === "FAIL"
                      ? "bg-accent-tint"
                      : index % 2 === 1
                        ? "bg-row-alt"
                        : ""
                  } hover:bg-row-hover`}
                >
                  <span className="truncate font-bold">{run.workOrder.number}</span>
                  <span className="truncate">{run.workOrder.assetUnit.barcode}</span>
                  <span className="truncate">{run.testName}</span>
                  <span
                    className={
                      run.result === "FAIL"
                        ? "font-bold text-accent-text"
                        : "text-ink-muted"
                    }
                  >
                    {QC_LABEL[run.result]}
                  </span>
                  <span className="text-ink-muted">
                    {run.ranAt ? STAMP.format(run.ranAt) : "Not yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 py-3 text-detail text-ink-muted">
            {runs.length} shown{runs.length === 80 ? " · newest 80" : ""}
          </p>
        </section>
      )}
    </>
  );
}
