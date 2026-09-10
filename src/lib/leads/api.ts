import { NextResponse, type NextRequest } from "next/server";
import type { LeadActivityType, LeadSource, LeadStatus } from "@/generated/prisma/client";
import { validateApiKey, requireApiEditor, type ApiAuthResult } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * The shared half of `/api/v1/leads*`.
 *
 * A plain module, not an action file, for the reason `lib/leads/onboarding.ts`
 * records: everything here is reachable by an API key rather than a session,
 * and exporting it from a `"use server"` file would publish it to any browser
 * that can guess an action id. Nothing here touches the database — it decides
 * whether a request may proceed and what its arguments mean, and the routes do
 * the work.
 *
 * Three things it fixes about the v1 routes it replaces:
 *
 *  1. **Enums are checked, not cast.** v1 wrote `status as any` straight into
 *     Prisma, so a typo in an integration's payload surfaced as a 500 and the
 *     line "Internal server error" — which is a lie, and unactionable. A bad
 *     value is a 400 that names the values that would have worked.
 *  2. **Every route is rate limited.** An API key is a long-lived credential
 *     living in somebody else's script; a retry loop behind one should cost a
 *     map lookup, not a table scan each time round.
 *  3. **Nothing logs a body.** These payloads carry names, addresses and
 *     phone numbers of real people. What gets logged is the shape of a request
 *     and never a word of what somebody said.
 */

export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROSPECT",
  "BOUND",
  "UNQUALIFIED",
  "WON",
  "LOST",
];

export const LEAD_SOURCES: LeadSource[] = [
  "JUSTCALL",
  "HUBSPOT",
  "WEBSITE",
  "REFERRAL",
  "WALK_IN",
  "PHONE",
  "EMAIL",
  "DIRECT",
  "AD",
  "OTHER",
];

export const LEAD_ACTIVITY_TYPES: LeadActivityType[] = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "STATUS_CHANGE",
  "ASSIGNMENT",
  "SYSTEM",
];

/** Loose on purpose, exactly as `createLeadFromForm` is: a real address that
 *  fails a clever regex is a lead nobody ever calls back. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LeadApiAuth = { ok: true; auth: ApiAuthResult } | { ok: false; response: NextResponse };

/**
 * Key check, role check and rate limit, in the order that costs least.
 *
 * The limit is keyed on the API key rather than the IP: keys are the unit that
 * gets issued, revoked and misconfigured, and two integrations behind one
 * office NAT should not be able to starve each other.
 */
export async function authorizeLeadApi(
  request: NextRequest,
  options: { editor: boolean; namespace: string; maxPerMinute?: number },
): Promise<LeadApiAuth> {
  const auth = await validateApiKey(request);
  if (!auth.authorized) {
    return {
      ok: false,
      response: NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 }),
    };
  }

  const gated = options.editor ? requireApiEditor(auth) : auth;
  if (!gated.authorized) {
    return {
      ok: false,
      response: NextResponse.json({ error: gated.error }, { status: gated.status ?? 403 }),
    };
  }

  const limit = checkRateLimit(
    options.namespace,
    auth.apiKeyId ?? "unknown",
    options.maxPerMinute ?? 120,
    60_000,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Too many requests. Retry in ${limit.retryAfterSeconds}s.` },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      ),
    };
  }

  return { ok: true, auth };
}

/** A JSON body, or null when it was not JSON. Never throws, never logged. */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A trimmed string, or null for anything blank. `undefined` means absent. */
export function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** A positive amount, `null` to clear it, `undefined` when absent. */
export function optionalAmount(
  value: unknown,
  field: string,
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };

  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: `${field} is a positive amount, or null to clear it.` };
  }
  return { ok: true, value: amount };
}

export function validEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email);
}

/** `undefined` when absent, the value when valid, an error when it is not. */
export function optionalEnum<T extends string>(
  value: unknown,
  allowed: T[],
  field: string,
): { ok: true; value: T | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return { ok: true, value: value as T };
  }
  return { ok: false, error: `${field} must be one of: ${allowed.join(", ")}` };
}
