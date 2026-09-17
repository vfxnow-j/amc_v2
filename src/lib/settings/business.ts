import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_BILLING_ANCHOR,
  MONTHLY_ANCHOR_LABEL,
  WEEKDAY_LABEL,
  type BillingAnchor,
  type MonthlyAnchor,
} from "@/lib/billing/calendar";

/**
 * The business's billing anchor, read from `settings`.
 *
 * One row, `business_billing_anchor`, holding `{ monthly, weekly }`. Absent or
 * malformed means the default — the 1st and Monday — because the 1st is what
 * the client agreements say, and a billing run that stopped on a bad setting
 * row would be worse than one that bills on the day the paperwork promises.
 *
 * Not an action and not auth-gated: the billing run reads this from the cron
 * with no session. Writing it is gated, in `lib/settings/business-actions.ts`.
 */

export const BILLING_ANCHOR_KEY = "business_billing_anchor";

export function parseBillingAnchor(value: unknown): BillingAnchor {
  const raw = (value ?? {}) as { monthly?: unknown; weekly?: unknown };
  const monthly: MonthlyAnchor =
    raw.monthly === 15 || raw.monthly === "15"
      ? 15
      : raw.monthly === "EOM"
        ? "EOM"
        : DEFAULT_BILLING_ANCHOR.monthly;
  const weekly =
    Number.isInteger(raw.weekly) && (raw.weekly as number) >= 0 && (raw.weekly as number) <= 6
      ? (raw.weekly as number)
      : DEFAULT_BILLING_ANCHOR.weekly;
  return { monthly, weekly };
}

export const getBillingAnchor = cache(async (): Promise<BillingAnchor> => {
  const row = await prisma.setting.findUnique({ where: { key: BILLING_ANCHOR_KEY } });
  return parseBillingAnchor(row?.value);
});

/** "Monthly on the 1st · weekly on Monday". */
export function describeBillingAnchor(anchor: BillingAnchor): string {
  const monthly = MONTHLY_ANCHOR_LABEL[String(anchor.monthly)]
    .replace(/^The /, "the ")
    .replace(" of the month", "");
  return `Monthly on ${monthly} · weekly on ${WEEKDAY_LABEL[anchor.weekly]}`;
}
