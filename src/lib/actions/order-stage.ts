"use server";

import { revalidatePath } from "next/cache";
import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import {
  activateReservation,
  approveReservation,
  cancelReservation,
  completeReservation,
  markLost,
  markQuoteSent,
  addItemToReservation,
  markShipped,
  removeReservationItem,
  updateReservationItemQuantity,
  updateReservationItemRate,
  requestRevision,
  startPreparing,
  updateReservation,
} from "@/lib/actions/reservations";
import { generateQuoteToken, sendQuoteLinkEmail } from "@/lib/actions/quote-tokens";
import { createInvoiceFromReservation } from "@/lib/actions/invoices";
import { isEmailConfigured } from "@/lib/email/client";
import type {
  BillingCycleType,
  DeliveryMethod,
  PricingType,
} from "@/generated/prisma/client";

/**
 * The stage controls on the order record.
 *
 * A sibling to `lib/actions/desk.ts`, and for the same reason: the ported
 * transition actions each return a different shape — one throws, one returns
 * `{ error }`, one returns the updated row — and a screen cannot render three
 * shapes. Everything here comes back as one `StageOutcome`, so the action bar
 * has exactly one thing to handle.
 *
 * Nothing here re-implements a transition. Each wrapper calls the ported action
 * that already holds the transaction, the guard and the `StatusHistory` write,
 * and adds only what the screen needs on top: a message a person can read, and
 * the follow-on the dialog asked for (an email, an invoice).
 */

export type StageOutcome =
  | { status: "ok"; message: string; href?: string }
  | { status: "error"; message: string };

/** The ported actions disagree about how to fail. This is the one reading. */
function reasonFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "That did not work. Try again, or check the order's status.";
}

/** `{ error }` is how about half the ported actions refuse. */
function refusal(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const { error } = result as { error?: unknown };
    if (typeof error === "string") return error;
  }
  return null;
}

