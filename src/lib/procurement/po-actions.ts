"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import {
  assignPurchaseOrderToFundingRequest,
  assignPurchaseOrderToLease,
  cancelPurchaseOrder,
  createPurchaseOrder,
  revisePurchaseOrder,
  submitPurchaseOrder,
  unassignPurchaseOrderFromFundingRequest,
  updatePurchaseOrder,
  type POFormData,
} from "@/lib/actions/purchase-orders";
import { LINE_KIND, PO_METHODS, type LineKind } from "@/lib/procurement/po-labels";

/**
 * Raising, editing and moving a purchase order.
 *
 * v2 could receive against a PO and could not raise one: `createPurchaseOrder`
 * and `updatePurchaseOrder` were ported months ago and reachable from nothing.
 * This is the thin outcome layer over them, the `lib/actions/accounts.ts`
 * pattern — the ported actions throw (or return `{ success: false }`, which is
 * a second way to fail), and a form needs one shape it can render in place.
 *
 * Procurement is admin-only (docs/procurement.md). Every export checks the role
 * itself, even though the ported action it calls checks again: a server action
 * is reachable by a direct POST whatever the rail shows, and the check that
 * matters is the one nearest the write.
 *
 * Only async functions may be exported from a "use server" file. Constants and
 * types that the client needs live in ./po-labels.
 */

export type POOutcome =
  | { status: "ok"; message: string; id?: string }
  | { status: "error"; message: string };

export type POLineInput = {
  /** Present when editing an existing line — keeps its received count. */
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  assetId?: string | null;
  kind: LineKind;
};

export type POInput = {
  vendorId: string;
  shipToLocationId?: string | null;
  /** yyyy-mm-dd, as a date input gives it. */
  orderDate: string;
  expectedDate?: string | null;
  orderType?: string | null;
  purchaseMethod?: string | null;
  creditTerms?: string | null;
  discountType?: "PERCENTAGE" | "FIXED" | null;
  discountValue?: number;
  freightAmount?: number;
  taxAmount?: number;
  taxExempt?: boolean;
  notes?: string;
  lines: POLineInput[];
  fees: { description: string; amount: number }[];
  /** Create only: attach the new PO to this funding request. */
  fundingRequestId?: string | null;
};

function reasonFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A date input's yyyy-mm-dd, as noon UTC.
 *
 * Midnight UTC is the previous evening in Los Angeles, so a PO dated the 16th
 * would print as the 15th everywhere the app formats in local time.
 */
