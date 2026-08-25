import { Suspense } from "react";
import Link from "next/link";
import { GroupingReview } from "@/components/inventory/grouping-review";
import { PageHeader } from "@/components/shell/page-header";
import { getSuggestions, getUngroupedCount } from "@/lib/queries/families";

export const metadata = { title: "Group into assets" };

async function Review() {
  const [suggestions, ungrouped] = await Promise.all([
    getSuggestions(),
    getUngroupedCount(),
  ]);
  const covered = suggestions.reduce((n, s) => n + s.assets.length, 0);

  return (
    <>
      <p className="rounded-card bg-panel px-4 py-3 text-body text-ink-muted shadow-sm">
        {suggestions.length} {suggestions.length === 1 ? "grouping" : "groupings"}{" "}
        suggested, covering {covered} of {ungrouped} ungrouped models. The other{" "}
        {ungrouped - covered} have nothing to sit beside and are left alone —
        that is a normal resting state, not a backlog.{" "}
        <span className="text-ink">Nothing is grouped until you say so</span>, and
        grouping moves no rate, no unit and no depreciation schedule: an asset is
        only a container, so any of this can be undone.
      </p>
      <GroupingReview suggestions={suggestions} />
    </>
  );
}

/**
 * Inventory → Assets → grouping review.
 *
 * The suggestions come from one rule — models in the same category that share
 * their leading words, refined by another word when a group exceeds six — and
 * that rule is deliberately conservative about the thing it cannot know.
 * Whether two names are the same product is a judgment about hardware, so this
 * screen proposes and a person decides.
 *
 * Groups already accepted are never re-proposed: the suggestion query only ever
 * looks at models with no family, so coming back here after grouping half the
 * fleet shows the half that is left.
 */
export default async function GroupingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Inventory · Assets"
        title="Group models into assets"
        blurb="Same category, same leading words — proposed, not applied"
        actions={
          <Link
            href="/dashboard/assets"
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
          >
            ← All assets
          </Link>
        }
      />

      <Suspense
        fallback={
          <div className="h-24 animate-pulse rounded-card bg-panel shadow-sm" />
        }
      >
        <Review />
      </Suspense>
    </>
  );
}
