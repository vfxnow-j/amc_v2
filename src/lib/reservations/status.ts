import type { ReservationStatus, ReservationType } from "@/generated/prisma/client";

/**
 * How order state is spoken in v2. Sentence case, and the label says what the
 * order *is*, not which enum member it holds — "Out with client" reads better on
 * a warehouse screen than "ACTIVE".
 *
 * Shared by the hub, the record and the queue so one order never has two names.
 */
export const STATUS_LABEL: Record<ReservationStatus, string> = {
  DRAFT: "Draft",
  QUOTE_SENT: "Quote sent",
  REVISION: "In revision",
  APPROVED: "Approved",
  PREPARING: "Preparing",
  SHIPPED: "Shipped",
  ACTIVE: "Out with client",
  COMPLETED: "Completed",
  CANCELLED: "Canceled",
  LOST: "Lost",
};

export const TYPE_LABEL: Record<ReservationType, string> = {
  RENTAL: "Rental",
  SALE: "Sale",
  RENT_TO_OWN: "Rent to own",
  CLOUD: "Cloud",
};

/** Quote-stage: not yet a commitment. */
export const QUOTE_STATUSES: ReservationStatus[] = [
  "DRAFT",
  "QUOTE_SENT",
  "REVISION",
];

/** Committed and still running. */
export const OPEN_STATUSES: ReservationStatus[] = [
  "APPROVED",
  "PREPARING",
  "SHIPPED",
  "ACTIVE",
];

/** Finished, one way or another. */
export const ARCHIVE_STATUSES: ReservationStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "LOST",
];
