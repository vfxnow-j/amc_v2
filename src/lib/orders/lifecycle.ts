import type { ReservationStatus, ReservationType } from "@/generated/prisma/client";
import { STATUS_LABEL } from "@/lib/reservations/status";

/**
 * The stages an order passes through, and which move is offered at each.
 *
 * The transitions themselves were already written — `lib/actions/reservations`
 * has carried `markQuoteSent`, `approveReservation`, `startPreparing`,
 * `markShipped`, `activateReservation` and `completeReservation` since v1, each
 * guarding its own precondition and writing a `StatusHistory` row. What was
 * missing was any way to reach them: the v2 order record rendered the status as
 * a pill and offered no way to move it.
 *
 * This module is the map. It is deliberately free of Prisma and of "use
 * server", so the record page and the client action bar can agree on what stage
 * an order is at without a round trip, and so a stage can never be labelled one
 * thing on the timeline and another on the button.
 *
 * The order of `LIFECYCLE` is the order of the timeline. `REVISION`, `CANCELLED`
 * and `LOST` are not in it — they are branches off the line, not points on it,
 * and the timeline renders them as such.
 */

/** The happy path, in order. The timeline draws exactly this. */
export const LIFECYCLE: ReservationStatus[] = [
  "DRAFT",
  "QUOTE_SENT",
  "APPROVED",
  "PREPARING",
  "SHIPPED",
  "ACTIVE",
  "COMPLETED",
];

/** Off the line: an order in one of these is not at a stage, it is at a stop. */
export const BRANCH_STATUSES: ReservationStatus[] = [
  "REVISION",
  "CANCELLED",
  "LOST",
];

/** What each stage means, said once, for the timeline's second line. */
export const STAGE_BLURB: Record<ReservationStatus, string> = {
  DRAFT: "Being priced",
  QUOTE_SENT: "With the client",
  REVISION: "Being repriced",
  APPROVED: "Client said yes",
  PREPARING: "Being pulled",
  SHIPPED: "On its way",
  ACTIVE: "Billing, with the client",
  COMPLETED: "Closed out",
  CANCELLED: "Called off",
  LOST: "Client said no",
};

/**
 * Which timestamp column records each stage. The record page reads these so a
 * completed stage can say *when*, rather than only that it happened.
 */
export const STAGE_STAMP: Partial<Record<ReservationStatus, string>> = {
  QUOTE_SENT: "quoteSentAt",
  APPROVED: "approvedAt",
  PREPARING: "preparingAt",
  SHIPPED: "shippedAt",
  COMPLETED: "completedAt",
  LOST: "lostAt",
};

/** Every move the record offers, named the way the button is labelled. */
export type Move =
  | "send-quote"
  | "approve"
  | "revise"
  | "lose"
  | "prepare"
  | "ship"
  | "activate"
  | "complete"
  | "cancel";

export type MoveSpec = {
  move: Move;
  label: string;
  /** What it does, shown under the label where there is room for it. */
  detail: string;
  /** The one move that is the obvious next thing to do from this status. */
  primary?: boolean;
};

/**
 * The moves offered at a status.
 *
 * These mirror the guards inside the ported actions rather than reinventing
 * them — `startPreparing` refuses anything but `APPROVED`, so `APPROVED` is the
 * only status that offers it. Where the two could drift the action wins: it is
 * the one holding the transaction, and its refusal is surfaced verbatim.
 *
 * `activate` is offered from three statuses because `activateReservation`
 * accepts three. A rental normally reaches ACTIVE through preparing and
 * shipping; a cloud order or a sale often has nothing to pull and goes straight
 * there from approved.
 */
const MOVES: Record<ReservationStatus, MoveSpec[]> = {
  DRAFT: [
    {
      move: "send-quote",
      label: "Send quote",
      detail: "Email the client a link, or copy one to send yourself",
      primary: true,
    },
    { move: "approve", label: "Mark approved", detail: "Skip the quote — the client already said yes" },
    { move: "cancel", label: "Cancel", detail: "Call the order off" },
  ],
  QUOTE_SENT: [
    { move: "approve", label: "Mark approved", detail: "The client accepted", primary: true },
    { move: "send-quote", label: "Re-send quote", detail: "Issue a fresh link" },
    { move: "revise", label: "Request revision", detail: "Pull it back to reprice" },
    { move: "lose", label: "Mark lost", detail: "The client declined" },
  ],
  REVISION: [
    { move: "send-quote", label: "Send revised quote", detail: "Issue a fresh link", primary: true },
    { move: "approve", label: "Mark approved", detail: "The client accepted the revision" },
    { move: "lose", label: "Mark lost", detail: "The client declined" },
  ],
  APPROVED: [
    {
      move: "prepare",
      label: "Prepare order",
      detail: "Hand it to the floor and tell the client it is being built",
      primary: true,
    },
    { move: "activate", label: "Activate order", detail: "Start billing without a prep step" },
    { move: "revise", label: "Request revision", detail: "Reprice before anything is pulled" },
    { move: "cancel", label: "Cancel", detail: "Call the order off" },
  ],
  PREPARING: [
    { move: "ship", label: "Mark shipped", detail: "Everything is checked out and on its way", primary: true },
    { move: "activate", label: "Activate order", detail: "Start billing now" },
    { move: "cancel", label: "Cancel", detail: "Call the order off" },
  ],
  SHIPPED: [
    { move: "activate", label: "Activate order", detail: "Start billing on the agreed cycle", primary: true },
    { move: "cancel", label: "Cancel", detail: "Call the order off" },
  ],
  ACTIVE: [
    { move: "complete", label: "Complete order", detail: "Everything is back — close it out", primary: true },
  ],
  COMPLETED: [],
  CANCELLED: [],
  LOST: [],
};

export function movesFor(status: ReservationStatus, type: ReservationType): MoveSpec[] {
  const moves = MOVES[status] ?? [];
  // A sale is never shipped back and never "completed" by return — it is done
  // when it is paid. `markShipped` still applies (the kit leaves the building),
  // so only the wording changes.
  if (type !== "SALE") return moves;
  return moves.map((spec) =>
    spec.move === "complete"
      ? { ...spec, label: "Close order", detail: "The sale is fulfilled and settled" }
      : spec,
  );
}

/** Where a status sits on the line — used to shade the timeline. */
export function stageIndex(status: ReservationStatus): number {
  const index = LIFECYCLE.indexOf(status);
  if (index >= 0) return index;
  // REVISION sits between quote sent and approved; the stops sit nowhere.
  if (status === "REVISION") return LIFECYCLE.indexOf("QUOTE_SENT");
  return -1;
}

/** True once the order is committed — a quote is not yet an order to invoice. */
export function isCommitted(status: ReservationStatus): boolean {
  return stageIndex(status) >= LIFECYCLE.indexOf("APPROVED");
}

export function stageLabel(status: ReservationStatus): string {
  return STATUS_LABEL[status];
}
