import { prisma } from "@/lib/prisma";

/**
 * Where an account's invoices and payment reminders go.
 *
 * The account's Billing contact, when it has one with an email; otherwise the
 * account's own address. Billing is a contact role rather than a second email
 * field on the account, so the address has one record and one email approval.
 */
export async function billingEmailFor(client: {
  id: string;
  email: string | null;
}): Promise<string | null> {
  const billing = await prisma.clientContact.findFirst({
    where: { clientId: client.id, role: "Billing", email: { not: null } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { email: true },
  });
  return billing?.email?.trim() || client.email?.trim() || null;
}
