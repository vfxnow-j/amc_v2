import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured } from "@/lib/email/client";
import { approvalProblem } from "@/lib/email/approval";
import { sendQuoteLinkEmail } from "@/lib/actions/quote-tokens";
import { markQuoteSent } from "@/lib/actions/reservations";

/**
 * Putting a quote in front of the client: email each chosen address its own
 * link, then make sure the order reads Quote Sent.
 *
 * Shared by the Send quote dialog and by an approver's yes. Not a "use server"
 * file on purpose: both callers have already done their own checks (the
 * dialog's approval gate, the approver's decision), and exporting this as an
 * action would let anyone call it with those skipped.
 *
 * Two halves that may disagree. Emailing is best-effort, because a quote read
 * out over the phone is still a quote that was sent, so the status moves on the
 * caller's say-so and the message says which addresses were actually written to.
 * An address that is not approved for email stops everything before anything
 * is sent or moved.
 */

export type DeliveryOutcome =
  | { status: "ok"; message: string; sent: string[]; failed: string[] }
  | { status: "error"; message: string };

export function splitRecipients(entries: string[]): string[] {
  return entries
    .flatMap((entry) => entry.split(/[,;\s]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function deliverQuote(
  id: string,
  recipients: string[],
  message?: string | null,
): Promise<DeliveryOutcome> {
  const order = await prisma.reservation.findUnique({
    where: { id },
    select: { clientId: true },
  });
  if (!order) return { status: "error", message: "Order not found." };

  // Refused before anything is sent or the stage moves.
  if (recipients.length > 0) {
    const problem = await approvalProblem(recipients, "client", order.clientId);
    if (problem) return { status: "error", message: problem };
  }

  const sent: string[] = [];
  const failed: string[] = [];

  if (recipients.length > 0 && !isEmailConfigured()) {
    failed.push(...recipients);
  } else {
    for (const email of recipients) {
      try {
        await sendQuoteLinkEmail(id, email, message ?? undefined);
        sent.push(email);
      } catch {
        failed.push(email);
      }
    }
  }

  // sendQuoteLinkEmail already moves DRAFT/REVISION to QUOTE_SENT on a
  // successful send. When nothing sent, or the order was already out, this is
  // what records it; a refusal here is only ever "it is past that stage".
  const current = await prisma.reservation.findUnique({ where: { id }, select: { status: true } });
  if (!current) return { status: "error", message: "Order not found." };

  let moved = false;
  if (current.status === "DRAFT" || current.status === "REVISION") {
    const result = (await markQuoteSent(id)) as unknown;
    if (result && typeof result === "object" && "error" in result && typeof (result as { error?: unknown }).error === "string") {
      return { status: "error", message: (result as { error: string }).error };
    }
    moved = true;
  }

  // A send went out (or was recorded): the held choice is spent.
  await prisma.quoteSendIntent.deleteMany({ where: { reservationId: id } });

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);

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

  return { status: "ok", message: parts.join(" "), sent, failed };
}
