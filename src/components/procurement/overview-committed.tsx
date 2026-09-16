import { Card } from "@/components/record/record-card";
import { Figure } from "@/components/dashboard/tiles/parts";
import { money } from "@/lib/format";
import { getAwaitingReceipt, getCommittedSpend } from "@/lib/queries/procurement";

/**
 * The four figures at the top of Procurement → Overview.
 *
 * Committed is the On order tile's figure, from the same query, so the two
 * never disagree. The sentence under the figures names what is in it and what
 * is not — drafts and cancellations are counted beside it, never inside it —
 * and, when an order is part-received, how much of its total is still out on
 * the lines.
 */
export async function OverviewCommitted() {
  const [committed, awaiting] = await Promise.all([
    getCommittedSpend(),
    getAwaitingReceipt(),
  ]);

  return (
    <Card title="On order" meta="submitted to a vendor, not yet fully received">
      <div className="grid gap-2 px-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Committed"
          value={money(committed.openValue)}
          detail={`${committed.openCount} open ${committed.openCount === 1 ? "PO" : "POs"}, order totals`}
          href="/dashboard/purchase-orders?view=open"
        />
        <Figure
          label="Past expected date"
          value={awaiting.lateCount}
          detail={
            awaiting.lateCount === 0
              ? "nothing late"
              : `${money(awaiting.lateValue)} of the committed figure`
          }
          tone={awaiting.lateCount > 0 ? "alert" : "plain"}
        />
        <Figure
          label="Part received"
          value={committed.partialCount}
          detail={
            committed.partialCount === 0
              ? "none part-received"
              : `${money(committed.partialUnreceivedLines)} of lines still out`
          }
        />
        <Figure
          label="Draft"
          value={committed.draftCount}
          detail={
            committed.draftCount === 0
              ? "none waiting"
              : `${money(committed.draftValue)}, not sent, not counted`
          }
          href="/dashboard/purchase-orders?view=draft"
        />
      </div>

      <p className="px-4 pt-2 pb-4 text-detail text-balance text-ink-muted">
        Committed sums the stored total — lines, freight, fees and tax — of
        every PO submitted or part-received.{" "}
        {committed.partialCount === 0
          ? "No PO is part-received today, so all of it is still to arrive."
          : `For the ${committed.partialCount} part-received, that total (${money(committed.partialTotal)}) includes what has already arrived; the lines still out come to ${money(committed.partialUnreceivedLines)} before freight, fees and tax, which are not split by line.`}{" "}
        Drafts{committed.cancelledCount > 0 ? ` and ${committed.cancelledCount} canceled` : " and cancellations"} are
        not in it.
        {awaiting.undatedCount > 0
          ? ` ${awaiting.undatedCount} open ${awaiting.undatedCount === 1 ? "PO has" : "POs have"} no expected date, so ${awaiting.undatedCount === 1 ? "it" : "they"} cannot show as late.`
          : null}
      </p>
    </Card>
  );
}
