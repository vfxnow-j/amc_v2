"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import {
  addDays,
  businessToday,
  dayLabel,
  intendedDay,
  parseDateInput,
  stretchLabel,
} from "@/lib/billing/calendar";
import { extensionLines } from "@/lib/queries/extension";
import { quoteExtension, type ExtensionMode } from "@/lib/billing/extension";
import { formatPeriodCount } from "@/lib/pricing/periods";
import { updateReservation } from "@/lib/actions/reservations";
import { createInvoice } from "@/lib/actions/invoices";

export type ExtendOutcome =
  | { status: "ok"; message: string; href?: string }
  | { status: "error"; message: string };

/**
 * Extend an overdue fixed-term rental and invoice the extension.
 *
 * The return date moves first, through `updateReservation` so the order is
 * repriced across its new term like any other date change; then one invoice is
 * raised for the extension alone — from the day after the old return date to
 * the new one, prorated or in whole periods as chosen (lib/billing/extension.ts)
 * — and the extension is written to the order's activity.
 *
 * Only for a rental that bills one time and is out with the client — overdue
 * or not, since extending ahead of the date bills the same way. A monthly or
 * weekly rental is recurring and keeps billing on its own.
 */
export async function extendOrder(
  id: string,
  input: { newEnd: string; mode: ExtensionMode },
): Promise<ExtendOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const order = await prisma.reservation.findUnique({
    where: { id },
    select: {
      reservationNumber: true,
      reservationType: true,
      status: true,
      isRecurring: true,
      endDate: true,
      clientId: true,
      taxRate: true,
      paymentTerms: true,
      notBilled: true,
      projectName: true,
      client: { select: { paymentTerms: true } },
    },
  });
  if (!order) return { status: "error", message: "Order not found." };
  if (order.reservationType !== "RENTAL" || order.isRecurring) {
    return {
      status: "error",
      message: "Only a one-time rental is extended. A monthly or weekly rental keeps billing each cycle.",
    };
  }
  if (!["ACTIVE", "SHIPPED"].includes(order.status)) {
    return { status: "error", message: "Only an order that is out with the client can be extended." };
  }
  // Overdue or not: extending before the date passes bills the same way.
  const oldEnd = intendedDay(order.endDate);

  const requested = parseDateInput(input.newEnd);
  if (!requested) return { status: "error", message: "Choose the new return date." };

  const lines = await extensionLines(id);

  const quote = quoteExtension(oldEnd, requested, input.mode, lines);
  if (!quote) return { status: "error", message: "The new return date has to be after the old one." };
  if (quote.lines.length === 0) {
    return { status: "error", message: "Nothing on this order bills by the day, week or month, so there is nothing to extend." };
  }

  try {
    await updateReservation(id, { endDate: quote.to });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The return date couldn't be moved." };
  }

  const stretch = stretchLabel(quote.from, quote.to);
  const how = input.mode === "prorate" ? "prorated" : "whole periods";
  let invoiceNote = "";
  let href: string | undefined;

  if (order.notBilled) {
    invoiceNote = " The order is marked not billed, so no invoice was raised.";
  } else if (quote.total > 0) {
    const days = order.paymentTerms ?? order.client.paymentTerms ?? 30;
    const invoice = (await createInvoice({
      clientId: order.clientId,
      reservationId: id,
      dueDate: addDays(businessToday(), days),
      taxRate: Number(order.taxRate) || 0,
      periodStartDate: quote.from,
      periodEndDate: quote.to,
      notes: `Extension of ${order.reservationNumber}, ${stretch} (${how})${
        order.projectName ? ` — Project: ${order.projectName}` : ""
      }`,
      items: quote.lines.map((line) => ({
        description: `${line.label} — extension ${stretch}, ${formatPeriodCount(line.periods)} ${line.unit}${
          Math.abs(line.periods - 1) < 0.005 ? "" : "s"
        }`,
        quantity: line.quantity,
        unitPrice: line.rate,
        amount: line.amount,
      })),
    })) as { id?: string; invoiceNumber?: string };
    href = invoice.id ? `/dashboard/invoices/${invoice.id}` : undefined;
    invoiceNote = ` ${invoice.invoiceNumber ?? "An invoice"} raised for the extension, a draft until sent.`;
  }

  await prisma.statusHistory.create({
    data: {
      entityType: "RESERVATION",
      entityId: id,
      fromStatus: order.status,
      toStatus: "EXTENDED",
      changedById: auth.userId,
      notes: `Extended ${stretch} (${quote.days} days, ${how}) — return date now ${dayLabel(quote.to)}.`,
    },
  });

  revalidatePath(`/dashboard/orders/${id}`);
  revalidatePath("/dashboard/orders");
  return {
    status: "ok",
    message: `Extended to ${dayLabel(quote.to)} (${quote.days} days, ${how}).${invoiceNote}`,
    href,
  };
}
