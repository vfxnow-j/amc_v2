"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { createOrder } from "@/lib/actions/order-builder";
import { createQuoteLink, sendOrderQuote } from "@/lib/actions/order-stage";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { QuickQuoteInput, QuickQuoteOutcome } from "@/lib/quotes/contract";

/**
 * What the Quick Quote dialog commits through.
 *
 * It creates nothing itself. `createOrder` already holds the shape of a new
 * order — the availability flag, the draft status that holds no stock, the
 * revalidate — and `sendOrderQuote` already holds what "sent" means, including
 * the awkward truth that this instance has outbound mail switched off. Adding a
 * second writer for either would be how the two paths start to disagree.
 *
 * The one thing that is genuinely this file's job is the **taxed total**. The
 * dialog shows a subtotal and says so, because tax comes off the location of
 * the first unit and `createReservation` looks that up while it writes: no
 * client-side arithmetic can know it. So the order is read back once, after it
 * exists, and the real total is what the person is told. That read is the whole
 * reason this is a wrapper rather than a direct call to `createOrder`.
 *
 * Every send also *returns* the link. `sendEmail` never throws — it returns
 * `{ success: false }` — so with mail off the quote is marked sent and nobody
 * receives anything, and a message that didn't carry the URL would leave the
 * person with no way to finish the job by hand.
 */
export async function createQuickQuote(
  input: QuickQuoteInput,
): Promise<QuickQuoteOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  // RENTAL is the only type Quick Quote offers, and it is passed explicitly so
  // that stays a decision rather than a default somebody inherits. The other
  // three each need a field this dialog does not ask for (a term, a delivery
  // date, a billing cycle) and belong in the full builder.
  const created = await createOrder({
    clientId: input.clientId,
    type: "RENTAL",
    start: input.start,
    end: input.end,
    projectName: input.projectName,
    lines: input.lines,
  });
  if (created.status === "error") {
    return { status: "error", message: created.message };
  }

  const href = `/dashboard/orders/${created.reservationId}`;

  const order = await prisma.reservation.findUnique({
    where: { id: created.reservationId },
    select: {
      reservationNumber: true,
      taxRate: true,
      taxAmount: true,
      total: true,
      client: { select: { email: true } },
    },
  });

  // The order was written; only the read-back failed. Say what is true rather
  // than reporting a failure that would send somebody looking for a lost order.
  if (!order) {
    return {
      status: "ok",
      message: "The quote was created, but its totals could not be read back. Open it to check the figures.",
      href,
    };
  }

  const taxRate = Number(order.taxRate) || 0;
  const money = [
    `${order.reservationNumber} totals ${formatCurrency(Number(order.total))}`,
    taxRate > 0
      ? `including ${formatCurrency(Number(order.taxAmount))} tax at ${formatPercent(taxRate)}.`
      : "with no tax — the location of the first unit on it carries no rate.",
  ].join(" ");

  revalidatePath("/dashboard");

  if (!input.send) {
    return {
      status: "ok",
      message: `${money} Saved as a draft, which holds no stock.`,
      href,
    };
  }

  const email = order.client.email?.trim();
  if (!email) {
    return {
      status: "ok",
      message: `${money} It is still a draft: the client record has no email address, so there was nowhere to send it. Add one, or open the order and copy the quote link.`,
      href,
    };
  }

  const sent = await sendOrderQuote(created.reservationId, {
    emails: [email],
    message: input.message,
  });
  if (sent.status === "error") {
    return {
      status: "ok",
      message: `${money} It was created, but sending failed: ${sent.message} Open the order and send it from there.`,
      href,
    };
  }

  // Minted after the send, not before: a failed send should not leave a live
  // link behind. `sendOrderQuote` issues its own token per recipient, so this
  // is a second, distinguishable one — which is the documented behaviour, and
  // the only copy of the link the person here can actually reach.
  const link = await createQuoteLink(created.reservationId);

  return {
    status: "ok",
    message: `${money} ${sent.message}${
      link.status === "ok" ? ` Link to copy: ${link.url}` : ""
    }`,
    href,
  };
}
