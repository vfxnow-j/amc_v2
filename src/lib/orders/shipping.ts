import type { DeliveryMethod } from "@/generated/prisma/client";
import { holidayOn } from "@/lib/calendar/holidays";

/**
 * The vocabulary of how an order travels. Prisma-free on purpose.
 *
 * The card that reads shipping is a Server Component and its edit dialog is a
 * client one, and both need these labels. Exporting them from the card would
 * pull the card's query — and through it `lib/prisma` — into the browser
 * bundle, which is the same trap `queries/range.ts` and `nav/clusters.ts` are
 * each split out to avoid. A type-only import of the enum is erased at compile
 * time and costs nothing.
 *
 * `deliveryMethodLabels` in lib/types splits the same enum into an outbound set
 * and a return set, and drops two of the six from each — so a return booked as
 * CUSTOMER_PICKUP rendered as nothing at all. One map over the whole enum here,
 * and the two arrays below decide only what a picker *offers* per direction,
 * never what a stored value is called.
 */
export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  CUSTOMER_PICKUP: "Customer collects",
  CUSTOMER_DROPOFF: "Customer returns it",
  LOCAL_DELIVERY: "Local delivery",
  LOCAL_PICKUP: "Local pickup",
  SMALL_PACKAGE: "Small package",
  FREIGHT: "Freight",
};

export const OUT_METHODS: DeliveryMethod[] = [
  "LOCAL_DELIVERY",
  "SMALL_PACKAGE",
  "FREIGHT",
  "CUSTOMER_PICKUP",
];

export const BACK_METHODS: DeliveryMethod[] = [
  "LOCAL_PICKUP",
  "SMALL_PACKAGE",
  "FREIGHT",
  "CUSTOMER_DROPOFF",
];

/** Methods where a parcel travels with a carrier, so a tracking number applies. */
export const CARRIED: DeliveryMethod[] = ["SMALL_PACKAGE", "FREIGHT"];

/* ── Shipping speed and the ship date (owner, 2026-09-17) ─────────────────── */

/**
 * How fast the outbound leg travels, and how many business days it takes.
 *
 * The ship date is the day the kit has to leave so it arrives for the order's
 * start: count back the transit days from the start, skipping weekends. The
 * transit days are working assumptions — ground is 1–5 days depending on
 * distance, so it is planned at the long end — and any single order can take a
 * date typed by hand instead. When the carrier's API is connected, its quoted
 * transit time replaces these.
 */
export type ShippingSpeed =
  | "SAME_DAY"
  | "OVERNIGHT"
  | "TWO_DAY"
  | "THREE_DAY"
  | "GROUND"
  | "FREIGHT_EXPEDITED"
  | "FREIGHT_STANDARD";

export const SPEED: Record<ShippingSpeed, { label: string; transitDays: number }> = {
  SAME_DAY: { label: "Same day", transitDays: 0 },
  OVERNIGHT: { label: "Overnight", transitDays: 1 },
  TWO_DAY: { label: "2-day", transitDays: 2 },
  THREE_DAY: { label: "3-day", transitDays: 3 },
  GROUND: { label: "Ground", transitDays: 5 },
  FREIGHT_EXPEDITED: { label: "Expedited freight", transitDays: 3 },
  FREIGHT_STANDARD: { label: "Standard freight", transitDays: 7 },
};

/** The speeds that apply to each outbound method. A pickup has none. */
export const SPEEDS_FOR: Partial<Record<DeliveryMethod, ShippingSpeed[]>> = {
  LOCAL_DELIVERY: ["SAME_DAY", "OVERNIGHT"],
  SMALL_PACKAGE: ["OVERNIGHT", "TWO_DAY", "THREE_DAY", "GROUND"],
  FREIGHT: ["FREIGHT_EXPEDITED", "FREIGHT_STANDARD"],
};

export function speedApplies(method: DeliveryMethod | null, speed: ShippingSpeed | null): boolean {
  return speed === null || (method !== null && (SPEEDS_FOR[method] ?? []).includes(speed));
}

const MS_PER_DAY = 86_400_000;

/**
 * The day it has to ship to arrive for `arriveBy` (a stored day, noon UTC).
 * A weekend or carrier-holiday arrival is planned for the working day before;
 * the count then steps back over working days only, so a Monday start on 2-day
 * ships the Thursday before, and the Monday after Thanksgiving ships Wednesday.
 */
export function shipByDate(arriveBy: Date, speed: ShippingSpeed): Date {
  let day = new Date(arriveBy);
  // A carrier working day: not a weekend, and not a holiday the carriers close
  // for (lib/calendar/holidays). A start on July 4th arrives on the 3rd.
  const working = () => day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !holidayOn(day)?.carrierClosed;
  const back = () => {
    day = new Date(day.getTime() - MS_PER_DAY);
  };
  while (!working()) back();
  for (let left = SPEED[speed].transitDays; left > 0; ) {
    back();
    if (working()) left--;
  }
  return day;
}

/** The ship date an order works to: typed by hand, else worked out from its speed. */
export function effectiveShipDate(order: {
  startDate: Date;
  shipSpeed: ShippingSpeed | null;
  shipDate: Date | null;
}): { date: Date; manual: boolean } | null {
  if (order.shipDate) return { date: order.shipDate, manual: true };
  if (order.shipSpeed) return { date: shipByDate(order.startDate, order.shipSpeed), manual: false };
  return null;
}
