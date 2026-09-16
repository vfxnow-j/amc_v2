/**
 * The purchase order's vocabulary, for the forms and the record.
 *
 * Prisma-free so the client components — the PO form, the receive flow, the
 * financing card — can import it without dragging the pg driver into the
 * browser bundle. Statuses stay in `lib/accounting/labels`, where the list and
 * the vendor record already read them; this file holds what only the PO screens
 * need.
 */

/** What a PO is for. The record words them as the reason the money is spent. */
export const PO_ORDER_TYPE_LABEL: Record<string, string> = {
  HARDWARE_RENTAL: "Hardware to rent out",
  HARDWARE_RENTAL_COMPONENTS: "Components for rental hardware",
  HARDWARE_RESALE: "Hardware to resell",
  HARDWARE_RESALE_COMPONENTS: "Components for resale hardware",
};

export const PO_ORDER_TYPES = Object.keys(PO_ORDER_TYPE_LABEL);

/**
 * How it is paid for. A subset of `OwnershipType` — the members a PO form has
 * ever offered — in the order v1's form lists them. Received units take this as
 * their ownership, unless the PO is on a lease, which makes them LOAN.
 */
export const PO_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CREDIT: "Credit card",
  VENDOR_CREDIT: "Vendor credit",
  LOAN: "Lease or loan",
  EXCHANGE: "Transfer",
};

export const PO_METHODS = Object.keys(PO_METHOD_LABEL);

/**
 * A funding request's status, as the PO record shows it beside the link.
 *
 * Written here rather than imported because the funding screens are being
 * built alongside this one and their labels file does not exist yet. The words
 * follow v1's; if the two ever disagree, the funding request's own record is
 * the one to believe.
 */
export const FUNDING_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  DECLINED: "Declined",
  FUNDED: "Funded",
  FULFILLED: "Fulfilled",
  CANCELLED: "Canceled",
};

/** The conditions a received unit can be booked in as. `New` is the default. */
export const RECEIVE_CONDITIONS = ["New", "Excellent", "Good", "Fair"] as const;

/**
 * How a PO line lands when it is received, as the form sets it.
 *
 * `POItem` stores two booleans whose four combinations are not all meaningful;
 * the form offers the three that are and writes the pair.
 */
export const LINE_KIND = {
  units: { isInventoried: true, isResale: false },
  resale: { isInventoried: false, isResale: true },
  consumable: { isInventoried: false, isResale: false },
} as const;

export type LineKind = keyof typeof LINE_KIND;

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  units: "Fleet — a unit per item",
  resale: "Resale — serials only",
  consumable: "Consumable — count only",
};

export function lineKindOf(item: {
  isInventoried: boolean;
  isResale: boolean;
}): LineKind {
  return item.isInventoried ? "units" : item.isResale ? "resale" : "consumable";
}

/**
 * The same arithmetic as the ported `calculatePOTotals`, for the form's running
 * total. The server recomputes on save and its figure is the one stored; this
 * exists so the person sees the number before they commit it.
 */
export function poTotals(input: {
  lines: { quantity: number; unitPrice: number }[];
  fees: { amount: number }[];
  discountType: string | null;
  discountValue: number;
  freight: number;
  tax: number;
  taxExempt: boolean;
}) {
  const subtotal = input.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const fees = input.fees.reduce((sum, fee) => sum + fee.amount, 0);
  let discount = 0;
  if (input.discountType === "PERCENTAGE" && input.discountValue > 0) {
    discount = subtotal * (input.discountValue / 100);
  } else if (input.discountType === "FIXED" && input.discountValue > 0) {
    discount = Math.min(input.discountValue, subtotal);
  }
  const tax = input.taxExempt ? 0 : input.tax;
  return {
    subtotal,
    fees,
    discount,
    tax,
    total: subtotal - discount + input.freight + fees + tax,
  };
}
