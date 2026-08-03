import type { InvoiceStatus, LeaseStatus, POStatus } from "@/generated/prisma/client";

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
  CANCELLED: "Cancelled",
  VOID: "Void",
};

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

export function isInvoiceView(value: unknown): value is InvoiceView {
  return INVOICE_VIEWS.includes(value as InvoiceView);
}

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

export function isContractView(value: unknown): value is ContractView {
  return CONTRACT_VIEWS.includes(value as ContractView);
}

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
  CANCELLED: "Cancelled",
};

export const PO_VIEWS = ["open", "received", "draft", "all"] as const;
export type POView = (typeof PO_VIEWS)[number];

export const PO_VIEW_LABEL: Record<POView, string> = {
  open: "On order",
  received: "Received",
  draft: "Draft",
  all: "All",
};

export function isPOView(value: unknown): value is POView {
  return PO_VIEWS.includes(value as POView);
}
