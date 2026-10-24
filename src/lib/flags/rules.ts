// Pure rules for order flag cases. No Prisma runtime import (client components use this).
import type { FlagOutcome } from "@/generated/prisma/client";
import { outcomeDef } from "./catalog";

export type RuleKey = "overdue_return" | "payment_overdue" | "missing_serial";

export type OrderAutoFacts = {
  returnDue: Date | null;
  unitsOut: number;
  invoicePastDue: boolean;
  unitsDataFlagged: number;
};

const DAY = 86_400_000;

export function overdueDays(returnDue: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - returnDue.getTime()) / DAY));
}

export function exposureFor(
  units: { purchasePrice: number; landedCostAdjustment: number }[],
): number {
  const sum = units.reduce((s, u) => s + u.purchasePrice + u.landedCostAdjustment, 0);
  return Math.round(sum * 100) / 100;
}

export function canClose(i: {
  outcome: FlagOutcome | null;
  amount: number | null;
  stepsOpen: number;
  unitsStillMissing: number;
}): { ok: true } | { ok: false; message: string } {
  if (!i.outcome) return { ok: false, message: "Choose an outcome to close this case." };
  const def = outcomeDef(i.outcome);
  if (def.needsAmount && (i.amount === null || i.amount <= 0)) {
    return { ok: false, message: "Enter the amount for this outcome." };
  }
  if (def.unitsEnd === "restore" && i.unitsStillMissing > 0) {
    return {
      ok: false,
      message: `${i.unitsStillMissing} unit${i.unitsStillMissing === 1 ? " is" : "s are"} still missing. Keep the case open for them.`,
    };
  }
  return { ok: true };
}

export function isStale(
  f: { nextActionDate: Date | null; resolvedAt: Date | null },
  now: Date,
): boolean {
  return f.resolvedAt === null && f.nextActionDate !== null && f.nextActionDate.getTime() < now.getTime();
}

/** Which system flags should be raised or cleared, given the order's facts and its open system flags. */
export function autoRaiseDecisions(
  facts: OrderAutoFacts,
  open: { ruleKey: string }[],
  now: Date,
): { raise: RuleKey[]; clear: RuleKey[] } {
  const holds: Record<RuleKey, boolean> = {
    overdue_return: facts.returnDue !== null && facts.unitsOut > 0 && facts.returnDue.getTime() < now.getTime(),
    payment_overdue: facts.invoicePastDue,
    missing_serial: facts.unitsDataFlagged > 0,
  };
  const have = new Set(open.map((o) => o.ruleKey));
  const raise: RuleKey[] = [];
  const clear: RuleKey[] = [];
  for (const key of Object.keys(holds) as RuleKey[]) {
    if (holds[key] && !have.has(key)) raise.push(key);
    if (!holds[key] && have.has(key)) clear.push(key);
  }
  return { raise, clear };
}
