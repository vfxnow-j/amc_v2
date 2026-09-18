/**
 * Coverage bought on a purchase order, tied back to the units it covers.
 *
 * Melrose Mac sells AppleCare+ as its own PO line — "AppleCare+ for Mac Studio
 * (M4) (Auto Enroll)", quantity 8 — next to the hardware line it goes with. The
 * PO says which plan, how many and what it cost. It does not say which serials,
 * and receiving never wrote the PO onto the units it created (every unit on
 * these orders has `purchaseOrderId` null), so the tie from plan to unit is
 * made here, from what the records do agree on:
 *
 *   1. A plan line covers the hardware lines on the same PO of the device
 *      family it names (Mac mini, Mac Studio, MacBook Air …). Their quantities
 *      must add up to the plan's, or the PO is left alone.
 *   2. A hardware line's units are the units of its model that were received
 *      against the PO; failing that, the units of its model priced at the
 *      line's unit price and bought inside the PO's window (order date to the
 *      day it was received). The count must equal the line's quantity exactly —
 *      one short or one over and nothing is matched, because a guess about which
 *      serial is covered is worse than a gap.
 *
 * Nothing here produces a date. The PO does not state a term, so an
 * enrollment starts with neither start nor end, and gets them when somebody
 * reads them off the provider's record.
 */

export type PlanLine = {
  name: string;
  provider: string;
  /** "(Auto Enroll)": the seller registers it against the serial, not us. */
  autoEnroll: boolean;
  /** The device family the plan is for, or null when the line doesn't say. */
  family: DeviceFamily | null;
};

export type DeviceFamily = "mac-mini" | "mac-studio" | "macbook-air" | "macbook-pro" | "imac" | "mac-pro";

const FAMILIES: [DeviceFamily, RegExp][] = [
  // Longest names first, so "Mac mini" never claims a "MacBook" and "Mac Pro"
  // never claims a "Mac mini M4 PRO".
  ["macbook-air", /\bmac\s*book\s+air\b/i],
  ["macbook-pro", /\bmac\s*book\s+pro\b/i],
  ["mac-studio", /\bmac\s+studio\b/i],
  ["mac-mini", /\bmac\s*mini\b/i],
  ["imac", /\bimac\b/i],
  ["mac-pro", /\bmac\s+pro\b/i],
];

/** The Apple device family a line describes, if any. */
export function deviceFamily(description: string): DeviceFamily | null {
  for (const [family, pattern] of FAMILIES) {
    if (pattern.test(description)) return family;
  }
  return null;
}

/** A PO line that is a coverage plan rather than hardware, read for what it says. */
export function readPlanLine(description: string): PlanLine | null {
  if (!/\bapple\s*care\b/i.test(description)) return null;
  const withoutPlan = description.replace(/\bapple\s*care\s*\+?/i, "");
  return {
    name: /\bapple\s*care\s*\+/i.test(description) ? "AppleCare+" : "AppleCare",
    provider: "Apple",
    autoEnroll: /auto[\s-]*enrol/i.test(description),
    family: deviceFamily(withoutPlan),
  };
}

export type POLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  assetId: string | null;
  isInventoried: boolean;
};

export type PlanCover =
  | { planLine: POLine; plan: PlanLine; hardware: POLine[]; ok: true }
  | { planLine: POLine; plan: PlanLine; hardware: POLine[]; ok: false; reason: string };

/** Rule 1: which hardware lines on this PO each plan line covers. */
export function coverPlanLines(lines: POLine[]): PlanCover[] {
  const covers: PlanCover[] = [];
  for (const planLine of lines) {
    const plan = readPlanLine(planLine.description);
    if (!plan) continue;
    if (!plan.family) {
      covers.push({ planLine, plan, hardware: [], ok: false, reason: "the line doesn't name a device family" });
      continue;
    }
    const hardware = lines.filter(
      (line) =>
        line !== planLine &&
        line.assetId !== null &&
        line.isInventoried &&
        !readPlanLine(line.description) &&
        deviceFamily(line.description) === plan.family,
    );
    const units = hardware.reduce((sum, line) => sum + line.quantity, 0);
    if (hardware.length === 0) {
      covers.push({ planLine, plan, hardware, ok: false, reason: "no inventoried line of that family on the PO" });
    } else if (units !== planLine.quantity) {
      covers.push({
        planLine,
        plan,
        hardware,
        ok: false,
        reason: `${planLine.quantity} plans against ${units} units of that family`,
      });
    } else {
      covers.push({ planLine, plan, hardware, ok: true });
    }
  }
  return covers;
}

export type CandidateUnit = {
  id: string;
  barcode: string;
  assetId: string;
  purchaseOrderId: string | null;
  purchasePrice: number | null;
  purchaseDate: Date;
};

export type UnitMatch =
  | { ok: true; units: CandidateUnit[]; basis: "received" | "price-and-window" }
  | { ok: false; reason: string; units: CandidateUnit[] };

const DAY = 86_400_000;

/**
 * Rule 2: the units a hardware line delivered. `window` runs from the PO's order
 * date to the day it was received, a day of slack either side for time zones.
 * `taken` holds units already given to another line, so two lines of the same
 * model and price can't both claim one unit.
 */
export function unitsForLine(
  line: POLine,
  po: { id: string; window: { from: Date; to: Date } },
  units: CandidateUnit[],
  taken: Set<string> = new Set(),
): UnitMatch {
  const ofModel = units.filter((unit) => unit.assetId === line.assetId && !taken.has(unit.id));

  const received = ofModel.filter((unit) => unit.purchaseOrderId === po.id);
  if (received.length > 0) {
    return received.length === line.quantity
      ? { ok: true, units: received, basis: "received" }
      : { ok: false, units: received, reason: `${received.length} units received against the PO for a line of ${line.quantity}` };
  }

  const from = po.window.from.getTime() - DAY;
  const to = po.window.to.getTime() + DAY;
  const priced = ofModel.filter(
    (unit) =>
      unit.purchaseOrderId === null &&
      unit.purchasePrice !== null &&
      Math.round(unit.purchasePrice * 100) === Math.round(line.unitPrice * 100) &&
      unit.purchaseDate.getTime() >= from &&
      unit.purchaseDate.getTime() <= to,
  );
  return priced.length === line.quantity
    ? { ok: true, units: priced, basis: "price-and-window" }
    : {
        ok: false,
        units: priced,
        reason: `${priced.length} units of the model at ${line.unitPrice.toFixed(2)} inside the PO's dates, for a line of ${line.quantity}`,
      };
}
