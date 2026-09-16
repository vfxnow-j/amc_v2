import type {
  InteractionIntent,
  InteractionReach,
  NextStepKind,
  ReservationStatus,
  ReservationType,
  TemperatureBand,
} from "@/generated/prisma/client";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import {
  POSITIVE_INTENTS,
  formatMonths,
  type Band,
  type Tier,
} from "./labels";

/**
 * How warm an account is, what it is worth, and what is due on it — derived,
 * never stored (docs/client-tracker.md, "Temperature").
 *
 * Deliberately a pure module beside `lib/orders/lifecycle.ts`: no Prisma, no
 * "use server", no clock of its own. Everything it decides comes from facts the
 * caller loaded and a `now` the caller passes, so the badge on a record, the
 * row on the Tracker and the item in the queue are the same function applied to
 * the same rows and cannot disagree.
 */

const DAY = 86_400_000;

/** Last order within this many days is Hot. */
export const HOT_ORDER_DAYS = 60;
/** A positive conversation within this many days is Hot. */
export const HOT_CONVERSATION_DAYS = 30;
/** Past this, an account is Cold rather than Warm. */
export const WARM_UNTIL_DAYS = 90;
/** No move for this long is Dead. */
export const DEAD_AFTER_DAYS = 365;
/** Consecutive unanswered attempts that make a cold account Dead… */
export const DEAD_STREAK = 3;
/** …when they span at least this many days. */
export const DEAD_STREAK_SPAN_DAYS = 60;

/** A quote with no conversation this long after sending is chased. */
export const QUOTE_CHASE_DAYS = 5;
/** A Hot account with no touch for this long is going quiet. */
export const HOT_QUIET_DAYS = 30;
/** A rental whose return is this close gets an extend / buy-out / next-project call. */
export const RENTAL_ENDING_DAYS = 14;

const OPEN_BID: ReservationStatus[] = ["QUOTE_SENT", "REVISION"];
/** An order in one of these never happened, as far as temperature is concerned. */
const NOT_A_MOVE: ReservationStatus[] = ["CANCELLED", "LOST"];

export type OrderFact = {
  id: string;
  number: string;
  status: ReservationStatus;
  type: ReservationType;
  isRecurring: boolean;
  createdAt: Date;
  /** The return, for a rental. Never `endDate` — see `orderMove`. */
  completedAt: Date | null;
  quoteSentAt: Date | null;
  endDate: Date;
};

export type TouchFact = {
  occurredAt: Date;
  reach: InteractionReach;
  intent: InteractionIntent | null;
};

export type OpenStep = {
  id: string;
  at: Date;
  step: NextStepKind;
  summary: string;
};

export type AccountFacts = {
  createdAt: Date;
  orders: OrderFact[];
  /** Every logged conversation or attempt, any order. */
  touches: TouchFact[];
  seasonalMonths: number[];
  pin: { band: TemperatureBand; reason: string; until: Date } | null;
};

export type Temperature = {
  band: Band;
  /** Why, in a sentence a rep can repeat. For a pinned account, why it would be what it is unpinned. */
  reason: string;
  pinned: { reason: string; until: Date; underlying: Band } | null;
  /** The last order, return, or positive conversation — or creation, for an account with no orders. */
  lastMove: Date;
  /** The last logged conversation or attempt, or the last order activity, whichever is later. */
  lastTouch: Date;
  /** When a Warm account stopped being Hot. Null otherwise. */
  enteredWarmAt: Date | null;
  /** The first day of the next booking window, for a seasonal account. */
  nextWindowAt: Date | null;
};

export function daysSince(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / DAY);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

function latest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const date of dates) if (date && (!best || date > best)) best = date;
  return best;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The most recent order activity: created, or returned.
 *
 * `completedAt` rather than `endDate`, deliberately. A recurring order's
 * `endDate` is the end of a billing period, not a return — reading it as one
 * would call an account that has had kit out for a year "returned last week".
 * `completedAt` is stamped by the COMPLETED transition and is present on all 28
 * completed orders in this database.
 */
