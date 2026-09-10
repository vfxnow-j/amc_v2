"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAuth, requireEditor } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { serialize } from "@/lib/utils";
import { sendEmail } from "@/lib/email/send";
import { clientRequirementsRequestEmail } from "@/lib/email/templates";
import { APP_URL, isEmailConfigured } from "@/lib/email/client";
import {
  readTemplateMeta,
  removeTemplate,
  signAgreement,
  type TemplateMeta,
} from "@/lib/requirements/store";
import type { RequirementKind } from "@/lib/requirements/token";

/**
 * The staff half of requirements: ask for documents, waive them, sign on a
 * client's behalf, and manage the one agreement template.
 *
 * **Everything ungated has left this file.** A `"use server"` module that any
 * client component imports has an action id minted for every one of its
 * exports, and this one is imported by `settings/document-actions.tsx` and
 * `documents/print-dropdown.tsx`. It used to also export `uploadClientDocument`
 * and `signAgreementForClient` with no authorization check at all — write a
 * file, stamp `idVerifiedAt` on any client id, record a signed agreement — plus
 * `getAgreementTemplatePath`, which handed out an absolute server path. Those
 * moved to `lib/requirements/store.ts`, a plain module no client bundle can
 * reach, and what is left here is wrappers with a gate on each.
 *
 * The public portal does not come through this file at all. It is served by
 * route handlers under `app/api/requirements/[token]/`, which check the token
 * themselves — see `lib/requirements/token.ts`. Nothing a stranger can call is
 * a Server Function.
 */

export type RequirementsOutcome =
  | { status: "ok"; message: string; url?: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// The agreement template
// ---------------------------------------------------------------------------

/**
 * The template's metadata, for the screens that report on it.
 *
 * Session-gated, unlike the rest of what it used to sit beside. The portal
 * needs the same fact for an unauthenticated visitor and reads
 * `readTemplateMeta` from the store directly rather than reaching through an
 * action that would have to drop its gate to serve it.
 */
export async function getAgreementTemplate(): Promise<TemplateMeta | null> {
  const auth = await requireAuth();
  if (!auth.authorized) return null;
  return readTemplateMeta();
}

export async function deleteAgreementTemplate(): Promise<RequirementsOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Admin access required" };
  }

  await removeTemplate();
  revalidatePath("/dashboard/settings/documents");
  return {
    status: "ok",
    message:
      "Template removed. Until another is uploaded there is nothing for a client to sign.",
  };
}

// ---------------------------------------------------------------------------
// Signing on a client's behalf
// ---------------------------------------------------------------------------

/**
 * Record a signature taken in the room — over a counter, or read back over the
 * phone and countersigned.
 *
 * `requireEditor`, because this writes an agreement in somebody else's name.
 * The customer's own route to the same document is the portal, which proves who
 * it is by the token in the link rather than by a session.
 */
export async function signAgreementForClient(
  clientId: string,
  signerName: string,
  signatureDataUrl: string,
  reservationId?: string,
): Promise<RequirementsOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const name = signerName.trim();
  if (!name) return { status: "error", message: "A signer's name is required." };
  if (!signatureDataUrl.startsWith("data:image/png;base64,")) {
    return { status: "error", message: "That signature did not come through." };
  }

  try {
    await signAgreement(clientId, name, signatureDataUrl, reservationId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "The agreement could not be signed.",
    };
  }

  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: clientId,
    newValues: { agreementSignedBy: name, on_behalf: true },
    userId: auth.userId,
  });

  revalidatePath(`/dashboard/clients/${clientId}`);
  return { status: "ok", message: `Agreement recorded as signed by ${name}.` };
}

// ---------------------------------------------------------------------------
// What an account still owes us
// ---------------------------------------------------------------------------

export async function getClientVerificationStatus(clientId: string) {
  const auth = await requireAuth();
  if (!auth.authorized) throw new Error(auth.error || "Unauthorized");

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      agreementSignedAt: true,
      agreementSignerName: true,
      idVerifiedAt: true,
      coiVerifiedAt: true,
      skipIdRequirement: true,
      skipCoiRequirement: true,
    },
  });

  if (!client) throw new Error("Client not found");

  const template = await readTemplateMeta();

  return serialize({
    hasTemplate: !!template,
    agreementSigned: !!client.agreementSignedAt,
    agreementSignedAt: client.agreementSignedAt,
    agreementSignerName: client.agreementSignerName,
    idVerified: !!client.idVerifiedAt,
    idVerifiedAt: client.idVerifiedAt,
    coiVerified: !!client.coiVerifiedAt,
    coiVerifiedAt: client.coiVerifiedAt,
    skipIdRequirement: client.skipIdRequirement,
    skipCoiRequirement: client.skipCoiRequirement,
  });
}

