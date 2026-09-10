import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/actions/audit";
import { APP_URL } from "@/lib/email/client";
import type { LeadStatus } from "@/generated/prisma/client";

/**
 * What happens when an onboarding form comes back.
 *
 * A plain module rather than an action, and that is the point. Two callers
 * reach it — the "Record onboarding" button on the lead record, and the Zapier
 * route — and only one of them has a session. Exporting this from
 * `lib/actions/leads.ts` would publish an unauthenticated server action that
 * rewrites a client record to anybody who can guess an action id, so the
 * gating lives with the callers: the action wrapper runs `requireEditor`, the
 * route checks the webhook secret, and neither can be skipped by reaching for
 * the other one.
 *
 * Three things it does, in this order, because each depends on the last:
 *
 *  1. **Enriches the client, filling blanks only.** A form is somebody typing
 *     their own address into a box at 11pm; the client record is what an
 *     account manager corrected after ringing them. Overwriting the second
 *     with the first is how a good billing address becomes a bad one, so a
 *     field that already holds anything is left exactly as it is and reported
 *     as kept rather than silently ignored.
 *  2. **Clears `prospectAt`.** That flag is the whole reason a thin client can
 *     hold a quote at all: `approveOrder` and `sendOrderQuote` refuse while it
 *     is set. Clearing it here is what turns a held quote into a live one.
 *  3. **Stamps the held order `actionRequired`.** Somebody has to actually
 *     send the quote, and an onboarding that lands at midnight with nothing on
 *     a screen is an onboarding nobody acts on. `actionRequired` is the field
 *     the Decisions card already reads.
 *
 * The requirements token is minted here too, so the ID/COI ask goes out on the
 * same beat rather than waiting for somebody to remember it.
 */

/** What a form hands back. Every field optional — forms are half-filled. */
export type OnboardingPayload = {
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: string;
  billingAddress?: string;
  notes?: string;
};

export type OnboardingApplied = {
  leadId: string;
  leadName: string;
  clientId: string;
  clientName: string;
  /** True when this lead had no account behind it and one was opened. */
  clientCreated: boolean;
  /** True when the account was a quote-holding shell until now. */
  wasProspect: boolean;
  /** Fields the payload actually filled, in client-record terms. */
  filled: string[];
  /** Fields the payload carried that were left alone because they were set. */
  keptTyped: string[];
  order: { id: string; reservationNumber: string; flagged: boolean } | null;
  requirements: { url: string; types: string[] } | null;
};

export type OnboardingResult = OnboardingApplied | { error: string };

/** The quote stages. Onboarding is only news to an order still at one of them. */
const QUOTE_STAGE = ["DRAFT", "QUOTE_SENT", "REVISION"];

/**
 * Onboarding proves they are real, not that they said yes — so the furthest it
 * ever moves a lead is Qualified, and only forwards.
 */
const PIPELINE: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROSPECT",
  "WON",
];

function advancesTo(current: LeadStatus, suggested: LeadStatus): boolean {
  const from = PIPELINE.indexOf(current);
  const to = PIPELINE.indexOf(suggested);
  return from !== -1 && to !== -1 && to > from;
}

