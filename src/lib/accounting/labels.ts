import type { InvoiceStatus, LeaseStatus, POStatus } from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";

/**
 * The Revenue cluster's vocabulary. Prisma-free so the filter strips, which are
 * client components, can import it without dragging the pg driver into the
 * browser bundle.
 */

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PAID: "Paid",
  PARTIAL: "Part paid",
  OVERDUE: "Overdue",
  CANCELLED: "Canceled",
  VOID: "Void",
};

/**
 * Unsettled: money somebody is still waiting for. `OVERDUE` is in the list
 * because it is a stored status a nightly job maintains, not because the column
 * can be trusted on its own — see `isInvoiceOverdue`.
 *
 * Lives here rather than in the query layer so the record screens, which judge
 * one invoice at a time, and the list, which judges them in bulk, can't drift
 * apart. `queries/accounting.ts` builds its `UNSETTLED` where-clause from this.
 */
export const UNSETTLED_STATUSES: InvoiceStatus[] = ["SENT", "PARTIAL", "OVERDUE"];

/**
 * The one definition of overdue in this app: unsettled **and** past its due
 * date. The stored `Invoice.status = OVERDUE` lags a nightly job, so an invoice
 * can be genuinely late while the column still reads SENT — and a screen that
 * believed the column would quietly disagree with the list beside it.
 */
export function isInvoiceOverdue(
  status: InvoiceStatus,
  dueDate: Date,
  now: Date,
): boolean {
  return UNSETTLED_STATUSES.includes(status) && dueDate < now;
}

export const INVOICE_VIEWS = [
  "outstanding",
  "overdue",
  "paid",
  "draft",
  "all",
] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number];

export const INVOICE_VIEW_LABEL: Record<InvoiceView, string> = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  paid: "Paid",
  draft: "Draft",
  all: "All",
};

export const isInvoiceView = oneOf(INVOICE_VIEWS);

/**
 * Contracts merges three v1 screens. Leases is a **view, not a filter chip**
 * (owner, 2026-07-28): hardware bought on a lease has paydown economics that
 * sales and rent-to-own don't, so it needs its own columns — lender, monthly
 * payment, payoff — not the same table filtered.
 */
export const CONTRACT_VIEWS = ["sales", "rent-to-own", "leases"] as const;
export type ContractView = (typeof CONTRACT_VIEWS)[number];

export const CONTRACT_VIEW_LABEL: Record<ContractView, string> = {
  sales: "Sales",
  "rent-to-own": "Rent to own",
  leases: "Leases",
};

export const isContractView = oneOf(CONTRACT_VIEWS);

export const LEASE_STATUS_LABEL: Record<LeaseStatus, string> = {
  ACTIVE: "Active",
  PAID_OFF: "Paid off",
  DEFAULTED: "Defaulted",
  TRANSFERRED: "Transferred",
};

export const PO_STATUS_LABEL: Record<POStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTIAL: "Part received",
  RECEIVED: "Received",
  CANCELLED: "Canceled",
};

export const PO_VIEWS = ["open", "received", "draft", "all"] as const;
export type POView = (typeof PO_VIEWS)[number];

export const PO_VIEW_LABEL: Record<POView, string> = {
  open: "On order",
  received: "Received",
  draft: "Draft",
  all: "All",
};

export const isPOView = oneOf(PO_VIEWS);

/**
 * Which column on `Asset` a rate card's tier corresponds to.
 *
 * Only three of the six `PricingType` members have one. HOURLY, PROJECT and
 * CUSTOM exist on an order line but have no catalog column behind them, so a
 * rate card carrying one has nothing to be compared against or applied to — the
 * record says so rather than dropping it silently.
 */
export const RATE_FIELD = {
  DAILY: "dailyRate",
  WEEKLY: "weeklyRate",
  MONTHLY: "monthlyRate",
} as const;

export type PricedRateType = keyof typeof RATE_FIELD;

/**
 * The priced tiers, shortest period first — the order a rate card is read in.
 *
 * Derived from `RATE_FIELD` rather than listed again, so a tier cannot be added
 * to one and forgotten in the other. Screens that lay the tiers out as columns
 * import this instead of writing the three names a fourth time.
 */
export const PRICED_RATE_TIERS = Object.keys(RATE_FIELD) as PricedRateType[];

export function isPricedRateType(value: string): value is PricedRateType {
  return Object.hasOwn(RATE_FIELD, value);
}

export const RATE_TIER_LABEL: Record<PricedRateType, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

/**
 * How a PO line lands when it is received.
 *
 * `POItem` stores this as two booleans whose combinations are not all
 * meaningful, so it is resolved into one word at the query layer and both the
 * record and the receive panel read that. Lives here, with the rest of the
 * cluster's Prisma-free vocabulary, because the receive panel is a client
 * component and importing the query module would drag the pg driver into the
 * browser.
 *
 * - `units` — serialized: one `AssetUnit` per item received.
 * - `serials` — held for resale: serial numbers recorded on the line, no units.
 * - `consumable` — cable, fan, license: no serials, never touches the fleet.
 * - `unlinked` — marked serialized but with no product type to hang units off.
 */
export type ReceiveMode = "units" | "serials" | "consumable" | "unlinked";
