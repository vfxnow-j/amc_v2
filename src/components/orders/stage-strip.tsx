import { dayYear } from "@/lib/format";
import {
  LIFECYCLE,
  STAGE_BLURB,
  stageIndex,
  stageLabel,
} from "@/lib/orders/lifecycle";
import { getOrderLifecycle } from "@/lib/queries/order-lifecycle";
import type { ReservationStatus } from "@/generated/prisma/client";

/**
 * Every stage the order has passed through, and the one it is at.
 *
 * The order record showed a status pill: one word, no history, no idea what
 * comes next. But the transitions have always written `StatusHistory` rows and
 * stamped a column per stage, so the whole path was already recorded and simply
 * never read.
 *
 * Drawn as the fixed line rather than as whatever happened, so a stage that was
 * skipped is visibly skipped. Orders legitimately jump — a cloud order goes from
 * approved straight to active with nothing to pull — and a timeline that only
 * drew the stamps it found would quietly redraw itself per order, which is the
 * one thing a progress indicator must not do.
 *
 * Revision, cancellation and loss are not points on the line; they are stops,
 * and they are said in a sentence underneath rather than jammed into the line
 * as a seventh circle that only sometimes exists.
 */
export async function StageStrip({ id }: { id: string }) {
  const order = await getOrderLifecycle(id);
  if (!order) return null;

  const { status, stamps } = order;
  const here = stageIndex(status);
  const stopped = status === "CANCELLED" || status === "LOST";

  const stampFor: Partial<Record<ReservationStatus, Date | null>> = {
    DRAFT: stamps.created,
    QUOTE_SENT: stamps.quoteSent,
    APPROVED: stamps.approved,
    PREPARING: stamps.preparing,
    SHIPPED: stamps.shipped,
    COMPLETED: stamps.completed,
  };

  return (
    <section className="flex flex-col gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
      <ol className="flex items-start gap-1">
        {LIFECYCLE.map((stage, index) => {
          const done = !stopped && index < here;
          const current = !stopped && index === here;
          const at = stampFor[stage];
          return (
            <li key={stage} className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <span
                aria-hidden
                className={`h-[3px] rounded-pill ${
                  current
                    ? "bg-accent-solid"
                    : done
                      ? "bg-accent-tint-strong"
                      : "bg-row-alt"
                }`}
              />
              <span
                className={`truncate text-detail ${
                  current ? "font-bold text-ink" : done ? "text-ink" : "text-ink-faint"
                }`}
              >
                {stageLabel(stage)}
              </span>
              <span className="truncate text-micro text-ink-faint">
                {at
                  ? dayYear(at)
                  : current
                    ? STAGE_BLURB[stage]
                    : done
                      ? "Passed"
                      : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {/* The stops and the side-branch, said plainly rather than drawn. */}
      {status === "REVISION" ? (
        <p className="text-detail text-ink-muted">
          Pulled back for revision{stamps.quoteSent ? ` after being quoted ${dayYear(stamps.quoteSent)}` : ""}.
          {order.actionRequiredNote ? ` ${order.actionRequiredNote}` : ""}
        </p>
      ) : null}
      {status === "LOST" ? (
        <p className="text-detail text-ink-muted">
          Lost{stamps.lost ? ` ${dayYear(stamps.lost)}` : ""}
          {order.lostReason ? ` — ${order.lostReason}` : ""}. The pricing stays on
          the record.
        </p>
      ) : null}
      {status === "CANCELLED" ? (
        <p className="text-detail text-ink-muted">
          Canceled. Any units held for it were released.
        </p>
      ) : null}
      {order.preparedBy && stageIndex(status) >= LIFECYCLE.indexOf("PREPARING") ? (
        <p className="text-detail text-ink-muted">
          Prepared by {order.preparedBy.name}
          {stamps.preparing ? ` from ${dayYear(stamps.preparing)}` : ""}.
        </p>
      ) : null}
      {status === "QUOTE_SENT" && stamps.quoteExpires ? (
        <p className="text-detail text-ink-muted">
          Quoted pricing holds until {dayYear(stamps.quoteExpires)}
          {order.quoteLinks.count > 0
            ? ` · ${order.quoteLinks.count} live ${order.quoteLinks.count === 1 ? "link" : "links"}`
            : " · no live link — send the quote again to issue one"}
          .
        </p>
      ) : null}
    </section>
  );
}

export function StageStripSkeleton() {
  return <section className="h-[74px] animate-pulse rounded-card bg-panel shadow-sm" />;
}
