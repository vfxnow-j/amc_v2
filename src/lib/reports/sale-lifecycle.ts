/**
 * Sale lifecycle: what a sold unit did between joining the fleet and leaving
 * it — what it cost, what it earned on rental, what it was worth on the books
 * when it sold, and what the sale put in our pocket after fees.
 *
 * Pure, so the report and its tests share one set of formulas. Book value goes
 * through `lib/inventory/depreciation`, which refuses methods it has no
 * schedule for rather than printing the purchase price as a book value.
 */
import { bookValue } from "@/lib/inventory/depreciation";
import { depreciationMonthsElapsed } from "@/lib/utils/depreciation";
import { netReceived } from "@/lib/sales/sale-channel";

// purchaseDate values stamped during the v1 import, not real purchases. A unit
// with only one of these has an unknown age, so no book value either.
const IMPORT_STAMPS = new Set(["2026-02-07", "2026-02-20"]);

const ymd = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;

export type LifecycleCheckout = {
  checkoutDate: Date;
  actualReturn: Date | null;
  reservationId: string | null;
  reservationNumber: string | null;
  clientName: string | null;
};

export type LifecycleInput = {
  /** Landed cost (invoice price plus the unit's share), or null if uncosted. */
  cost: number | null;
  purchaseDate: Date | null;
  receivedDate: Date | null;
  soldAt: Date;
  soldPrice: number | null;
  saleFees: number | null;
  rentalRevenue: number;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvageValue: number;
  checkouts: LifecycleCheckout[];
};

export type LifecycleTimelineEvent = {
  date: string;
  kind: "ACQUIRED" | "OUT" | "SOLD";
  label: string;
  reservationId?: string | null;
  endDate?: string | null;
};

export type LifecycleResult = {
  acquiredAt: string | null;
  /** True when the only date we have is an import stamp. */
  acquiredUnknown: boolean;
  monthsOwned: number | null;
  rentals: number;
  daysOnRent: number;
  rentalRevenue: number;
  bookValueAtSale: number | null;
  net: number | null;
  /** Net sale vs book value at the sale date. */
  gainVsBook: number | null;
  /** Rental revenue + net sale - cost: did the unit pay for itself? */
  totalReturn: number | null;
  /** totalReturn / cost, as a percentage. */
  returnPct: number | null;
  flags: string[];
  timeline: LifecycleTimelineEvent[];
};

export function buildLifecycle(u: LifecycleInput): LifecycleResult {
  const flags: string[] = [];
  const start = u.receivedDate ?? u.purchaseDate;
  const acquiredUnknown =
    !u.receivedDate && !!u.purchaseDate && IMPORT_STAMPS.has(ymd(u.purchaseDate)!);
  // A start after the sale can only be a placeholder date too.
  const startUsable =
    !!start && !acquiredUnknown && start.getTime() <= u.soldAt.getTime();
  if (acquiredUnknown) {
    flags.push("Purchase date is an import stamp: age and book value unknown");
  } else if (start && !startUsable) {
    flags.push("Acquired date is after the sale: age and book value unknown");
  }

  const hasCost = u.cost != null && u.cost > 0;
  if (!hasCost) flags.push("No purchase cost");

  const monthsOwned = startUsable
    ? depreciationMonthsElapsed(start!, u.soldAt)
    : null;
  const book =
    startUsable && hasCost
      ? bookValue(
          {
            purchasePrice: u.cost,
            landedCostAdjustment: 0,
            purchaseDate: u.purchaseDate ?? start!,
            receivedDate: u.receivedDate,
          },
          {
            method: u.depreciationMethod,
            usefulLifeMonths: u.usefulLifeMonths,
            salvageValue: u.salvageValue,
          },
          u.soldAt,
        )
      : null;
  const bookValueAtSale = book ? round2(book.book) : null;

  if (u.soldPrice == null) flags.push("No sale price");
  // Unknown fees count as zero in the net, but say so.
  if (u.soldPrice != null && u.saleFees == null) {
    flags.push("Fees not recorded: net may be overstated");
  }
  const net = netReceived(u.soldPrice, u.saleFees);

  const gainVsBook =
    net != null && bookValueAtSale != null ? round2(net - bookValueAtSale) : null;
  const totalReturn =
    net != null && hasCost ? round2(u.rentalRevenue + net - u.cost!) : null;
  const returnPct =
    totalReturn != null && hasCost ? round2((totalReturn / u.cost!) * 100) : null;

  // Time out on rental, clipped to the sale (a checkout left open at sale ends
  // there).
  const soldMs = u.soldAt.getTime();
  const outs = [...u.checkouts].sort(
    (a, b) => a.checkoutDate.getTime() - b.checkoutDate.getTime(),
  );
  let daysOnRent = 0;
  for (const c of outs) {
    const from = c.checkoutDate.getTime();
    const to = Math.min(c.actualReturn?.getTime() ?? soldMs, soldMs);
    if (to > from) daysOnRent += (to - from) / DAY;
  }

  const timeline: LifecycleTimelineEvent[] = [];
  if (start) {
    timeline.push({
      date: ymd(start)!,
      kind: "ACQUIRED",
      label: acquiredUnknown
        ? "Imported (real purchase date unknown)"
        : u.receivedDate
          ? "Received"
          : "Purchased",
    });
  }
  for (const c of outs) {
    timeline.push({
      date: ymd(c.checkoutDate)!,
      kind: "OUT",
      label:
        [c.reservationNumber, c.clientName].filter(Boolean).join(" · ") ||
        "Checked out",
      reservationId: c.reservationId,
      endDate: ymd(c.actualReturn),
    });
  }
  timeline.push({ date: ymd(u.soldAt)!, kind: "SOLD", label: "Sold" });
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  if (outs.length === 0) flags.push("No rental history on record");

  return {
    acquiredAt: ymd(start),
    acquiredUnknown,
    monthsOwned,
    rentals: outs.length,
    daysOnRent: Math.round(daysOnRent),
    rentalRevenue: round2(u.rentalRevenue),
    bookValueAtSale,
    net,
    gainVsBook,
    totalReturn,
    returnPct,
    flags,
    timeline,
  };
}
