import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardSkeleton } from "@/components/record/record-card";
import { InsightGroups, tally } from "@/components/insight/insight-list";
import { getAllInsights, getSystemFlagBoard } from "@/lib/analytics/insights";

export const metadata = { title: "Insights" };

/**
 * Insight → Insights.
 *
 * The full surface of `lib/analytics/insights.ts`, which until now only ever
 * reached a screen two rows at a time through the Overview's "Needs a decision"
 * card. That card is capped at eight and shuffled inside each priority tier so
 * the same pair doesn't sit there all week; this one is neither, because a
 * screen whose job is to be the whole list must not hide work, and must not
 * reorder itself under somebody halfway down it.
 *
 * Three boards, because the findings are three different kinds of thing and
 * they want three different answers:
 *
 * - **Suggestions** are judgements about the business — a rate that hasn't kept
 *   up, a client who is too much of the revenue. Somebody decides.
 * - **Disagreements** are two records that can't both be right. Somebody who
 *   knows what happened has to say which one is. `lib/analytics/data-integrity`
 *   reports these and never repairs them.
 * - **Gaps** are facts nobody has entered yet. Somebody types them in.
 *
 * Flattening all three into one priority-sorted list is what makes the
 * disagreements invisible: they are deliberately low priority, because nothing
 * is broken for anyone standing at a shelf, so they sink underneath every
 * missing rate on the screen that is supposed to be reporting them.
 *
 * A board per Suspense boundary. The suggestions run eleven aggregates across
 * checkouts, invoices, units and leases and are much the slowest thing here.
 */
export default function InsightsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Insights"
        blurb="What the data says, what it can't agree with itself about, and what nobody has filled in."
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Suggestions" rows={12} />}>
          <SuggestionsCard />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Disagreements" rows={6} />}>
            <FlagCards />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function SuggestionsCard() {
  const insights = await getAllInsights();
  const counts = tally(insights);

  return (
    <Card
      title="Suggestions"
      meta={
        counts.total === 0
          ? undefined
          : `${counts.total} · ${counts.high} to act on`
      }
    >
      <InsightGroups
        insights={insights}
        empty={
          <>
            Nothing to suggest right now. These are computed from the last three
            to twelve months of checkouts, invoices, maintenance and leases —
            trade for a while and they come back.
          </>
        }
      />
    </Card>
  );
}

/**
 * The two data-quality boards, from one query pass.
 *
 * They share a Suspense boundary because they share the work: splitting them
 * would run the same five aggregates twice to save nothing.
 */
async function FlagCards() {
  const { consistency, completeness } = await getSystemFlagBoard();

  return (
    <>
      <Card
        title="Disagreements"
        meta={consistency.length === 0 ? undefined : `${consistency.length}`}
      >
        {/* The owner's decision, on the screen that reports it: these are not
            backfilled. A repair picked by guesswork buries the evidence and
            makes the wrong number permanent. */}
        <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
          Two records that can&rsquo;t both be right. Nothing here is repaired
          automatically — a backfill picked by guesswork would bury the evidence
          and make the wrong number permanent. Each one links to the order or
          unit it is about, so whoever knows what happened can say which record
          is the true one.
        </p>
        <InsightGroups
          insights={consistency}
          empty={
            <>
              Every order&rsquo;s line counts match the units attached to it, and
              no unit is offered while it is out. Nothing to reconcile.
            </>
          }
        />
      </Card>

      <Card
        title="Gaps"
        meta={completeness.length === 0 ? undefined : `${completeness.length}`}
      >
        <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
          Facts nobody has entered yet. Each one costs a specific answer — an
          asset with no rate can&rsquo;t be quoted, a unit with no purchase
          price can&rsquo;t be depreciated or shown an ROI.
        </p>
        <InsightGroups
          insights={completeness}
          empty={
            <>
              Every active asset has a rate and every unit has a purchase price.
              Nothing missing.
            </>
          }
        />
      </Card>
    </>
  );
}
