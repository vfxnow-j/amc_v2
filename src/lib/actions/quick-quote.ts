"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { createOrder } from "@/lib/actions/order-builder";
import { createQuoteLink, sendOrderQuote } from "@/lib/actions/order-stage";
import { linkLeadToProspectOrder, requestOnboarding } from "@/lib/actions/leads";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  ProspectQuoteInput,
  ProspectQuoteOutcome,
  QuickQuoteInput,
  QuickQuoteOutcome,
} from "@/lib/quotes/contract";

/** Loose on purpose, as everywhere else here — see `createLeadFromForm`. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The order's own figures, once it exists.
 *
 * Read back rather than computed, because tax comes off the location of the
 * first unit and `createReservation` looks that up while it writes. Both quote
 * paths tell somebody a number, and a second place doing this sum is exactly
 * how RES-2026-00089 came to show one total on screen and another on the PDF.
 */
async function readBackTotals(reservationId: string) {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      reservationNumber: true,
      taxRate: true,
      taxAmount: true,
      total: true,
      client: { select: { email: true } },
    },
  });
  if (!order) return null;

  const taxRate = Number(order.taxRate) || 0;
  return {
    number: order.reservationNumber,
    email: order.client.email?.trim(),
    money: [
      `${order.reservationNumber} totals ${formatCurrency(Number(order.total))}`,
      taxRate > 0
        ? `including ${formatCurrency(Number(order.taxAmount))} tax at ${formatPercent(taxRate)}.`
        : "with no tax — the location of the first unit on it carries no rate.",
    ].join(" "),
  };
}

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
  const totals = await readBackTotals(created.reservationId);

  // The order was written; only the read-back failed. Say what is true rather
  // than reporting a failure that would send somebody looking for a lost order.
  if (!totals) {
    return {
      status: "ok",
      message: "The quote was created, but its totals could not be read back. Open it to check the figures.",
      href,
    };
  }

  const money = totals.money;

  revalidatePath("/dashboard");

  if (!input.send) {
    return {
      status: "ok",
      message: `${money} Saved as a draft, which holds no stock.`,
      href,
    };
  }

  const email = totals.email;
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

/**
 * A price for somebody who is not an account yet.
 *
 * Three records come out of this, and the order matters:
 *
 *  1. **A lead**, through `requestOnboarding` — which dedupes first, so
 *     quoting somebody who rang last week lands on their record rather than
 *     opening a second one, and which sends (or, here, hands back) the
 *     onboarding form.
 *  2. **A thin client marked `prospectAt`**, which is what the order actually
 *     hangs off. `Reservation.clientId` is a required FK included
 *     non-optionally by `getQuoteByToken`, every PDF builder and the invoice
 *     path; a shell row costs one flag, where a nullable FK would cost
 *     hundreds of `?.` and silent blanks in documents that go to clients.
 *  3. **A draft order**, which holds no stock and is *not sent*.
 *
 * The quote is deliberately not sent, and that is the whole point of the
 * feature rather than a limitation of it. A quote link is the full rate card,
 * and the address it would go to has been verified by nobody — anyone can type
 * anyone's address into a dialog. Onboarding is what earns the quote.
 *
 * **Two guards on entry, both before anything is written.** An address that
 * already belongs to a real account never takes this path: it would open a
 * second record for people the app already bills, so it refuses and hands back
 * who they are. And a missing onboarding form URL refuses too — a quote held
 * for onboarding that nobody can be asked to complete is a dead end, and
 * refusing before the first write is what stops it leaving a lead and an
 * orphan shell client behind on this instance's real data.
 *
 * A shell that already exists for the address is reused rather than doubled;
 * quoting the same prospect twice is a normal Tuesday.
 */
export async function createProspectQuote(
  input: ProspectQuoteInput,
): Promise<ProspectQuoteOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) {
    return {
      status: "error",
      message: `"${input.email.trim()}" does not look like an email address.`,
    };
  }
  // Checked here as well as in `createOrder`, because by the time that refuses
  // a lead has already been opened for somebody nobody quoted.
  if (input.lines.length === 0) {
    return {
      status: "error",
      message: "Add at least one line — an order with nothing on it can't be priced.",
    };
  }
  if (!(input.start < input.end)) {
    return { status: "error", message: "The quote has to end after it starts." };
  }

  const onFile = await prisma.client.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, companyName: true, prospectAt: true },
  });

  if (onFile && !onFile.prospectAt) {
    return {
      status: "client-exists",
      message: `${onFile.name} is already an account on that address. Quote them as a client — the prospect path would open a second record for people we already bill.`,
      client: {
        id: onFile.id,
        name: onFile.name,
        companyName: onFile.companyName,
      },
    };
  }

  const name = input.name?.trim() || undefined;
  const companyName = input.companyName?.trim() || undefined;
  const phone = input.phone?.trim() || undefined;

  // First write, and the one that can refuse: no form URL, no prospect path.
  const onboarding = await requestOnboarding({ email, name, companyName, phone });
  if (onboarding.status !== "ok") {
    return {
      status: "error",
      message:
        onboarding.status === "unconfigured"
          ? `${onboarding.message} Nothing was saved — set it under Request onboarding, then quote them.`
          : onboarding.message,
    };
  }

  const clientId =
    onFile?.id ??
    (
      await prisma.client.create({
        data: {
          name: name ?? companyName ?? onboarding.leadName,
          companyName: companyName ?? null,
          email,
          phone: phone ?? null,
          // The flag that makes all of this safe: `approveOrder` and
          // `sendOrderQuote` both refuse while it is set, and recording their
          // onboarding is what clears it.
          prospectAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

  const created = await createOrder({
    clientId,
    type: "RENTAL",
    start: input.start,
    end: input.end,
    projectName: input.projectName,
    lines: input.lines,
  });
  if (created.status === "error") {
    // The lead is real and the form request genuinely happened, so say so
    // rather than reporting a clean failure that hides two new rows.
    return {
      status: "error",
      message: `${created.message} ${onboarding.leadName} was still opened as a lead and asked to onboard — the quote is the part that did not save.`,
    };
  }

  const href = `/dashboard/orders/${created.reservationId}`;
  const totals = await readBackTotals(created.reservationId);

  await linkLeadToProspectOrder(
    onboarding.leadId,
    clientId,
    created.reservationId,
    totals?.number ?? created.reservationId,
  );

  revalidatePath("/dashboard");

  const money =
    totals?.money ??
    "The quote was created, but its totals could not be read back. Open it to check the figures.";

  return {
    status: "ok",
    message: `${money} It is a draft held against a provisional account, and it has not been sent: ${email} gets the onboarding form, not the pricing.`,
    href,
    leadId: onboarding.leadId,
    leadName: onboarding.leadName,
    onboardingUrl: onboarding.url,
    delivered: onboarding.delivered,
    email,
  };
}