function clean(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function applyOnboardingToLead(
  leadId: string,
  payload: OnboardingPayload,
  options: { userId?: string | null; via: "manual" | "webhook" },
): Promise<OnboardingResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      companyName: true,
      status: true,
      convertedToClientId: true,
      boundToClientId: true,
      convertedReservationId: true,
      boundToReservationId: true,
    },
  });
  if (!lead) return { error: "That lead no longer exists." };

  const email = clean(payload.email) ?? lead.email;

  // The account this onboarding belongs to. A lead that was quoted already has
  // one — the shell the quote hangs off. One that came straight off the form
  // does not, and this is exactly the moment it earns an account.
  let clientId = lead.convertedToClientId ?? lead.boundToClientId ?? null;
  if (!clientId && email) {
    const byEmail = await prisma.client.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    clientId = byEmail?.id ?? null;
  }

  let clientCreated = false;
  if (!clientId) {
    const opened = await prisma.client.create({
      data: {
        name: clean(payload.name) ?? clean(payload.companyName) ?? lead.name,
        companyName: clean(payload.companyName) ?? lead.companyName,
        email,
        phone: clean(payload.phone) ?? lead.phone,
        address: clean(payload.address),
        billingAddress: clean(payload.billingAddress),
        notes: clean(payload.notes),
      },
      select: { id: true },
    });
    clientId = opened.id;
    clientCreated = true;
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      companyName: true,
      email: true,
      phone: true,
      address: true,
      billingAddress: true,
      notes: true,
      prospectAt: true,
      idVerifiedAt: true,
      coiVerifiedAt: true,
      agreementSignedAt: true,
      skipIdRequirement: true,
      skipCoiRequirement: true,
    },
  });
  if (!client) return { error: "The account behind this lead has gone." };

  // Blanks only. A field with anything in it was put there by somebody who
  // knew more than a web form does.
  const candidates: { column: string; label: string; value: string | null }[] = [
    { column: "companyName", label: "Company", value: clean(payload.companyName) },
    { column: "email", label: "Email", value: clean(payload.email) },
    { column: "phone", label: "Phone", value: clean(payload.phone) },
    { column: "address", label: "Address", value: clean(payload.address) },
    { column: "billingAddress", label: "Billing address", value: clean(payload.billingAddress) },
    { column: "notes", label: "Notes", value: clean(payload.notes) },
  ];

  const current = client as unknown as Record<string, string | null>;
  const data: Record<string, unknown> = {};
  const filled: string[] = [];
  const keptTyped: string[] = [];

  for (const field of candidates) {
    if (!field.value) continue;
    if (current[field.column]) {
      if (current[field.column]?.trim() !== field.value) keptTyped.push(field.label);
      continue;
    }
    data[field.column] = field.value;
    filled.push(field.label);
  }

  // The name is never blank — `Client.name` is required — so it is only ever
  // replaced when what is there is the shell's placeholder: the local part of
  // the address, which is what the prospect path had to invent.
  const offeredName = clean(payload.name);
  if (offeredName && client.prospectAt && client.name !== offeredName) {
    // Compared with the punctuation squashed out, because the shell and the
    // lead name it off the same address by different routes: "j.smith@…"
    // becomes the client "J Smith" and the lead "J Smith", and a literal
    // comparison would call a name nobody chose a name somebody typed.
    const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const placeholder =
      !!client.email && squash(client.name) === squash(client.email.split("@")[0] ?? "");
    if (placeholder) {
      data.name = offeredName;
      filled.push("Name");
    } else {
      keptTyped.push("Name");
    }
  }

  const wasProspect = !!client.prospectAt;
  if (wasProspect) data.prospectAt = null;

  if (Object.keys(data).length > 0) {
    await prisma.client.update({ where: { id: client.id }, data });
  }

  // What still has to be collected. Anything already verified or waived is not
  // asked for again — a form asking for an ID they sent last week reads as the
  // app having lost it.
  const types: string[] = [];
  if (!client.skipIdRequirement && !client.idVerifiedAt) types.push("ID");
  if (!client.skipCoiRequirement && !client.coiVerifiedAt) types.push("COI");
  if (!client.agreementSignedAt) types.push("AGREEMENT");

  let requirements: OnboardingApplied["requirements"] = null;
  if (types.length > 0) {
    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await prisma.clientRequirementToken.create({
      data: { token, clientId: client.id, requirementTypes: types, expiresAt },
    });
    requirements = { url: `${APP_URL}/requirements/${token}`, types };
  }

  // The quote that was waiting on this.
  const orderId = lead.convertedReservationId ?? lead.boundToReservationId;
  let order: OnboardingApplied["order"] = null;
  if (orderId) {
    const held = await prisma.reservation.findUnique({
      where: { id: orderId },
      select: { id: true, reservationNumber: true, status: true, actionRequired: true },
    });
    if (held) {
      const flag = QUOTE_STAGE.includes(held.status);
      if (flag) {
        await prisma.reservation.update({
          where: { id: held.id },
          data: {
            actionRequired: true,
            actionRequiredNote: `${client.companyName ?? client.name} has onboarded. The quote was held back until they did — send it.`,
          },
        });
      }
      order = {
        id: held.id,
        reservationNumber: held.reservationNumber,
        flagged: flag,
      };
    }
  }

  if (advancesTo(lead.status, "QUALIFIED")) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "QUALIFIED" },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        title: `Pipeline advanced: ${lead.status} → QUALIFIED`,
        description: "Onboarding form received.",
        metadata: { previousStatus: lead.status, newStatus: "QUALIFIED" },
        createdById: options.userId || undefined,
      },
    });
  }

  if (!lead.convertedToClientId) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { convertedToClientId: client.id },
    });
  }

  // Field *names* in the metadata, never the values: an activity log is read
  // by everyone with a login, and a form carries home addresses.
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "SYSTEM",
      title: "Onboarding received",
      description: [
        filled.length > 0
          ? `Filled ${filled.join(", ").toLowerCase()} on the account.`
          : "Nothing on the account was blank, so nothing was changed.",
        keptTyped.length > 0
          ? `Left ${keptTyped.join(", ").toLowerCase()} as already recorded — the form disagreed and what was on file won.`
          : null,
        wasProspect ? "The account is no longer provisional." : null,
        order?.flagged ? `${order.reservationNumber} is flagged for sending.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      metadata: {
        via: options.via,
        filled,
        keptTyped,
        clientId: client.id,
        wasProspect,
        requirementTypes: types,
      },
      createdById: options.userId || undefined,
    },
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: client.id,
    oldValues: { prospectAt: client.prospectAt },
    newValues: { onboardedVia: options.via, filled, leadId: lead.id },
    userId: options.userId ?? undefined,
  });

  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${lead.id}`);
  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${client.id}`);
  revalidatePath("/dashboard");
  if (order) revalidatePath(`/dashboard/orders/${order.id}`);

  return {
    leadId: lead.id,
    leadName: lead.name,
    clientId: client.id,
    clientName: (data.name as string | undefined) ?? client.name,
    clientCreated,
    wasProspect,
    filled,
    keptTyped,
    order,
    requirements,
  };
}
