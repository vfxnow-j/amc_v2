"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { recordPayment } from "@/lib/actions/invoices";
import { receivePurchaseOrder } from "@/lib/actions/purchase-orders";

/**
 * The Revenue cluster's writes, as the record screens need them.
 *
 * A thin v2 layer over the ported actions, for the same reason `actions/desk`
 * exists: the ported ones throw on refusal, and a thrown error from a server
 * action lands on the nearest error boundary — which replaces the screen the
 * person was working on with a stack trace. These hand back a result the panel
 * can render in place, and add the revalidations the ported actions predate.
 *
 * Only async functions may be exported from a "use server" file. Constants and
 * types live in ./labels.
 */

export type PaymentOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string }
  /** Refused, and the caller is told the figure that would be accepted. */
  | { status: "over"; balance: number; message: string };

/**
 * Record money received against an invoice.
 *
 * A payment larger than the outstanding balance is refused rather than written.
 * v1 accepted it silently and marked the invoice PAID, which loses the
 * overpayment: nothing in the schema can hold a credit, so the difference would
 * exist only as a discrepancy between this invoice and the bank statement. The
 * refusal names the balance so the panel can offer it as a one-click way out.
 */
export async function recordInvoicePayment(
  invoiceId: string,
  input: {
    amount: number;
    paymentDate?: string;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
  },
): Promise<PaymentOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: "error", message: "Enter an amount above zero." };
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, total: true, amountPaid: true },
  });
  if (!invoice) return { status: "error", message: "Invoice not found." };

  if (invoice.status === "DRAFT") {
    return {
      status: "error",
      message:
        "This invoice is still a draft — nobody has been asked for the money yet.",
    };
  }
  if (invoice.status === "VOID" || invoice.status === "CANCELLED") {
    return {
      status: "error",
      message: `A ${invoice.status.toLowerCase()} invoice cannot take a payment.`,
    };
  }

  const balance = Number(invoice.total) - Number(invoice.amountPaid);
  // Half a cent of rounding slack: Decimal(12,2) can't hold less.
  if (input.amount > balance + 0.005) {
    return {
      status: "over",
      balance,
      message: "That is more than this invoice still has outstanding.",
    };
  }

  try {
    await recordPayment(invoiceId, {
      amount: input.amount,
      paymentDate: input.paymentDate ? new Date(input.paymentDate) : undefined,
      paymentMethod: input.paymentMethod?.trim() || undefined,
      reference: input.reference?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The payment was not recorded.",
    };
  }

  // recordPayment predates the Payments list, so it doesn't know to refresh it.
  revalidatePath("/dashboard/payments");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);

  const settled = input.amount >= balance - 0.005;
  return {
    status: "ok",
    message: settled
      ? "Payment recorded — this invoice is settled."
      : "Payment recorded.",
  };
}

export type ReceiveOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/**
 * Receive lines against a purchase order.
 *
 * Serials are passed through as typed. `AssetUnit.serialNumber` is unique, so a
 * serial already in the fleet fails the whole transaction — which is right: two
 * units claiming one serial is worse than a receipt that has to be redone, and
 * the message says which serial it was.
 *
 * A location is required because a received unit is a physical object that is
 * now somewhere. The panel defaults it to the PO's ship-to.
 */
export async function receivePOLines(
  purchaseOrderId: string,
  locationId: string,
  lines: { poItemId: string; quantity: number; serials: string[] }[],
): Promise<ReceiveOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const wanted = lines.filter((line) => line.quantity > 0);
  if (wanted.length === 0) {
    return {
      status: "error",
      message: "Nothing to receive — set a quantity on at least one line.",
    };
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true },
  });
  if (!location) {
    return { status: "error", message: "Choose where the hardware landed." };
  }

  const items = await prisma.pOItem.findMany({
    where: { purchaseOrderId, id: { in: wanted.map((line) => line.poItemId) } },
    select: {
      id: true,
      description: true,
      quantity: true,
      receivedQuantity: true,
      isInventoried: true,
      isResale: true,
      assetId: true,
    },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  const payload = [];
  for (const line of wanted) {
    const item = byId.get(line.poItemId);
    if (!item) {
      return { status: "error", message: "A line on this PO has since changed — reload and try again." };
    }
    const remaining = item.quantity - item.receivedQuantity;
    if (line.quantity > remaining) {
      return {
        status: "error",
        message: `"${item.description}" has only ${remaining} left to receive.`,
      };
    }

    const serials = line.serials.map((serial) => serial.trim()).filter(Boolean);

    payload.push({
      poItemId: item.id,
      receivedQuantity: line.quantity,
      // Serialised stock: one AssetUnit per item received. Barcodes are left to
      // the ported action to generate — v1 owns that sequence, and a second
      // generator in v2 would be a second way to collide.
      units:
        item.isInventoried && item.assetId
          ? Array.from({ length: line.quantity }, (_, index) => ({
              locationId,
              serialNumber: serials[index] ?? undefined,
            }))
          : undefined,
      serials: item.isResale ? serials : undefined,
    });
  }

  try {
    await receivePurchaseOrder(purchaseOrderId, { items: payload });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Nothing was received.",
    };
  }

  revalidatePath(`/dashboard/purchase-orders/${purchaseOrderId}`);
  revalidatePath("/dashboard/units");

  const units = payload.reduce((sum, line) => sum + (line.units?.length ?? 0), 0);
  return {
    status: "ok",
    message: units > 0 ? `Received — ${units} units are now in stock.` : "Received.",
  };
}