function orderMove(orders: OrderFact[]): Date | null {
  return latest(
    ...orders
      .filter((order) => !NOT_A_MOVE.includes(order.status))
      .flatMap((order) => [order.createdAt, order.completedAt]),
  );
}

/**
 * The booking window a seasonal account last had, and its next one.
 *
 * Months are 1–12 in local time. A window is a run of consecutive months and may
 * wrap the year. `lastStart` is the first day of the most recent run that began
 * on or before this month; `nextStart` is the first day of the next run that
 * begins after today.
 */
function seasonWindows(months: number[], now: Date) {
  const set = new Set(months);
  const monthAt = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const inSet = (date: Date) => set.has(date.getMonth() + 1);

  let lastStart: Date | null = null;
  for (let offset = 0; offset > -24; offset--) {
    const here = monthAt(offset);
    if (inSet(here) && !inSet(monthAt(offset - 1))) {
      lastStart = here;
      break;
    }
  }

  let nextStart: Date | null = null;
  for (let offset = 1; offset <= 24; offset++) {
    const here = monthAt(offset);
    if (inSet(here) && !inSet(monthAt(offset - 1))) {
      nextStart = here;
      break;
    }
  }

  return { inWindow: inSet(monthAt(0)), lastStart, nextStart };
}

/**
 * The unanswered streak: attempts since the last connected conversation or
 * order, newest first. Any connected conversation — even a NO_GO — resets it,
 * because somebody picked up.
 */
function unansweredStreak(touches: TouchFact[], orderAt: Date | null) {
  const sorted = [...touches].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const streak: TouchFact[] = [];
  for (const touch of sorted) {
    if (touch.reach === "CONNECTED") break;
    if (orderAt && touch.occurredAt < orderAt) break;
    streak.push(touch);
  }
  if (streak.length === 0) return { count: 0, spanDays: 0 };
  const newest = streak[0].occurredAt;
  const oldest = streak[streak.length - 1].occurredAt;
  return { count: streak.length, spanDays: daysSince(oldest, newest) };
}

/**
 * The band, by the spec's rules in the spec's order; the first match wins.
 *
 * **One reading beyond the spec, stated here so it is not mistaken for a bug.**
 * The spec puts Warm at "last move 60–90 days", but a move that is recent and
 * does not qualify for Hot — a positive conversation 45 days ago with no recent
 * order, or a brand-new account with nothing booked — would otherwise fall
 * between Hot and Warm. Those are Warm: anything under 90 days that is not Hot.
 */
export function temperatureOf(facts: AccountFacts, now: Date): Temperature {
  const underlying = unpinned(facts, now);
  const pin = facts.pin && facts.pin.until > now ? facts.pin : null;
  if (!pin) return underlying;

  return {
    ...underlying,
    band: pin.band,
    pinned: { reason: pin.reason, until: pin.until, underlying: underlying.band },
    // A pin says nothing about when the account left Hot; the queue should not
    // treat a pinned-Warm account as freshly cooled. Its Warm cadence then runs
    // from the last touch alone.
    enteredWarmAt: pin.band === "WARM" ? underlying.enteredWarmAt : null,
  };
}

