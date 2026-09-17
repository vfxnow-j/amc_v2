import type {
  ApprovalRecordType,
  ApprovalStatus,
} from "@/generated/prisma/client";
import type { Role } from "@/lib/roles";

/**
 * How approvals are spoken in v2 (docs/procurement.md, Phase 6).
 *
 * A plain module: `"use server"` files may export only async functions, and the
 * settings form and the decision controls — client components — read these, so
 * nothing here may reach `lib/prisma` (the type imports are erased).
 */

export const APPROVAL_TYPES: ApprovalRecordType[] = [
  "PURCHASE_ORDER",
  "FUNDING_REQUEST",
  "QUOTE",
];

export const APPROVAL_TYPE_LABEL: Record<ApprovalRecordType, string> = {
  PURCHASE_ORDER: "Purchase orders",
  FUNDING_REQUEST: "Funding requests",
  QUOTE: "Client quotes",
};

/** The singular, for sentences: "a purchase order", "this quote". */
export const APPROVAL_TYPE_NOUN: Record<ApprovalRecordType, string> = {
  PURCHASE_ORDER: "purchase order",
  FUNDING_REQUEST: "funding request",
  QUOTE: "quote",
};

/** What approving one lets happen next — said on the settings form and in email. */
export const APPROVAL_TYPE_RELEASES: Record<ApprovalRecordType, string> = {
  PURCHASE_ORDER: "Sending it to the vendor, and receiving against it",
  FUNDING_REQUEST: "Approving the spend, so it can be funded",
  QUOTE: "Sending it to the client, and committing the order",
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  DENIED: "Denied",
  SUPERSEDED: "Superseded",
};

/**
 * Who can hold an approver scope. SUPER_ADMIN is always an approver and needs
 * no row; VIEWER reads only and FLOW_USER works in a separate area, so neither
 * can be made one — a stray row for either is ignored by every check.
 */
export const SCOPABLE_ROLES: Role[] = ["ADMIN", "STAFF"];

export function canHoldScopes(role: Role): boolean {
  return SCOPABLE_ROLES.includes(role);
}
