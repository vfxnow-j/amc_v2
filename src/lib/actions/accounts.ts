"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { createClient } from "@/lib/actions/clients";
import { logAudit } from "@/lib/actions/audit";
import { approvalAfterEmailChange } from "@/lib/email/approval";

/**
 * Creating an account.
 *
 * v2 could read every client and edit one, and had no way to make one — which
 * meant a new customer had to be added in v1, and testing an order meant
 * hanging it off a real restored customer. `createClient` was ported and
 * reachable from nothing.
 *
 * A thin v2 layer over it, for the same reason as `order-stage.ts`: the ported
 * action throws, and a form needs a result it can render. It also does the
 * checking the ported action does not — a client with no name is a row nobody
 * can find again, and two accounts with the same name is how an order ends up
 * on the wrong one.
 */

export type AccountInput = {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: string;
  billingAddress?: string;
  paymentTerms?: number;
  taxExempt?: boolean;
  notes?: string;
  /** Set when the caller has already been warned the name is taken. */
  allowDuplicateName?: boolean;
  /** Edit only. Undefined leaves it; null/"" clears it. Both must be this account's contacts. */
  primaryContactId?: string | null;
  billingContactId?: string | null;
};

export type AccountOutcome =
  | { status: "ok"; id: string; name: string }
  | { status: "error"; message: string }
  | {
      status: "duplicate";
      message: string;
      existing: { id: string; name: string; companyName: string | null };
    };

export async function createAccount(input: AccountInput): Promise<AccountOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const name = input.name.trim();
  if (!name) {
    return { status: "error", message: "An account needs a name." };
  }

  const email = input.email?.trim();
  // Deliberately loose. The strict check belongs to whatever tries to send to
  // it; refusing a real address because it does not match a regex is worse than
  // storing one that bounces.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: `"${email}" does not look like an email address.` };
  }

  const terms = input.paymentTerms;
  if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) {
    return { status: "error", message: "Payment terms are a whole number of days, 0 to 365." };
  }

  // Named the same as an existing account is usually a second person creating
  // the account somebody already made, so it asks rather than refusing —
  // genuinely distinct clients do share a name.
  if (!input.allowDuplicateName) {
    const existing = await prisma.client.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, companyName: true },
    });
    if (existing) {
      return {
        status: "duplicate",
        message: `An account called "${existing.name}" already exists.`,
        existing,
      };
    }
  }

  try {
    const client = await createClient({
      name,
      companyName: input.companyName?.trim() || undefined,
      email: email || undefined,
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
      billingAddress: input.billingAddress?.trim() || undefined,
      paymentTerms: terms,
      taxExempt: input.taxExempt,
      notes: input.notes?.trim() || undefined,
    });

    revalidatePath("/dashboard/clients");
    return {
      status: "ok",
      id: (client as { id: string }).id,
      name: (client as { name: string }).name,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "That account could not be created.",
    };
  }
}

/**
 * Editing an account: the business (or individual) and what is managed on it —
 * name, company, terms, addresses, tax status, its own email.
 *
 * Blank fields clear to nothing rather than saving empty strings. Changing the
 * account email clears its email approval, like any record's email. The
 * previous values go to the audit log, so a rename can be traced back.
 */
export async function updateAccount(
  id: string,
  input: AccountInput,
): Promise<AccountOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const before = await prisma.client.findUnique({
    where: { id },
    select: {
      name: true,
      companyName: true,
      email: true,
      phone: true,
      address: true,
      billingAddress: true,
      paymentTerms: true,
      taxExempt: true,
      notes: true,
    },
  });
  if (!before) return { status: "error", message: "Account not found." };

  const name = input.name.trim();
  if (!name) return { status: "error", message: "An account needs a name." };

  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: `"${email}" does not look like an email address.` };
  }

  const terms = input.paymentTerms;
  if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) {
    return { status: "error", message: "Payment terms are a whole number of days, 0 to 365." };
  }

  if (!input.allowDuplicateName && name.toLowerCase() !== before.name.toLowerCase()) {
    const existing = await prisma.client.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, NOT: { id } },
      select: { id: true, name: true, companyName: true },
    });
    if (existing) {
      return {
        status: "duplicate",
        message: `An account called "${existing.name}" already exists.`,
        existing,
      };
    }
  }

  // The people at the account are contacts, so the account is one thing: its
  // name is the company (or the individual). Both columns carry it so every
  // screen that reads either shows the same words.
  const blank = (value?: string) => value?.trim() || null;
  const data = {
    name,
    companyName: name,
    email,
    phone: blank(input.phone),
    address: blank(input.address),
    billingAddress: blank(input.billingAddress),
    notes: blank(input.notes),
    ...(terms != null && { paymentTerms: terms }),
    ...(input.taxExempt !== undefined && { taxExempt: input.taxExempt }),
    ...approvalAfterEmailChange(before.email, email),
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id }, data });

      const own = await tx.clientContact.findMany({ where: { clientId: id }, select: { id: true } });
      const ids = new Set(own.map((contact) => contact.id));
      const check = (contactId?: string | null) => {
        if (contactId && !ids.has(contactId)) throw new Error("That contact is not at this account.");
      };
      check(input.primaryContactId);
      check(input.billingContactId);

      if (input.primaryContactId !== undefined) {
        await tx.clientContact.updateMany({ where: { clientId: id, isPrimary: true }, data: { isPrimary: false } });
        if (input.primaryContactId) {
          await tx.clientContact.update({ where: { id: input.primaryContactId }, data: { isPrimary: true } });
        }
      }
      if (input.billingContactId !== undefined) {
        // One billing contact: whoever held the role before goes back to Associated.
        await tx.clientContact.updateMany({
          where: { clientId: id, role: "Billing", NOT: { id: input.billingContactId || undefined } },
          data: { role: "Associated" },
        });
        if (input.billingContactId) {
          await tx.clientContact.update({ where: { id: input.billingContactId }, data: { role: "Billing" } });
        }
      }
    });
    await logAudit({
      action: "UPDATE",
      entityType: "Client",
      entityId: id,
      oldValues: before,
      newValues: {
        ...data,
        ...(input.primaryContactId !== undefined && { primaryContactId: input.primaryContactId }),
        ...(input.billingContactId !== undefined && { billingContactId: input.billingContactId }),
      },
    });
    revalidatePath(`/dashboard/clients/${id}`);
    revalidatePath("/dashboard/clients");
    revalidatePath("/dashboard/clients/contacts");
    return { status: "ok", id, name };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "That account could not be saved.",
    };
  }
}