// ---------------------------------------------------------------------------
// Asking for documents
// ---------------------------------------------------------------------------

/**
 * Mint a 30-day link and send it.
 *
 * **It always returns the URL, whether or not the email left the building.**
 * `sendEmail` does not throw — it returns `{ success: false }` — and outbound
 * mail is switched off in this instance, so an action that only reported
 * "sent" would leave somebody watching an inbox that will never receive
 * anything. The same token is minted by `applyOnboardingToLead` on the
 * onboarding path, and both hand the link back for exactly this reason.
 *
 * The link is minted before the send and kept even if the send fails: a token
 * row nobody used costs nothing, and the alternative — rolling it back on a
 * failed send — would destroy the only copy of a link that can still be pasted
 * into a thread by hand.
 */
export async function sendRequirementsRequest(
  clientId: string,
  requirementTypes: RequirementKind[],
  recipientEmail?: string,
  message?: string,
): Promise<RequirementsOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const types = (["ID", "COI", "AGREEMENT"] as RequirementKind[]).filter((kind) =>
    requirementTypes.includes(kind),
  );
  if (types.length === 0) {
    return { status: "error", message: "Pick at least one thing to ask for." };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, email: true },
  });
  if (!client) return { status: "error", message: "That account no longer exists." };

  const email = (recipientEmail || client.email || "").trim();
  if (!email) {
    return {
      status: "error",
      message:
        "No address to send it to — put one on the account, or type one here.",
    };
  }

  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await prisma.clientRequirementToken.create({
    data: { token, clientId, requirementTypes: types, expiresAt },
  });

  const uploadUrl = `${APP_URL}/requirements/${token}`;

  const content = clientRequirementsRequestEmail({
    clientName: client.name,
    requirementTypes: types,
    uploadUrl,
    message,
  });

  const sent = await sendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
  });

  await logAudit({
    action: "CREATE",
    entityType: "Client",
    entityId: clientId,
    newValues: {
      requirementsRequested: types,
      sentTo: email,
      mailed: sent.success,
    },
    userId: auth.userId,
  });

  revalidatePath(`/dashboard/clients/${clientId}`);

  return {
    status: "ok",
    url: uploadUrl,
    message: sent.success
      ? `Sent to ${email}. The link works for 30 days.`
      : isEmailConfigured()
        ? `The email would not send, so nothing reached ${email}. The link below works for 30 days — send it by hand.`
        : "Outbound mail is switched off in this instance, so nothing was sent. The link below works for 30 days — send it by hand.",
  };
}

// ---------------------------------------------------------------------------
// Waiving
// ---------------------------------------------------------------------------

const WAIVABLE = { ID: "skipIdRequirement", COI: "skipCoiRequirement" } as const;

const WAIVE_LABEL = { ID: "photo ID", COI: "the certificate of insurance" } as const;

/**
 * Decide an account does not have to produce an ID or a COI.
 *
 * Admin only and audited, because it is the one control here that makes a
 * requirement go away rather than satisfying it — and because the reason
 * somebody waived is the thing anybody asks about afterwards. The reason is
 * required for that reason, and lands in the audit log rather than in a note
 * field nobody reads.
 *
 * The signed agreement is deliberately **not** waivable. `skipIdRequirement`
 * and `skipCoiRequirement` exist as columns; there is no equivalent for the
 * agreement, and there should not be — the ID and the COI are checks on the
 * customer, while the agreement is the contract the rental happens under.
 */
export async function waiveRequirement(
  clientId: string,
  kind: "ID" | "COI",
  waived: boolean,
  reason: string,
): Promise<RequirementsOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return {
      status: "error",
      message:
        auth.error === "Unauthorized"
          ? "Unauthorized"
          : "Waiving a requirement is an admin decision.",
    };
  }

  const why = reason.trim();
  if (!why) {
    return {
      status: "error",
      message: "Say why. A waiver with no reason is unanswerable later.",
    };
  }

  const column = WAIVABLE[kind];
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, skipIdRequirement: true, skipCoiRequirement: true },
  });
  if (!client) return { status: "error", message: "That account no longer exists." };

  await prisma.client.update({
    where: { id: clientId },
    data: { [column]: waived },
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Client",
    entityId: clientId,
    oldValues: { [column]: client[column] },
    newValues: { [column]: waived, reason: why },
    userId: auth.userId,
  });

  revalidatePath(`/dashboard/clients/${clientId}`);

  return {
    status: "ok",
    message: waived
      ? `${client.name} no longer has to produce ${WAIVE_LABEL[kind]}. The reason is on the audit log.`
      : `${client.name} is asked for ${WAIVE_LABEL[kind]} again.`,
  };
}
