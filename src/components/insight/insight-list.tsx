import Link from "next/link";
import type { Insight, InsightPriority } from "@/lib/analytics/insights";

/**
 * How an insight reads on the screen that exists to show all of them.
 *
 * One row per finding: a title somebody can act on, the sentence that says why,
 * and the row itself as the link to wherever the acting happens. Priority is a
 * grouping, not a color — tinting thirty rows red says nothing, and the tint
 * in this design means "somebody must act", which is exactly what the *high*
 * group already says by being first.
 */

export const PRIORITY_LABEL: Record<InsightPriority, string> = {
  high: "Act on these",
  medium: "Worth doing",
  low: "Keep an eye on",
};

export const PRIORITY_BLURB: Record<InsightPriority, string> = {
  high: "Costing money, or about to.",
  medium: "Not urgent, but it compounds.",
  low: "Nothing breaks if this waits.",
};

const ORDER: InsightPriority[] = ["high", "medium", "low"];

export function InsightGroups({
  insights,
  empty,
}: {
  insights: Insight[];
  empty: React.ReactNode;
}) {
  if (insights.length === 0) {
    return (
      <p className="px-4 pb-4 text-body text-balance text-ink-muted">{empty}</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
      {ORDER.map((priority) => {
        const tier = insights.filter((insight) => insight.priority === priority);
        if (tier.length === 0) return null;

        return (
          <section key={priority}>
            <h3 className="flex items-baseline gap-2 px-2 pb-[6px]">
              <span className="text-micro uppercase text-ink-muted">
                {PRIORITY_LABEL[priority]}
              </span>
              <span className="text-detail text-ink-faint">
                {tier.length} · {PRIORITY_BLURB[priority]}
              </span>
            </h3>
            <ul className="flex flex-col gap-px">
              {tier.map((insight) => (
                <li key={insight.id}>
                  <InsightRow insight={insight} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const body = (
    <>
      <p className="text-detail font-bold">{insight.title}</p>
      <p className="text-detail text-ink-muted">{insight.description}</p>
    </>
  );

  return insight.link ? (
    <Link
      href={insight.link}
      className="block rounded-row px-2 py-[6px] transition-colors duration-[160ms] hover:bg-row-hover"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-row px-2 py-[6px]">{body}</div>
  );
}

/** Counts for a header blurb — never a bare total. */
export function tally(insights: Insight[]) {
  return {
    total: insights.length,
    high: insights.filter((insight) => insight.priority === "high").length,
    medium: insights.filter((insight) => insight.priority === "medium").length,
    low: insights.filter((insight) => insight.priority === "low").length,
  };
}
