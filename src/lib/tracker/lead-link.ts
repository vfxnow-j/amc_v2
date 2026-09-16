import { prisma } from "@/lib/prisma";

/**
 * Hand an account the rep who owned the enquiry it came from.
 *
 * A lead's `assignedToId` **is** its owner in the tracker (docs/client-tracker.md,
 * "Lead assignment becomes the owner concept for leads"), but nothing carried
 * it across: every route that opened an account from a lead — conversion, a
 * prospect quote's shell, onboarding, binding — left `Client.ownerId` null, so
 * an account somebody had been working for weeks arrived in the claimable pool
 * the moment it became real. The queue then showed it under Pool rather than
 * under its rep's Mine, and "going quiet" raised no notification at all,
 * because that item deliberately has no recipient on an unowned account.
 *
 * Only ever fills a blank. An account that already has an owner keeps them: a
 * second lead binding to an established account is a new contact ringing in,
 * not a change of rep, and this must never be able to move an account away from
 * whoever holds it. Idempotent, and quiet when there is nothing to carry.
 *
 * A plain module rather than a Server Function — it is called from inside four
 * actions that have already checked the caller's role, and exporting it from a
 * `"use server"` file would publish it as a callable of its own.
 */
export async function adoptLeadOwner(clientId: string, leadId: string): Promise<void> {
  const [client, lead] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { ownerId: true } }),
    prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } }),
  ]);
  if (!client || client.ownerId || !lead?.assignedToId) return;

  await prisma.client.update({
    where: { id: clientId },
    data: { ownerId: lead.assignedToId },
  });
}