function touch(id: string) {
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/**
 * Mint a link to the online quote, for copying.
 *
 * Also stamps a 30-day expiry on the order when it has none, which is why this
 * is a write and not a read: the date on the link, on the PDF and on the order
 * have to be the same date.
 */
export async function createQuoteLink(
  id: string,
): Promise<{ status: "ok"; url: string } | { status: "error"; message: string }> {
  try {
    const { url } = await generateQuoteToken(id);
    touch(id);
    return { status: "ok", url };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Whether the account behind this order is still a shell.
 *
 * `Client.prospectAt` is set when a client row was materialised only to hold a
 * quote for somebody who has not onboarded — see `createProspectQuote`. It
 * earns its keep in exactly two places, both here: nothing commits stock to an
 * account nobody has verified, and nobody's full rate card goes to an address
 * nobody has verified. Recording their onboarding clears the flag, which is
 * the point — sending the quote is the reward for onboarding.
 *
 * Returns the refusal to show, or null when the order may proceed.
 */
async function prospectRefusal(id: string, act: string): Promise<string | null> {
  const order = await prisma.reservation.findUnique({
    where: { id },
    select: {
      client: {
        select: { id: true, name: true, prospectAt: true, convertedLeads: { select: { id: true }, take: 1 } },
      },
    },
  });
  const client = order?.client;
  if (!client?.prospectAt) return null;

  const lead = client.convertedLeads[0];
  return `${client.name} has not onboarded. ${act} would ${
    act === "Sending it"
      ? "put the full rate card in an inbox nobody has verified"
      : "commit stock to an account nobody has verified"
  }. Record their onboarding${lead ? " on their lead" : ""} first — that is what releases this quote.`;
}

/**
 * Send the quote, and record that it went.
 *
 * Two halves that are allowed to disagree. Emailing is best-effort — this
 * instance ships with outbound mail switched off, and a quote read out over the
 * phone or pasted into a thread is still a quote that was sent. So the status
 * moves on the person's say-so (they pressed OK), and the message says exactly
 * which addresses actually received something and which did not.
 *
 * Each recipient gets its own token. `sendQuoteLinkEmail` mints one per send,
 * and rather than fight that, it is the better behaviour: a link forwarded on
 * can be told apart from the one that was issued.
 */
export async function sendOrderQuote(
  id: string,
  input: { emails: string[]; message?: string },
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const held = await prospectRefusal(id, "Sending it");
  if (held) return { status: "error", message: held };

  const recipients = input.emails
    .flatMap((entry) => entry.split(/[,;\s]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);

  const sent: string[] = [];
  const failed: string[] = [];

  if (recipients.length > 0 && !isEmailConfigured()) {
    failed.push(...recipients);
  } else {
    for (const email of recipients) {
      try {
        await sendQuoteLinkEmail(id, email, input.message);
        sent.push(email);
      } catch {
        failed.push(email);
      }
    }
  }

  // sendQuoteLinkEmail already moves DRAFT/REVISION to QUOTE_SENT on a
  // successful send. When nothing sent — or the order was already out — this is
  // what records it, and a refusal here is only ever "it is past that stage".
  const order = await prisma.reservation.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!order) return { status: "error", message: "Order not found." };

  let moved = false;
  if (order.status === "DRAFT" || order.status === "REVISION") {
    const result = await markQuoteSent(id);
    const problem = refusal(result);
    if (problem) return { status: "error", message: problem };
    moved = true;
  }

  touch(id);

  const parts: string[] = [];
  if (sent.length > 0) parts.push(`Emailed to ${sent.join(", ")}.`);
  if (failed.length > 0) {
    parts.push(
      isEmailConfigured()
        ? `Could not email ${failed.join(", ")} — send the link yourself.`
        : `Outbound email is switched off here, so ${failed.join(", ")} was not written to. Copy the link and send it yourself.`,
    );
  }
  parts.push(moved ? "Marked as quoted." : "Already marked as quoted.");

  return { status: "ok", message: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

/** `force` skips the stock check the action runs, which only warns anyway. */
export async function approveOrder(id: string, force?: boolean): Promise<StageOutcome> {
  // Not something `force` can wave through. `force` skips the availability
  // warning, which is a judgement call about stock; this is a judgement call
  // about whether the customer exists, and the way past it is to record the
  // onboarding rather than to insist.
  const held = await prospectRefusal(id, "Approving it");
  if (held) return { status: "error", message: held };

  try {
    const result = await approveReservation(id, force);
    const problem = refusal(result);
    if (problem) return { status: "error", message: problem };
    touch(id);
    return { status: "ok", message: "Approved. It can be prepared now." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function reviseOrder(id: string, notes?: string): Promise<StageOutcome> {
  try {
    const result = await requestRevision(id, notes?.trim() || undefined);
    const problem = refusal(result);
    if (problem) return { status: "error", message: problem };
    touch(id);
    return { status: "ok", message: "Pulled back for revision. Reprice it, then send it again." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function loseOrder(id: string, reason?: string): Promise<StageOutcome> {
  try {
    await markLost(id, reason?.trim() || undefined);
    touch(id);
    return { status: "ok", message: "Marked lost." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function cancelOrder(id: string, reason?: string): Promise<StageOutcome> {
  try {
    await cancelReservation(id, reason?.trim() || undefined);
    touch(id);
    return { status: "ok", message: "Order canceled. Any assigned units were released." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

/**
 * Hand the order to the floor.
 *
 * Two things at once, because on this floor they are one act: the order is
 * flagged as being built by a named person, and — if asked for — the client is
 * told it is being built. The notification is optional and its failure is not
 * the transition's failure; the kit is being pulled either way.
 *
 * `preparedById` defaults to whoever pressed the button. Nobody prepares an
 * order anonymously, and making the common case require a dropdown selection
 * only produces orders with nobody's name on them.
 */
export async function prepareOrder(
  id: string,
  input: { preparedById?: string; notifyEmail?: string },
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const email = input.notifyEmail?.trim();
  if (email && !isEmailConfigured()) {
    return {
      status: "error",
      message:
        "Outbound email is switched off in this instance, so the client cannot be notified. Clear the address to prepare the order without one.",
    };
  }

  try {
    const result = await startPreparing(
      id,
      input.preparedById || auth.userId,
      email ? { email } : undefined,
    );
    const problem = refusal(result);
    if (problem) return { status: "error", message: problem };
    touch(id);
    return {
      status: "ok",
      message: email
        ? `Preparing. ${email} was told the order is being built.`
        : "Preparing. Scan units out against the lines as they are pulled.",
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function shipOrder(
  id: string,
  input: { notifyEmail?: string },
): Promise<StageOutcome> {
  const email = input.notifyEmail?.trim();
  if (email && !isEmailConfigured()) {
    return {
      status: "error",
      message:
        "Outbound email is switched off in this instance, so the client cannot be notified. Clear the address to mark it shipped without one.",
    };
  }

  try {
    const result = await markShipped(id, email ? { email } : undefined);
    const problem = refusal(result);
    if (problem) return { status: "error", message: problem };
    touch(id);
    return { status: "ok", message: "Marked shipped." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

/**
 * How the kit gets there and how it comes back.
 *
 * Fourteen columns for this have been on `Reservation` since the port, written
 * by `createReservation`, read by the quote portal, the delivery note, the
 * order-detail PDF and the client emails — and shown on no v2 screen at all. So
 * a client could read the delivery method off their own quote while nobody here
 * could see it, and the only way to correct a courier was to open the order in
 * v1. This is that wiring.
 *
 * Delegated to `updateReservation` rather than writing the columns, because
 * delivery and return costs feed the stored totals through
 * `applyShippingMargin` — writing them directly would leave an order whose
 * header total disagreed with its own shipping. It also syncs the two costs
 * onto the active package, which is where the quote portal reads them from.
 */
export type ShippingDetails = {
  deliveryMethod: DeliveryMethod | null;
  deliveryAddress: string;
  deliveryCourier: string;
  deliveryTrackingNumber: string;
  deliveryCost: number;
  returnMethod: DeliveryMethod | null;
  returnCourier: string;
  returnTrackingNumber: string;
  returnCost: number;
  shippingMarginType: "FIXED" | "PERCENTAGE" | null;
  shippingMargin: number;
  deliveryNotes: string;
};

export async function saveShipping(
  id: string,
  shipping: ShippingDetails,
): Promise<StageOutcome> {
  if (shipping.deliveryCost < 0 || shipping.returnCost < 0) {
    return { status: "error", message: "A shipping cost cannot be negative." };
  }
  if (shipping.shippingMargin < 0) {
    return { status: "error", message: "A shipping margin cannot be negative." };
  }
  if (shipping.shippingMarginType === "PERCENTAGE" && shipping.shippingMargin > 100) {
    return {
      status: "error",
      message: "A percentage margin cannot exceed 100.",
    };
  }
  // A tracking number with no carrier is a number nobody can look up, and every
  // one of the 15 parcel and freight orders in this database has a method with
  // no tracking at all — so the pairing is worth enforcing before the habit sets.
  if (shipping.deliveryTrackingNumber.trim() && !shipping.deliveryCourier.trim()) {
    return {
      status: "error",
      message: "Name the carrier the delivery tracking number belongs to.",
    };
  }
  if (shipping.returnTrackingNumber.trim() && !shipping.returnCourier.trim()) {
    return {
      status: "error",
      message: "Name the carrier the return tracking number belongs to.",
    };
  }

  try {
    await updateReservation(id, {
      deliveryMethod: shipping.deliveryMethod ?? "",
      deliveryAddress: shipping.deliveryAddress,
      deliveryCourier: shipping.deliveryCourier,
      deliveryTrackingNumber: shipping.deliveryTrackingNumber,
      deliveryCost: shipping.deliveryCost,
      returnMethod: shipping.returnMethod ?? "",
      returnCourier: shipping.returnCourier,
      returnTrackingNumber: shipping.returnTrackingNumber,
      returnCost: shipping.returnCost,
      shippingMarginType: shipping.shippingMarginType ?? "",
      shippingMargin: shipping.shippingMargin,
      deliveryNotes: shipping.deliveryNotes,
    });
    touch(id);
    return {
      status: "ok",
      message: "Shipping saved. The order total was repriced against it.",
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type BillingTerms = {
  billingCycleType: BillingCycleType;
  billingCycleDay: number;
  billingCycleDays: number | null;
  isRecurring: boolean;
  notBilled: boolean;
  taxRate: number;
  discountType: "PERCENTAGE" | "FIXED" | null;
  discountValue: number;
  paymentTerms: number | null;
};

/**
 * Save what the order bills on.
 *
 * Delegated to `updateReservation` rather than written here, because the cycle,
 * the discount and the tax rate all feed the stored totals — writing the
 * columns directly would leave an order whose header total disagreed with its
 * own tax rate. It also recomputes `nextBillingDate` from the cycle, which is
 * the column the billing run actually reads.
 */
export async function saveBillingTerms(
  id: string,
  terms: BillingTerms,
): Promise<StageOutcome> {
  if (terms.billingCycleType === "CUSTOM" && !terms.billingCycleDays) {
    return { status: "error", message: "A custom cycle needs a length in days." };
  }
  if (terms.taxRate < 0 || terms.taxRate > 100) {
    return { status: "error", message: "A tax rate is a percentage between 0 and 100." };
  }
  if (terms.discountType === "PERCENTAGE" && terms.discountValue > 100) {
    return { status: "error", message: "A percentage discount cannot exceed 100." };
  }

  try {
    await updateReservation(id, {
      billingCycleType: terms.billingCycleType,
      billingCycleDay: terms.billingCycleDay,
      ...(terms.billingCycleDays ? { billingCycleDays: terms.billingCycleDays } : {}),
      // A one-time charge is never recurring, whatever the switch said.
      isRecurring: terms.billingCycleType === "ONE_TIME" ? false : terms.isRecurring,
      notBilled: terms.notBilled,
      taxRate: terms.taxRate,
      discountType: terms.discountType ?? undefined,
      discountValue: terms.discountValue,
      ...(terms.paymentTerms != null ? { paymentTerms: terms.paymentTerms } : {}),
    });
    touch(id);
    return { status: "ok", message: "Billing terms saved. The order total was repriced against them." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Raise an invoice against the order, now.
 *
 * The recurring billing run raises the scheduled ones; this is the manual
 * counterpart, for the first charge on activation and for anything billed
 * out of cycle. The due date comes from the order's own payment terms, falling
 * back to the client's — the same precedence `runBillingCycle` uses.
 */
export async function invoiceOrder(
  id: string,
  input?: { dueDays?: number },
): Promise<StageOutcome> {
  const order = await prisma.reservation.findUnique({
    where: { id },
    select: {
      notBilled: true,
      total: true,
      paymentTerms: true,
      client: { select: { paymentTerms: true } },
    },
  });
  if (!order) return { status: "error", message: "Order not found." };
  if (order.notBilled) {
    return {
      status: "error",
      message: "This order is marked not billed. Clear that in its billing terms before invoicing it.",
    };
  }

  const days = input?.dueDays ?? order.paymentTerms ?? order.client.paymentTerms ?? 30;

  try {
    const invoice = await createInvoiceFromReservation(id, addDays(new Date(), days));
    touch(id);
    revalidatePath("/dashboard/invoices");
    const number = (invoice as { invoiceNumber?: string })?.invoiceNumber;
    const invoiceId = (invoice as { id?: string })?.id;
    return {
      status: "ok",
      message: `${number ?? "Invoice"} raised, due in ${days} days. It is a draft until you send it.`,
      href: invoiceId ? `/dashboard/invoices/${invoiceId}` : undefined,
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Activate the order: the point revenue starts.
 *
 * Activation is what puts an order on the billing run — `runBillingCycle` only
 * looks at `status: ACTIVE` — so this is the last moment the cycle can be got
 * right, and the dialog that calls it shows the terms rather than hiding them.
 * Terms passed here are saved first, so what the person confirmed is what the
 * order bills on.
 *
 * The first invoice is optional and raised after activation, never before: an
 * invoice against an order that failed to activate is worse than no invoice.
 */
export async function activateOrder(
  id: string,
  input?: { terms?: BillingTerms; invoiceNow?: boolean },
): Promise<StageOutcome> {
  if (input?.terms) {
    const saved = await saveBillingTerms(id, input.terms);
    if (saved.status === "error") return saved;
  }

  try {
    await activateReservation(id);
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }

  touch(id);

  const order = await prisma.reservation.findUnique({
    where: { id },
    select: { billingCycleType: true, isRecurring: true, nextBillingDate: true, notBilled: true },
  });

  const cycle =
    order?.notBilled === true
      ? "It is marked not billed, so nothing will be raised against it."
      : order?.billingCycleType === "ONE_TIME"
        ? "It bills once, for the whole term."
        : order?.nextBillingDate
          ? `Next invoice ${order.nextBillingDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
          : "No next billing date is set, so the run will not pick it up.";

  if (!input?.invoiceNow) {
    return { status: "ok", message: `Order active. ${cycle}` };
  }

  const invoiced = await invoiceOrder(id);
  if (invoiced.status === "error") {
    return {
      status: "ok",
      message: `Order active. ${cycle} The invoice was not raised: ${invoiced.message}`,
    };
  }
  return { status: "ok", message: `Order active. ${invoiced.message}`, href: invoiced.href };
}

export async function completeOrder(id: string): Promise<StageOutcome> {
  try {
    await completeReservation(id);
    touch(id);
    return { status: "ok", message: "Order completed." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Take a line off the order.
 *
 * `removeReservationItem` was ported and reachable from nothing, so a line
 * added in error could only be fixed in v1. It does more than delete a row: any
 * unit still out against the line is returned to stock, its checkout canceled
 * and its revenue recomputed, and the order is repriced from what is left.
 *
 * That is the right behaviour and it is also why the screen asks first, and
 * says the number. Removing a line with three units out with a client silently
 * marks three units available while they sit in somebody's studio.
 */
export async function removeOrderLine(
  reservationId: string,
  itemId: string,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const item = await prisma.reservationItem.findUnique({
    where: { id: itemId },
    select: {
      reservationId: true,
      description: true,
      asset: { select: { name: true } },
      _count: { select: { units: { where: { checkedOutAt: { not: null }, checkedInAt: null } } } },
    },
  });
  if (!item || item.reservationId !== reservationId) {
    return { status: "error", message: "That line is not on this order." };
  }

  const label = item.asset?.name ?? item.description ?? "The line";
  const out = item._count.units;

  try {
    await removeReservationItem(reservationId, itemId);
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }

  touch(reservationId);
  return {
    status: "ok",
    message:
      out > 0
        ? `${label} removed. ${out} ${out === 1 ? "unit was" : "units were"} still out against it and ${out === 1 ? "has" : "have"} been returned to stock — check ${out === 1 ? "it is" : "they are"} physically back.`
        : `${label} removed and the order repriced.`,
  };
}

/**
 * Change what a line costs, or how many of it.
 *
 * Both ported actions reprice the line and the order in one transaction and
 * refuse on a closed order; quantity additionally refuses to drop below what is
 * physically checked out, which is the guard that matters — the alternative is
 * an order claiming to be for two machines while three are with the client.
 *
 * Revising is why these exist. The stage moved to REVISION and nothing on the
 * record could actually be revised, so an order pulled back for repricing was a
 * dead end: the only ways out were removing a line wholesale or editing it in
 * v1.
 */
export async function setLineQuantity(
  reservationId: string,
  itemId: string,
  quantity: number,
): Promise<StageOutcome> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { status: "error", message: "A line is for at least one." };
  }
  try {
    await updateReservationItemQuantity(reservationId, itemId, quantity);
    touch(reservationId);
    return { status: "ok", message: `Quantity set to ${quantity}; the order was repriced.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function setLineRate(
  reservationId: string,
  itemId: string,
  rate: number,
  pricingType?: PricingType,
): Promise<StageOutcome> {
  if (!Number.isFinite(rate) || rate < 0) {
    return { status: "error", message: "A rate is zero or more." };
  }
  try {
    await updateReservationItemRate(reservationId, itemId, rate, pricingType);
    touch(reservationId);
    return { status: "ok", message: "Rate updated; the order was repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Put another line on the order.
 *
 * Takes an asset, or a description for an ad-hoc charge. The rate is passed
 * explicitly rather than looked up again: the caller has already been shown a
 * rate alongside the availability for this order's window, and quietly
 * substituting a different one at save time is how a quoted price and a booked
 * price come apart.
 */
export async function addOrderLine(
  reservationId: string,
  line: {
    assetId?: string | null;
    description?: string;
    rate: number;
    pricingType: PricingType;
    quantity: number;
    isOneTime?: boolean;
  },
): Promise<StageOutcome> {
  if (!line.assetId && !line.description?.trim()) {
    return { status: "error", message: "A line needs an asset or a description." };
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return { status: "error", message: "A line is for at least one." };
  }
  if (!Number.isFinite(line.rate) || line.rate < 0) {
    return { status: "error", message: "A rate is zero or more." };
  }

  try {
    const created = await addItemToReservation(
      reservationId,
      line.assetId ?? null,
      line.pricingType,
      line.rate,
      line.quantity,
      line.description?.trim() || undefined,
      undefined,
      line.isOneTime,
    );

    // If the asset is a SKU with a build, its default parts come with it. That
    // is the whole point of recording a build: the workstation arrives on the
    // order already configured, instead of somebody rebuilding the same four
    // rows by hand for the ninth time.
    let added = 0;
    const itemId = (created as { id?: string })?.id;
    if (itemId && line.assetId) {
      const { expandBuildOntoLine } = await import("@/lib/actions/asset-build");
      ({ added } = await expandBuildOntoLine(reservationId, itemId));
      if (added > 0) await repriceOrder(reservationId);
    }

    touch(reservationId);
    return {
      status: "ok",
      message:
        added > 0
          ? `Line added with its ${added} default ${added === 1 ? "part" : "parts"}; the order was repriced.`
          : "Line added; the order was repriced.",
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Recompute an order's stored totals from the lines it now has.
 *
 * Needed because expanding a build writes rows straight through
 * `createMany` — no per-row action runs, so nothing repriced. Included parts
 * carry a real rate and a zero subtotal, so summing subtotals is what respects
 * them; summing rate × quantity would charge for the base spec.
 */
async function repriceOrder(reservationId: string): Promise<void> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      discountType: true,
      discountValue: true,
      taxRate: true,
      deliveryCost: true,
      returnCost: true,
      rentalCreditAmount: true,
      packages: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!order) return;

  const activePackageId = order.packages[0]?.id;
  const items = await prisma.reservationItem.findMany({
    where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
    select: { subtotal: true },
  });

  const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const discountValue = Number(order.discountValue ?? 0);
  let discountAmount = 0;
  if (order.discountType === "PERCENTAGE" && discountValue > 0) {
    discountAmount = subtotal * (discountValue / 100);
  } else if (order.discountType === "FIXED" && discountValue > 0) {
    discountAmount = Math.min(discountValue, subtotal);
  }
  const afterCredit =
    subtotal - discountAmount - Number(order.rentalCreditAmount ?? 0);
  const taxAmount = afterCredit * (Number(order.taxRate ?? 0) / 100);
  const total =
    afterCredit +
    taxAmount +
    Number(order.deliveryCost ?? 0) +
    Number(order.returnCost ?? 0);

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { subtotal, discountAmount, taxAmount, total },
  });
}