function dateFrom(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const money = (value: number | undefined) =>
  value != null && Number.isFinite(value) && value >= 0;

/**
 * Checks shared by create and edit, and the ported action's payload.
 *
 * Required is what the PO cannot exist without: a vendor and an order date.
 * Lines are not required to save — a draft is where a PO gets assembled — but a
 * line that is present must say what it is and how many. Tax is not required
 * either: v1's form insists on a figure or an exempt tick, and 19 of the 32
 * submitted and received POs here carry zero tax without the tick, so the rule
 * would refuse edits to most of the history. The form says when none is set.
 */
async function validate(
  input: POInput,
): Promise<{ error: string } | { data: POFormData }> {
  if (!input.vendorId) return { error: "Choose the vendor this order goes to." };
  const vendor = await prisma.vendor.findUnique({
    where: { id: input.vendorId },
    select: { id: true },
  });
  if (!vendor) return { error: "That vendor no longer exists — choose another." };

  const orderDate = dateFrom(input.orderDate);
  if (!orderDate) return { error: "Give the order a date." };
  const expectedDate = input.expectedDate ? dateFrom(input.expectedDate) : null;
  if (input.expectedDate && !expectedDate) {
    return { error: "The expected date is not a date." };
  }
  if (expectedDate && expectedDate < orderDate) {
    return { error: "It cannot be expected before it was ordered." };
  }

  const lines = input.lines.filter(
    (line) => line.id || line.description.trim() || line.assetId,
  );
  for (const [index, line] of lines.entries()) {
    const name = line.description.trim() || `Line ${index + 1}`;
    if (!line.description.trim()) {
      return { error: `Line ${index + 1} needs a description.` };
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return { error: `"${name}" needs a whole quantity of at least one.` };
    }
    if (!money(line.unitPrice)) {
      return { error: `"${name}" needs a unit price of zero or more.` };
    }
    if (!(line.kind in LINE_KIND)) {
      return { error: `"${name}" has no receiving mode.` };
    }
  }

  const fees = input.fees.filter((fee) => fee.description.trim() || fee.amount);
  for (const fee of fees) {
    if (!fee.description.trim()) return { error: "Every fee needs a description." };
    if (!money(fee.amount)) {
      return { error: `The fee "${fee.description}" needs an amount of zero or more.` };
    }
  }

  if (input.discountType && !money(input.discountValue)) {
    return { error: "The discount needs a figure of zero or more." };
  }
  if (input.discountType === "PERCENTAGE" && (input.discountValue ?? 0) > 100) {
    return { error: "A percentage discount cannot be more than 100." };
  }
  if (input.freightAmount != null && !money(input.freightAmount)) {
    return { error: "Freight cannot be negative." };
  }
  if (input.taxAmount != null && !money(input.taxAmount)) {
    return { error: "Tax cannot be negative." };
  }

  return {
    data: {
      vendorId: input.vendorId,
      shipToLocationId: input.shipToLocationId || null,
      orderDate,
      expectedDate,
      orderType: input.orderType || null,
      purchaseMethod: input.purchaseMethod || null,
      creditTerms: input.creditTerms?.trim() || null,
      discountType: input.discountType || null,
      discountValue: input.discountType ? input.discountValue ?? 0 : 0,
      freightAmount: input.freightAmount ?? 0,
      taxAmount: input.taxExempt ? 0 : input.taxAmount ?? 0,
      taxExempt: input.taxExempt ?? false,
      notes: input.notes?.trim() || undefined,
      items: lines.map((line) => ({
        id: line.id,
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        assetId: line.assetId || null,
        ...LINE_KIND[line.kind],
      })),
      fees: fees.map((fee) => ({
        description: fee.description.trim(),
        amount: fee.amount,
      })),
    },
  };
}

/** Raise a purchase order as a draft. */
export async function raisePurchaseOrder(input: POInput): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const checked = await validate(input);
  if ("error" in checked) return { status: "error", message: checked.error };

  let fundingRequestId: string | null = null;
  if (input.fundingRequestId) {
    const request = await prisma.fundingRequest.findUnique({
      where: { id: input.fundingRequestId },
      select: { id: true, status: true, requestNumber: true },
    });
    if (!request) {
      return { status: "error", message: "The funding request this was raised from no longer exists." };
    }
    if (request.status === "DECLINED" || request.status === "CANCELLED") {
      return {
        status: "error",
        message: `${request.requestNumber} is ${request.status.toLowerCase()} — a PO cannot be raised against it.`,
      };
    }
    fundingRequestId = request.id;
  }

  // A PO raised against a loan-funded request is a loan purchase; the loan
  // itself is attached from the record, where the units-follow-the-money
  // warning can be read. Nothing is inferred here.
  try {
    const result = await createPurchaseOrder({ ...checked.data, fundingRequestId });
    if (!result.success) return { status: "error", message: result.error };
    const po = result.data as { id: string; poNumber: string };
    if (fundingRequestId) revalidatePath(`/dashboard/funding/${fundingRequestId}`);
    return { status: "ok", id: po.id, message: `${po.poNumber} raised as a draft.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The purchase order was not raised.") };
  }
}

/**
 * Save an edit.
 *
 * A canceled PO is closed and is refused here, as v1's record refuses to offer
 * the edit. Everything else can be edited at any status — the ported action
 * refuses to remove a received line or drop a quantity below what arrived, and
 * re-derives PARTIAL/RECEIVED from the lines.
 *
 * A PO on a lease keeps LOAN as its purchase method whatever the form sends:
 * the lease is what makes it a loan purchase, and receiving already reads the
 * lease first. Letting the two disagree would leave the record saying "cash"
 * about hardware the loan paid for.
 */
export async function savePurchaseOrder(id: string, input: POInput): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true, leaseId: true, poNumber: true },
  });
  if (!existing) return { status: "error", message: "That purchase order no longer exists." };
  if (existing.status === "CANCELLED") {
    return { status: "error", message: `${existing.poNumber} is canceled and can no longer be edited.` };
  }

  const checked = await validate(input);
  if ("error" in checked) return { status: "error", message: checked.error };
  if (existing.leaseId) checked.data.purchaseMethod = "LOAN";

  try {
    const result = await updatePurchaseOrder(id, checked.data);
    if (!result.success) return { status: "error", message: result.error };
    return { status: "ok", id, message: `${existing.poNumber} saved.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The changes were not saved.") };
  }
}

/**
 * Send a draft to the vendor.
 *
 * A PO with nothing on it is refused. The record already tells the person to
 * add a line before submitting; the ported action would have submitted it
 * anyway, and a submitted PO with no lines can never be received and never
 * closes.
 *
 * The ported action notifies the `purchaseOrders` recipients by email with the
 * PDF attached. Outbound email is off in v2 (no Resend key), and the call sits
 * inside the action's own try/catch, so it logs and the submission stands.
 */
export async function submitPO(id: string): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const lines = await prisma.pOItem.count({ where: { purchaseOrderId: id } });
  if (lines === 0) {
    return { status: "error", message: "There is nothing on this PO. Add a line before sending it to the vendor." };
  }

  try {
    const po = (await submitPurchaseOrder(id)) as { poNumber: string };
    return { status: "ok", message: `${po.poNumber} submitted — hardware can be received against it now.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The PO was not submitted.") };
  }
}

/** Take a submitted PO back to draft, to change it before the vendor acts on it. */
export async function revisePO(id: string): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  try {
    const po = (await revisePurchaseOrder(id)) as { poNumber: string };
    return { status: "ok", message: `${po.poNumber} is a draft again. Submit it once it is right.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The PO was not revised.") };
  }
}

/**
 * Cancel. There is no delete control — the data is real — so this is the way a
 * PO that will never be fulfilled leaves the open list. A part-received PO can
 * be canceled: what arrived stays in the fleet, and the rest is recorded as
 * never coming.
 */
export async function cancelPO(id: string): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  try {
    const po = (await cancelPurchaseOrder(id)) as { poNumber: string };
    return { status: "ok", message: `${po.poNumber} canceled.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The PO was not canceled.") };
  }
}

/**
 * Put the PO on a lease, or take it off one.
 *
 * Units already received against the PO move with it — that is the ported
 * sync, and the dialog says how many before anyone confirms. v2's sync does not
 * write `loanAmount` onto the units; see `lib/funding/lease-sync.ts`.
 *
 * Taking it off a lease asks what it was paid with instead, because assigning
 * the lease overwrote the method with LOAN and nothing kept the original.
 */
export async function setPOLease(
  id: string,
  leaseId: string | null,
  /** Required when clearing: what the PO was paid with instead. */
  methodWhenCleared?: string | null,
): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  if (!leaseId && (!methodWhenCleared || !PO_METHODS.includes(methodWhenCleared))) {
    return {
      status: "error",
      message: "Say how it was paid for instead — its units take that as their ownership.",
    };
  }
  if (!leaseId && methodWhenCleared === "LOAN") {
    return {
      status: "error",
      message: "Off the lease it cannot be a loan purchase. Pick how it was actually paid.",
    };
  }
  try {
    await assignPurchaseOrderToLease(id, leaseId, leaseId ? undefined : methodWhenCleared);
    const units = await prisma.assetUnit.count({ where: { purchaseOrderId: id } });
    const moved = units === 0 ? "" : ` ${units} received ${units === 1 ? "unit follows" : "units follow"} it.`;
    return {
      status: "ok",
      message: (leaseId ? "Put on the lease." : "Taken off the lease.") + moved,
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The lease was not changed.") };
  }
}

/** Cite this PO as evidence on a funding request. */
export async function attachPOToFunding(id: string, requestId: string): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const request = await prisma.fundingRequest.findUnique({
    where: { id: requestId },
    select: { status: true, requestNumber: true },
  });
  if (!request) return { status: "error", message: "That funding request no longer exists." };
  if (request.status === "DECLINED" || request.status === "CANCELLED") {
    return {
      status: "error",
      message: `${request.requestNumber} is ${request.status.toLowerCase()}, so there is nothing to attach evidence to.`,
    };
  }

  try {
    await assignPurchaseOrderToFundingRequest(id, requestId);
    return { status: "ok", message: `Attached to ${request.requestNumber}.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The PO was not attached.") };
  }
}

export async function detachPOFromFunding(id: string, requestId: string): Promise<POOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  try {
    await unassignPurchaseOrderFromFundingRequest(id, requestId);
    return { status: "ok", message: "Detached from the funding request." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error, "The PO was not detached.") };
  }
}
