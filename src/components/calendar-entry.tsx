import Link from "next/link";
import { FileX } from "lucide-react";
import { MoveArrow } from "@/components/move-arrow";
import type { CalendarDay, CalendarOrder } from "@/lib/queries/operate";

/**
 * One order on a calendar day, in one of three shapes that must never be
 * mistaken for each other.
 *
 * - **Out / back** keep the `MoveArrow` pair. A committed movement is filled:
 *   accent tint going out, sunken coming back.
 * - **Prospect** is the same arrow on a quote-stage order, drawn as a dashed
 *   outline with no fill — the dates are proposed, and a warehouse reading the
 *   month should not pull kit for them. The arrow stays because a prospect can
 *   still be going out or coming back.
 * - **Quote expires** is not a movement, so it gets no arrow at all: a page
 *   with an X. It used to be read as a return, which is the confusion this
 *   component exists to end.
 *
 * Shared by the Calendar screen and the week strip tile so the two cannot drift
 * the way the arrows once did.
 */

export type CalendarEntryKind = "out" | "back" | "expires";

const KIND_LABEL: Record<CalendarEntryKind, string> = {
  out: "Out",
  back: "Back",
  expires: "Quote expires",
};

export function CalendarEntry({
  order,
  kind,
}: {
  order: CalendarOrder;
  kind: CalendarEntryKind;
}) {
  const prospect = kind !== "expires" && order.prospect;

  const tone =
    kind === "expires"
      ? "border-transparent bg-sunken text-ink-muted"
      : prospect
        ? "border-dashed border-ink-faint bg-transparent text-ink-muted"
        : kind === "out"
          ? "border-transparent bg-accent-tint text-accent-on-tint"
          : "border-transparent bg-sunken text-ink-muted";

  return (
    <Link
      href={`/dashboard/orders/${order.id}`}
      title={`${prospect ? "Prospect · " : ""}${KIND_LABEL[kind]}: ${
        order.reservationNumber
      } · ${order.clientName}`}
      className={`flex items-center gap-1 truncate rounded-[4px] border px-1 text-micro hover:underline ${tone}`}
    >
      {kind === "expires" ? (
        <>
          <FileX
            aria-hidden="true"
            className="size-[1.2em] shrink-0"
            strokeWidth={2.25}
          />
          <span className="sr-only">Quote expires</span>
        </>
      ) : (
        <>
          <MoveArrow direction={kind} />
          {prospect ? <span className="sr-only">Prospect</span> : null}
        </>
      )}
      <span className="truncate">{order.clientName}</span>
    </Link>
  );
}

/**
 * The entries a day shows, capped per kind so a busy day stays glanceable —
 * two out, two back, two expiring — plus how many were left off.
 */
export function dayEntries(day: CalendarDay, perKind = 2) {
  const shown = [
    ...day.going.slice(0, perKind).map((order) => ({ order, kind: "out" as const })),
    ...day.coming.slice(0, perKind).map((order) => ({ order, kind: "back" as const })),
    ...day.expiring
      .slice(0, perKind)
      .map((order) => ({ order, kind: "expires" as const })),
  ];
  const total = day.going.length + day.coming.length + day.expiring.length;
  return { shown, hidden: total - shown.length };
}

/** The key, so nobody has to hover to learn what a dashed box means. */
export function CalendarLegend() {
  const swatch = "inline-flex items-center gap-1 rounded-[4px] border px-1";
  return (
    <span className="flex flex-wrap items-center gap-2 text-micro text-ink-muted">
      <span className={`${swatch} border-transparent bg-accent-tint text-accent-on-tint`}>
        <MoveArrow direction="out" labelled={false} /> Out
      </span>
      <span className={`${swatch} border-transparent bg-sunken`}>
        <MoveArrow direction="back" labelled={false} /> Back
      </span>
      <span className={`${swatch} border-dashed border-ink-faint`}>
        <MoveArrow direction="out" labelled={false} /> Prospect
      </span>
      <span className={`${swatch} border-transparent bg-sunken`}>
        <FileX aria-hidden="true" className="size-[1.2em]" strokeWidth={2.25} />{" "}
        Quote expires
      </span>
    </span>
  );
}