function unpinned(facts: AccountFacts, now: Date): Temperature {
  const orderAt = orderMove(facts.orders);
  const positiveAt = latest(
    ...facts.touches
      .filter((t) => t.reach === "CONNECTED" && t.intent && POSITIVE_INTENTS.includes(t.intent))
      .map((t) => t.occurredAt),
  );
  // Creation counts as a move for Warm and never for Hot — nothing has been
  // earned yet — and only while the account has no real order behind it.
  const lastMove = latest(orderAt, positiveAt, orderAt ? null : facts.createdAt)!;
  const lastTouch = latest(orderAt, ...facts.touches.map((t) => t.occurredAt)) ?? facts.createdAt;

  const seasonal =
    facts.seasonalMonths.length > 0 && facts.seasonalMonths.length < 12
      ? seasonWindows(facts.seasonalMonths, now)
      : null;

  const base = {
    pinned: null,
    lastMove,
    lastTouch,
    enteredWarmAt: null,
    nextWindowAt: seasonal?.nextStart ?? null,
  };

  // 2. Something is live right now.
  const running = facts.orders.find((order) => OPEN_STATUSES.includes(order.status));
  if (running) {
    return { ...base, band: "HOT", reason: `${running.number} is running` };
  }
  const bid = facts.orders.find((order) => OPEN_BID.includes(order.status));
  if (bid) {
    return { ...base, band: "HOT", reason: `Quote ${bid.number} is out` };
  }

  // 3. Something happened recently enough to count.
  if (orderAt && daysSince(orderAt, now) <= HOT_ORDER_DAYS) {
    return { ...base, band: "HOT", reason: `Last order activity ${plural(daysSince(orderAt, now), "day")} ago` };
  }
  if (positiveAt && daysSince(positiveAt, now) <= HOT_CONVERSATION_DAYS) {
    return {
      ...base,
      band: "HOT",
      reason: `Positive conversation ${plural(daysSince(positiveAt, now), "day")} ago`,
    };
  }

  // 4. Resting between booking windows — but only if the last window was not
  // allowed to pass in silence.
  if (seasonal && !seasonal.inWindow && seasonal.lastStart && lastMove >= seasonal.lastStart) {
    return {
      ...base,
      band: "SEASONAL",
      reason: `Books ${formatMonths(facts.seasonalMonths)} — resting until the window`,
    };
  }

  const idle = daysSince(lastMove, now);

  // 5. Gone.
  if (idle >= DEAD_AFTER_DAYS) {
    return { ...base, band: "DEAD", reason: `No move in ${plural(Math.floor(idle / 30), "month")}` };
  }
  const streak = unansweredStreak(facts.touches, orderAt);
  if (
    streak.count >= DEAD_STREAK &&
    streak.spanDays >= DEAD_STREAK_SPAN_DAYS &&
    idle > WARM_UNTIL_DAYS
  ) {
    return {
      ...base,
      band: "DEAD",
      reason: `${streak.count} unanswered attempts over ${streak.spanDays} days`,
    };
  }

  // 6. Cooling.
  if (idle < WARM_UNTIL_DAYS) {
    const hotUntil = latest(
      orderAt ? addDays(orderAt, HOT_ORDER_DAYS) : null,
      positiveAt ? addDays(positiveAt, HOT_CONVERSATION_DAYS) : null,
    );
    return {
      ...base,
      band: "WARM",
      enteredWarmAt: hotUntil ?? facts.createdAt,
      reason: orderAt
        ? `Last move ${plural(idle, "day")} ago`
        : positiveAt
          ? `Last positive conversation ${plural(idle, "day")} ago`
          : `New account, nothing booked yet`,
    };
  }

  // 7. Cold.
  return {
    ...base,
    band: "COLD",
    reason:
      seasonal?.lastStart && !seasonal.inWindow
        ? `Books ${formatMonths(facts.seasonalMonths)}, but the last window passed with no move`
        : `Last move ${plural(idle, "day")} ago`,
  };
}

/* ── Value tier ─────────────────────────────────────────────────────────── */

/** Top 20% of accounts with booked value are A. */
export const TIER_A_SHARE = 0.2;
/** The next 30% are B. */
export const TIER_B_SHARE = 0.3;

/**
 * A / B / C by trailing-12-month booked value, among accounts that booked
 * anything. Everyone else, including zero, is C. The cut-offs are shares, not
 * dollar figures, so they move as the business grows.
 */
