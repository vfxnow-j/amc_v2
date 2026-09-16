import type {
  CustomerCommitment,
  FundingPurchaseType,
  FundingRequestStatus,
} from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";

/**
 * How a funding request is spoken in v2.
 *
 * The one label map for request states: the Procurement Overview imports it
 * from here too (it had declared its own before these screens existed).
 * Prisma-free apart from types, so the form and the lifecycle controls — client
 * components — can import it without dragging the pg driver into the browser.
 * The PDF and the accounting email reuse these rather than v1's Title Case
 * copies, so a request never has two names for the same state.
 */

export const FUNDING_STATUS_LABEL: Record<FundingRequestStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  DECLINED: "Declined",
  FUNDED: "Funded",
  FULFILLED: "Fulfilled",
  CANCELLED: "Canceled",
};

export const FUNDING_PURCHASE_TYPE_LABEL: Record<FundingPurchaseType, string> = {
  HARDWARE_RENTAL: "Hardware to rent out",
  HARDWARE_RESALE: "Hardware to resell",
  HARDWARE_CLOUD: "Hardware for cloud",
};

export const CUSTOMER_COMMITMENT_LABEL: Record<CustomerCommitment, string> = {
  PO_CONTRACT: "PO or contract in hand",
  VERBAL: "Verbal only",
  GENERAL_INVENTORY: "General inventory — no named customer",
};

/**
 * The states a request can still be edited in. v1's action refuses nothing;
 * its screen hid the edit button on these two, and that is the rule ported —
 * once the hardware is in or the request is withdrawn, the paper is the record.
 */
export const FUNDING_LOCKED: FundingRequestStatus[] = ["FULFILLED", "CANCELLED"];

/**
 * Where a PO can be raised from. The money has been agreed, so the order to
 * the vendor is the next step; before approval it would be spending ahead of
 * the decision.
 */
export const FUNDING_CAN_RAISE_PO: FundingRequestStatus[] = ["APPROVED", "FUNDED"];

/**
 * The list's filter, in the `status` search param.
 *
 * Every lifecycle state is its own tab, named by its enum value, so the
 * Procurement Overview can link a pipeline row straight to
 * `/dashboard/funding?status=SUBMITTED` without a translation table between the
 * two screens. `open` (the default) and `all` are the two groupings on top:
 * open is v1's own "open requests" figure, draft through funded.
 */
export const FUNDING_VIEWS = [
  "open",
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "FUNDED",
  "FULFILLED",
  "DECLINED",
  "CANCELLED",
  "all",
] as const;
export type FundingView = (typeof FUNDING_VIEWS)[number];
export const isFundingView = oneOf(FUNDING_VIEWS);

export const FUNDING_VIEW_LABEL: Record<FundingView, string> = {
  ...FUNDING_STATUS_LABEL,
  open: "Open",
  all: "All",
};

export const FUNDING_VIEW_STATUSES: Record<FundingView, FundingRequestStatus[] | null> = {
  open: ["DRAFT", "SUBMITTED", "APPROVED", "FUNDED"],
  DRAFT: ["DRAFT"],
  SUBMITTED: ["SUBMITTED"],
  APPROVED: ["APPROVED"],
  FUNDED: ["FUNDED"],
  FULFILLED: ["FULFILLED"],
  DECLINED: ["DECLINED"],
  CANCELLED: ["CANCELLED"],
  all: null,
};
