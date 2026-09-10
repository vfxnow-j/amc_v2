import { prisma } from "@/lib/prisma";
import { readTemplateMeta } from "@/lib/requirements/store";

/**
 * What a requirements link is, and what it still wants.
 *
 * Split from `store.ts` because the two answer different questions: the store
 * writes files, this decides whether a stranger holding a URL is allowed to and
 * what is left to do. The page, both route handlers and the token-gated actions
 * all resolve through here, so there is exactly one reading of "expired" and
 * one reading of "outstanding" in the app.
 *
 * A token is a `randomUUID`, looked up whole. There is no enumeration to slow
 * down and no secret to compare byte by byte — the same reading `quote-tokens`
 * already takes for the client-facing quote link.
 */

export type RequirementKind = "ID" | "COI" | "AGREEMENT";

const KINDS: RequirementKind[] = ["ID", "COI", "AGREEMENT"];

/** Only what the token asked for, and only kinds this app knows about. */
function askedKinds(stored: string[]): RequirementKind[] {
  return KINDS.filter((kind) => stored.includes(kind));
}

export type TokenRefusal = {
  ok: false;
  /** `unknown` covers a typo, a revoked link and a guess. All read the same. */
  reason: "unknown" | "expired";
  message: string;
};

export type TokenGrant = {
  ok: true;
  tokenId: string;
  clientId: string;
  asked: RequirementKind[];
  expiresAt: Date;
};

/**
 * The gate. Every public entry point calls this first and does nothing at all
 * until it comes back `ok`.
 *
 * An unknown token and an expired one are told apart deliberately: expiry is
 * something the holder can act on ("ask us for a new one"), while an unknown
 * token is either a typo or a probe, and both get the same flat answer.
 */
export async function resolveRequirementToken(
  token: string,
): Promise<TokenGrant | TokenRefusal> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return { ok: false, reason: "unknown", message: "Invalid or expired link" };
  }

  const record = await prisma.clientRequirementToken.findUnique({
    where: { token: trimmed },
    select: {
      id: true,
      clientId: true,
      requirementTypes: true,
      expiresAt: true,
    },
  });

  if (!record) {
    return { ok: false, reason: "unknown", message: "Invalid or expired link" };
  }

  if (record.expiresAt < new Date()) {
    return {
      ok: false,
      reason: "expired",
      message: "This link has expired. Please contact us for a new one.",
    };
  }

  return {
    ok: true,
    tokenId: record.id,
    clientId: record.clientId,
    asked: askedKinds(record.requirementTypes),
    expiresAt: record.expiresAt,
  };
}

export type RequirementRow = {
  kind: RequirementKind;
  /** This link asked for it. A link only ever shows what it asked for. */
  asked: boolean;
  /** On file, or waived — either way there is nothing left to send. */
  settled: boolean;
  /** Settled by a decision here rather than by a document. */
  waived: boolean;
  at: string | null;
};

export type RequirementsPortal = {
  clientName: string;
  companyName: string | null;
  rows: RequirementRow[];
  /** Asked for and not yet settled. Empty means the job is done. */
  outstanding: RequirementKind[];
  /** Which halves of the ID are already in, so the portal asks for the gap. */
  idOnFile: { front: boolean; back: boolean };
  /** Without a template there is nothing to sign, and the page has to say so. */
  hasTemplate: boolean;
  signerName: string | null;
  expiresAt: string;
};

/**
 * Everything the portal renders, resolved on the server.
 *
 * Read whole on each request rather than pushed to the browser and polled: the
 * person on the other end may be on a phone in a car park, and a page that is
 * complete on first paint is the difference between a job done and a tab
 * closed. It is also why the token never reaches client JavaScript as an API
 * key — it is already in the URL, and nothing here needs a second copy of it.
 */
export async function readRequirementsPortal(
  grant: TokenGrant,
): Promise<RequirementsPortal | null> {
  const [client, idDocs, template] = await Promise.all([
    prisma.client.findUnique({
      where: { id: grant.clientId },
      select: {
        name: true,
        companyName: true,
        idVerifiedAt: true,
        coiVerifiedAt: true,
        agreementSignedAt: true,
        agreementSignerName: true,
        skipIdRequirement: true,
        skipCoiRequirement: true,
      },
    }),
    prisma.document.findMany({
      where: {
        entityType: "CLIENT",
        entityId: grant.clientId,
        deletedAt: null,
        metadata: { path: ["documentCategory"], string_starts_with: "ID_" },
      },
      select: { metadata: true },
    }),
    readTemplateMeta(),
  ]);

  if (!client) return null;

  const categories = idDocs.map(
    (doc) =>
      (doc.metadata as { documentCategory?: string } | null)?.documentCategory,
  );

  const rows: RequirementRow[] = [
    {
      kind: "ID",
      asked: grant.asked.includes("ID"),
      settled: !!client.idVerifiedAt || client.skipIdRequirement,
      waived: client.skipIdRequirement && !client.idVerifiedAt,
      at: client.idVerifiedAt?.toISOString() ?? null,
    },
    {
      kind: "COI",
      asked: grant.asked.includes("COI"),
      settled: !!client.coiVerifiedAt || client.skipCoiRequirement,
      waived: client.skipCoiRequirement && !client.coiVerifiedAt,
      at: client.coiVerifiedAt?.toISOString() ?? null,
    },
    {
      kind: "AGREEMENT",
      asked: grant.asked.includes("AGREEMENT"),
      settled: !!client.agreementSignedAt,
      waived: false,
      at: client.agreementSignedAt?.toISOString() ?? null,
    },
  ];

  return {
    clientName: client.name,
    companyName: client.companyName,
    rows,
    outstanding: rows
      .filter((row) => row.asked && !row.settled)
      .map((row) => row.kind),
    idOnFile: {
      front: categories.includes("ID_FRONT"),
      back: categories.includes("ID_BACK"),
    },
    hasTemplate: !!template,
    signerName: client.agreementSignerName,
    expiresAt: grant.expiresAt.toISOString(),
  };
}

/**
 * Stamp the token spent — but only once there is nothing left to send.
 *
 * The obvious place to set `usedAt` is after the first successful upload, and
 * that is wrong: a link asking for an ID, a COI and a signature is three
 * separate acts, often minutes apart and sometimes on two devices. Marking it
 * used on the first would make the record read as answered while two thirds of
 * the ask was still outstanding.
 *
 * Nothing refuses a spent token — `resolveRequirementToken` only checks expiry
 * — so a client who finds one more document after finishing can still send it.
 * `usedAt` is a fact about the ask being met, not a lock.
 */
export async function settleToken(grant: TokenGrant): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: grant.clientId },
    select: {
      idVerifiedAt: true,
      coiVerifiedAt: true,
      agreementSignedAt: true,
      skipIdRequirement: true,
      skipCoiRequirement: true,
    },
  });
  if (!client) return false;

  const met = (kind: RequirementKind) => {
    if (kind === "ID") return !!client.idVerifiedAt || client.skipIdRequirement;
    if (kind === "COI") return !!client.coiVerifiedAt || client.skipCoiRequirement;
    return !!client.agreementSignedAt;
  };

  if (!grant.asked.every(met)) return false;

  await prisma.clientRequirementToken.update({
    where: { id: grant.tokenId },
    data: { usedAt: new Date() },
  });
  return true;
}
