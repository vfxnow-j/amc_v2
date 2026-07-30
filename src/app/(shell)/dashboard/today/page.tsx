import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import {
  IncomingCard,
  OutgoingCard,
  QueueCardSkeleton,
} from "@/components/today/movement-cards";
import { getTodayStats } from "@/lib/queries/today";

export const metadata = { title: "Today’s movements" };

async function HeaderBlurb() {
  const { toPull, toReceive } = await getTodayStats();

  if (toPull === 0 && toReceive === 0) {
    return <>Nothing waiting in either direction</>;
  }

  return (
    <>
      {toPull} {toPull === 1 ? "unit" : "units"} to pull ·{" "}
      {toReceive} {toReceive === 1 ? "unit" : "units"} to receive
    </>
  );
}

/**
 * Operate → Today's movements: what needs hands, in both directions.
 *
 * Deliberately not a scanner. Check-out and check-in happen on the order, where
 * the lines, the assigned units, the rates and the sign-off already are; a
 * second surface for the same two actions would be a second place to keep them
 * correct. Every row here opens its order.
 *
 * A card each, each behind its own Suspense boundary, so a slow return query
 * never holds up the pull list.
 */
export default function TodayPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Today’s movements"
        blurb={
          <Suspense fallback="Counting what needs hands…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <Link
            href="/dashboard/reservations"
            className="rounded-pill bg-sunken px-[14px] py-2 text-pill text-ink transition-colors hover:bg-row-hover"
          >
            All reservations
          </Link>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <Suspense fallback={<QueueCardSkeleton title="Going out" />}>
          <OutgoingCard />
        </Suspense>
        <Suspense fallback={<QueueCardSkeleton title="Coming back" />}>
          <IncomingCard />
        </Suspense>
      </div>
    </>
  );
}
