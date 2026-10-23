import { prisma } from "@/lib/prisma";

/**
 * The people we deal with, each under the account they belong to.
 *
 * An account is the company or individual (terms, billing, its own address).
 * A contact is a person at it. Only contacts are listed here; an account's own
 * address is managed on the account.
 */
export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  email: string | null;
  phone: string | null;
  emailApproved: boolean;
  clientId: string;
  account: string;
};

export async function getContactRows(search = ""): Promise<ContactRow[]> {
  const needle = search.trim();
  const contains = { contains: needle, mode: "insensitive" } as const;
  const contacts = await prisma.clientContact.findMany({
    where: needle
      ? {
          OR: [
            { name: contains },
            { email: contains },
            { role: contains },
            { client: { name: contains } },
            { client: { companyName: contains } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      role: true,
      isPrimary: true,
      email: true,
      phone: true,
      emailApproved: true,
      client: { select: { id: true, name: true, companyName: true } },
    },
  });

  return contacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      isPrimary: contact.isPrimary,
      email: contact.email,
      phone: contact.phone,
      emailApproved: contact.emailApproved,
      clientId: contact.client.id,
      account: contact.client.companyName?.trim() || contact.client.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One contact with the account it belongs to, for the profile page. */
export async function getContact(id: string) {
  return prisma.clientContact.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isPrimary: true,
      notes: true,
      emailApproved: true,
      emailApprovedAt: true,
      createdAt: true,
      updatedAt: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          email: true,
          phone: true,
          paymentTerms: true,
          _count: { select: { contacts: true, reservations: true } },
        },
      },
    },
  });
}

export type QuoteRecipients = {
  options: { email: string; label: string; role: string | null; approved: boolean }[];
  /** Who is ticked when the dialog opens: the primary contact, else the account email. */
  defaultEmail: string | null;
};

/**
 * Every address a quote on this order could go to: the account's own email and
 * each contact's. One entry per address (an address on both the account and a
 * contact is listed once, under the person), with whether it is approved.
 */
export async function getQuoteRecipients(orderId: string): Promise<QuoteRecipients> {
  const order = await prisma.reservation.findUnique({
    where: { id: orderId },
    select: {
      client: {
        select: {
          email: true,
          emailApproved: true,
          contacts: {
            orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
            select: { name: true, email: true, role: true, isPrimary: true, emailApproved: true },
          },
        },
      },
    },
  });
  if (!order) return { options: [], defaultEmail: null };

  const { client } = order;
  const options: QuoteRecipients["options"] = [];
  const seen = new Map<string, number>();
  const add = (email: string | null, label: string, role: string | null, approved: boolean) => {
    const trimmed = email?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const at = seen.get(key);
    if (at !== undefined) {
      options[at].approved ||= approved;
      return;
    }
    seen.set(key, options.length);
    options.push({ email: trimmed, label, role, approved });
  };

  for (const contact of client.contacts) {
    add(contact.email, contact.name, contact.role, contact.emailApproved);
  }
  add(client.email, "Account email", null, client.emailApproved);

  const primary = client.contacts.find((contact) => contact.isPrimary && contact.email?.trim());
  return { options, defaultEmail: primary?.email?.trim() || client.email?.trim() || null };
}
