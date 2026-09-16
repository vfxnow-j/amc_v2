import { day } from "@/lib/format";
import {
  BAND_ACCENT,
  BAND_LABEL,
  NEXT_STEP_LABEL,
  type Band,
} from "@/lib/tracker/labels";
import type { QueueReason } from "@/lib/tracker/temperature";

/**
 * A band, said in words and reinforced in colour — never colour alone.
 *
 * The hue comes from the tile-accent set through `data-accent`, whose text-on-
 * tint pairs are already proven at 5.28:1 or better in both modes. No new
 * colour is introduced here, so there is no new contrast to prove.
 */
export function BandPill({ band, pinned = false }: { band: Band; pinned?: boolean }) {
  return (
    <span
      data-accent={BAND_ACCENT[band]}
      className="inline-flex flex-none items-center rounded-pill bg-[var(--tile-accent-tint)] px-2 py-[1px] text-pill text-[var(--tile-accent-text)]"
    >
      {BAND_LABEL[band]}
      {pinned ? <span className="opacity-80">&nbsp;· pinned</span> : null}
    </span>
  );
}

export const REASON_LABEL: Record<QueueReason["kind"], string> = {
  NEXT_STEP: "Next step",
  CADENCE: "Cadence",
  QUOTE_UNANSWERED: "Quote unanswered",
  GOING_QUIET: "Going quiet",
  RENTAL_ENDING: "Rental ending",
};

/** One due item as a sentence, for the record card. */
export function reasonText(reason: QueueReason): string {
  switch (reason.kind) {
    case "NEXT_STEP":
      return `${NEXT_STEP_LABEL[reason.step]} was due ${day(reason.due)} — ${reason.summary}`;
    case "CADENCE":
      return `No touch within the ${reason.days}-day cadence — due ${day(reason.due)}`;
    case "QUOTE_UNANSWERED":
      return `Quote ${reason.orderNumber} has had no conversation since it went out`;
    case "GOING_QUIET":
      return `Going quiet — nobody has spoken to them since ${day(reason.due)}`;
    case "RENTAL_ENDING":
      return `${reason.orderNumber} comes back ${day(reason.endDate)} — extend, buy out, or next project?`;
  }
}
