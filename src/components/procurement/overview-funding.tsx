import Link from "next/link";
import { Card, CardEmpty } from "@/components/record/record-card";
import { money } from "@/lib/format";
import { FUNDING_STATUS_LABEL, getFundingPipeline } from "@/lib/queries/procurement";

/**
 * Funding requests by status: how many, and how much was asked for.
 *
 * Amount requested, not amount funded — the request carries what the requester
 * asked for, and a FUNDED row's loan lives on its lease. The empty state is
 * specific on purpose: v2 has the table but none of v1's rows until the next
 * refresh, and a row of zeros would read as a pipeline nobody has used.
 */
export async function OverviewFunding() {
  const pipeline = await getFundingPipeline();

  return (
    <Card
      title="Funding pipeline"
      meta={
        pipeline.total === 0
          ? "no requests in v2 yet"
          : `${pipeline.total} ${pipeline.total === 1 ? "request" : "requests"}, amount requested`
      }
      action={
        <Link href="/dashboard/funding" className="text-detail text-ink-muted hover:underline">
          Funding requests →
        </Link>
      }
    >
      {pipeline.total === 0 ? (
        <CardEmpty>
          No funding request exists in v2 yet. v1 has them, and they come
          across on the next refresh from v1 — the table is here to receive
          them. Until then, a request raised under Funding requests is the
          first row this counts.
        </CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_64px_112px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
            <span>Status</span>
            <span className="text-right">Count</span>
            <span className="text-right">Requested</span>
          </div>
          <ul className="flex flex-col gap-[2px] px-2">
            {pipeline.byStatus.map((row, index) => (
              <li key={row.status}>
                <Link
                  href={`/dashboard/funding?status=${row.status}`}
                  className={`grid grid-cols-[1fr_64px_112px] items-center gap-2 rounded-row px-2 py-[6px] text-detail transition-colors duration-[160ms] hover:bg-row-hover ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className={row.count === 0 ? "text-ink-faint" : undefined}>
                    {FUNDING_STATUS_LABEL[row.status]}
                  </span>
                  <span className="text-right tabular-nums">{row.count}</span>
                  <span className="text-right tabular-nums text-ink-muted">
                    {row.count === 0 ? "—" : money(row.amount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pt-2 pb-4 text-detail text-balance text-ink-muted">
            Every request in every status, drafts and cancellations included,
            each on its own row. The amount is what the requester asked for,
            not what a lender advanced.
          </p>
        </>
      )}
    </Card>
  );
}