export function tiersOf(bookedById: Map<string, number>): Map<string, Tier> {
  const ranked = [...bookedById.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const aCount = Math.ceil(ranked.length * TIER_A_SHARE);
  const bCount = Math.ceil(ranked.length * (TIER_A_SHARE + TIER_B_SHARE)) - aCount;

  const tiers = new Map<string, Tier>();
  ranked.forEach(([id], index) => {
    tiers.set(id, index < aCount ? "A" : index < aCount + bCount ? "B" : "C");
  });
  return tiers;
}

/* ── The matrix ─────────────────────────────────────────────────────────── */

export type Play = {
  /** What to do, from the spec's matrix. */
  play: string;
  /** Lower is more urgent. Warm A is 1: the cheapest revenue to recover is revenue already proven. */
  rank: number;
};

const MATRIX: Record<TemperatureBand, Record<Tier, Play>> = {
  WARM: {
    A: { play: "Call now", rank: 1 },
    B: { play: "Call soon", rank: 5 },
    C: { play: "Check in", rank: 9 },
  },
  HOT: {
    A: { play: "Owner call, expand", rank: 2 },
    B: { play: "Expand — cross-sell", rank: 6 },
    C: { play: "Serve well, no chasing", rank: 11 },
  },
  COLD: {
    A: { play: "Win-back plan", rank: 3 },
    B: { play: "Re-engage", rank: 7 },
    C: { play: "Nurture", rank: 12 },
  },
  SEASONAL: {
    A: { play: "Pre-window proposal", rank: 4 },
    B: { play: "Pre-window call", rank: 8 },
    C: { play: "Pre-window email", rank: 13 },
  },
  DEAD: {
    A: { play: "Senior touch, then low", rank: 10 },
    B: { play: "Low-touch", rank: 14 },
    C: { play: "Archive from active lists", rank: 15 },
  },
};

/**
 * A lead sits beside Warm B in urgency. The spec gives prospects no matrix row;
 * this places an open enquiry above established accounts that only need a
 * check-in, and below any proven account that is cooling.
 */
const PROSPECT_PLAY: Play = { play: "Qualify and convert", rank: 5 };

export function playFor(band: Band, tier: Tier): Play {
  return band === "PROSPECT" ? PROSPECT_PLAY : MATRIX[band][tier];
}

/* ── Cadence ────────────────────────────────────────────────────────────── */

/**
 * Days between touches, by band and tier. `null` means no cadence — Dead C is
 * archived, not chased. SEASONAL is different in kind: it is how many days
 * *before the next window* to call, not an interval.
 */
export type Cadence = Record<TemperatureBand, Record<Tier, number | null>>;

export const DEFAULT_CADENCE: Cadence = {
  HOT: { A: 21, B: 30, C: 45 },
  WARM: { A: 3, B: 7, C: 14 },
  COLD: { A: 30, B: 45, C: 90 },
  DEAD: { A: 90, B: 180, C: null },
  SEASONAL: { A: 56, B: 42, C: 28 },
};

export const CADENCE_SETTING_KEY = "tracker.cadence";

/**
 * Reads the `tracker.cadence` Setting cell by cell. A cell that is missing or
 * not a sensible whole number of days keeps its default, so one bad edit cannot
 * silence a whole band.
 */
export function parseCadence(value: unknown): Cadence {
  const cadence = structuredClone(DEFAULT_CADENCE);
  if (!value || typeof value !== "object") return cadence;
  for (const band of Object.keys(cadence) as TemperatureBand[]) {
    const row = (value as Record<string, unknown>)[band];
    if (!row || typeof row !== "object") continue;
    for (const tier of ["A", "B", "C"] as Tier[]) {
      const cell = (row as Record<string, unknown>)[tier];
      if (cell === null) cadence[band][tier] = null;
      else if (typeof cell === "number" && Number.isInteger(cell) && cell > 0 && cell <= 730) {
        cadence[band][tier] = cell;
      }
    }
  }
  return cadence;
}

/* ── The follow-up queue ────────────────────────────────────────────────── */

export type QueueReason =
  | { kind: "NEXT_STEP"; due: Date; step: NextStepKind; summary: string; stepId: string }
  | { kind: "CADENCE"; due: Date; days: number }
  | { kind: "QUOTE_UNANSWERED"; due: Date; orderId: string; orderNumber: string }
  | { kind: "GOING_QUIET"; due: Date }
  | { kind: "RENTAL_ENDING"; due: Date; orderId: string; orderNumber: string; endDate: Date };

/**
 * Everything due on one account today. All five kinds are derived from stored
 * rows and `now`, so the queue needs no scheduled job and cannot drift.
 *
 * Leads get only their own next steps. The spec's cadence table is written for
 * accounts, and an enquiry already has the Leads list watching it go stale.
 */
export function queueReasonsFor(input: {
  facts: AccountFacts;
  temperature: Temperature;
  tier: Tier;
  cadence: Cadence;
  openSteps: OpenStep[];
  now: Date;
}): QueueReason[] {
  const { facts, temperature, tier, cadence, openSteps, now } = input;
  const reasons: QueueReason[] = [];
  const touchedSince = (date: Date) => facts.touches.some((t) => t.occurredAt >= date);

  // 1. A next step somebody promised.
  for (const step of openSteps) {
    if (step.at <= now) {
      reasons.push({
        kind: "NEXT_STEP",
        due: step.at,
        step: step.step,
        summary: step.summary,
        stepId: step.id,
      });
    }
  }

  if (temperature.band === "PROSPECT") return reasons;
  const band = temperature.band;

  // 2. Cadence — unless a future step is already booked, which is the cadence
  // being kept rather than missed.
  const booked = openSteps.some((step) => step.at > now);
  const days = cadence[band][tier];
  if (!booked && days !== null) {
    let due: Date | null = null;
    if (band === "SEASONAL") {
      const callBy = temperature.nextWindowAt ? addDays(temperature.nextWindowAt, -days) : null;
      if (callBy && !touchedSince(callBy)) due = callBy;
    } else if (band === "WARM") {
      due = addDays(latest(temperature.lastTouch, temperature.enteredWarmAt)!, days);
    } else {
      due = addDays(temperature.lastTouch, days);
    }
    if (due && due <= now) reasons.push({ kind: "CADENCE", due, days });
  }

  // 3. A quote nobody has chased.
  for (const order of facts.orders) {
    if (order.status !== "QUOTE_SENT" || !order.quoteSentAt) continue;
    const due = addDays(order.quoteSentAt, QUOTE_CHASE_DAYS);
    if (due <= now && !touchedSince(order.quoteSentAt)) {
      reasons.push({ kind: "QUOTE_UNANSWERED", due, orderId: order.id, orderNumber: order.number });
    }
  }

  // 4. Going quiet: a Hot account nobody has spoken to in a month, or one that
  // has just cooled into Warm with nobody noticing.
  if (band === "HOT") {
    const due = addDays(temperature.lastTouch, HOT_QUIET_DAYS);
    if (due <= now) reasons.push({ kind: "GOING_QUIET", due });
  } else if (band === "WARM" && temperature.enteredWarmAt && !touchedSince(temperature.enteredWarmAt)) {
    reasons.push({ kind: "GOING_QUIET", due: temperature.enteredWarmAt });
  }

  // 5. A rental about to come back. Non-recurring only: a recurring order's
  // end date is a billing period, not a return.
  for (const order of facts.orders) {
    if (order.type !== "RENTAL" || order.isRecurring) continue;
    if (order.status !== "ACTIVE" && order.status !== "SHIPPED") continue;
    if (order.endDate < now) continue;
    const due = addDays(order.endDate, -RENTAL_ENDING_DAYS);
    if (due <= now && !touchedSince(due)) {
      reasons.push({
        kind: "RENTAL_ENDING",
        due,
        orderId: order.id,
        orderNumber: order.number,
        endDate: order.endDate,
      });
    }
  }

  return reasons;
}
