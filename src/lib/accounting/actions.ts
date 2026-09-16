"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { recordPayment } from "@/lib/actions/invoices";
import { getRateCardGap } from "@/lib/queries/rate-card-record";
import { RATE_FIELD } from "@/lib/accounting/labels";

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

export type ApplyRatesOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/**
 * Write a rate card's figures onto the assets in the categories it prices.
 *
 * The bulk rate update the plan moves out of Assets, where changing prices
 * never belonged. It is offered only after the record has listed every asset it
 * would change and what it would change each one from — a price change nobody
 * previewed is one nobody can check, and `Asset` keeps no rate history to undo
 * from.
 *
 * It is safe in one specific and worth-stating way: `ReservationItem.rate` is
 * stored per line, so nothing here reaches an existing order. This changes what
 * the *next* line priced off these assets will cost, and nothing that has
 * already been agreed.
 *
 * Retired assets are left alone. They are not going out again, and rewriting
 * their rates would only make the retired catalog disagree with the orders
 * that used it.
 */
export async function applyRateCard(
  rateCardId: string,
  expectedChanges: number,
): Promise<ApplyRatesOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  // Recomputed rather than taken from the caller: the gap the person read may
  // be minutes old, and a bulk price change must write what is true now. If the
  // count has moved, nothing is written and they are told to look again.
  const { rows } = await getRateCardGap(rateCardId);
  if (rows.length === 0) {
    return { status: "error", message: "Nothing differs from this card now." };
  }
  if (rows.length !== expectedChanges) {
    return {
      status: "error",
      message: `${rows.length} assets differ now, not ${expectedChanges} — the catalog has changed since this list was drawn. Reload and check it again.`,
    };
  }

  // One update per row, unconditionally: `RateGapRow.pricingType` is narrowed to
  // the tiers `Asset` has a column for, so there is no row here that could be
  // skipped. It matters that the counts agree — the message below reports
  // `rows.length` as written, and a filter here could quietly make that untrue.
  await prisma.$transaction(
    rows.map((row) =>
      prisma.asset.update({
        where: { id: row.assetId },
        data: { [RATE_FIELD[row.pricingType]]: row.card },
      }),
    ),
  );

  revalidatePath(`/dashboard/rate-cards/${rateCardId}`);
  revalidatePath("/dashboard/rate-cards");
  revalidatePath("/dashboard/assets");

  const assets = new Set(rows.map((row) => row.assetId)).size;
  return {
    status: "ok",
    message: `${rows.length} rates rewritten across ${assets} ${assets === 1 ? "asset" : "assets"}. Orders already priced are untouched.`,
  };
}
