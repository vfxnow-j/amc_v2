import { prisma } from "@/lib/prisma";

/**
 * The person behind a lead becomes a contact on the account, so the two are
 * kept apart and linked: the account holds the business (terms, billing,
 * orders), the contact holds the human.
 *
 * Idempotent. A contact already on the account for this lead, or with the same
 * email, is left alone. The first contact on an account is its primary.
 */
export async function ensureLeadContact(
  clientId: string,
  lead: { id: string; name: string; email: string | null; phone: string | null },
  role?: string,
) {
  const name = lead.name?.trim();
  if (!name) return null;

  const email = lead.email?.trim() || null;
  const existing = await prisma.clientContact.findMany({
    where: { clientId },
    select: { id: true, email: true, leadId: true },
  });
  const present = existing.find(
    (contact) =>
      contact.leadId === lead.id ||
      (email && contact.email && contact.email.toLowerCase() === email.toLowerCase()),
  );
  if (present) return present.id;

  const first = existing.length === 0;
  const created = await prisma.clientContact.create({
    data: {
      clientId,
      name,
      email,
      phone: lead.phone?.trim() || null,
      role: role ?? (first ? "Primary" : "Associated"),
      isPrimary: first,
      leadId: lead.id,
    },
    select: { id: true },
  });
  return created.id;
}
