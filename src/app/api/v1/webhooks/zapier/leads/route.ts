import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { processLeadWebhook, verifyWebhookSecret } from "@/lib/integrations/zapier";
import { applyOnboardingToLead } from "@/lib/leads/onboarding";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * POST /api/v1/webhooks/zapier/leads — a form submission from Zapier.
 *
 * Ported from v1, which had been taking real HubSpot traffic for a year, with
 * three deliberate differences:
 *
 *  1. **The secret comes from a header.** v1 read `?secret=` first. A static
 *     secret in a query string is written to every access log, proxy log and
 *     browser history it passes through, and it never rotates on its own. The
 *     query parameter is still accepted, because the Zaps that exist are
 *     configured that way and silently 401ing them would be a worse failure —
 *     but it warns, so the day somebody reads the logs there is a breadcrumb.
 *  2. **The body is never logged.** v1 logged the whole payload at info level:
 *     names, addresses, phone numbers, whatever the form asked for. What is
 *     logged here is the shape of the request and nothing a person said.
 *  3. **Onboarding forms do more than move a status.** `FORM_STATUS_MAP`
 *     already sends `onboarding`/`onboard` to QUALIFIED, which records that a
 *     form arrived and does nothing about it. Those submissions now run
 *     `applyOnboardingToLead` as well: the client is enriched, `prospectAt`
 *     cleared, the requirements token minted and the held quote flagged.
 *
 * `processLeadWebhook` hard-requires a name and 400s without one. A real
 * submission with a company and an address but no name in it is not an error
 * worth rejecting, so a name is synthesised here — from the company, then from
 * the local part of the address — and the record says where it came from.
 *
 * **This is built and left unconfigured.** No `zapier_webhook_secret` row
 * exists in this instance, and `verifyWebhookSecret` refuses everything while
 * that is true, so the route is inert until somebody generates a secret in
 * Settings → Integrations. That is deliberate: the code should not be written
 * in a hurry on the day the Zap is turned on.
 *
 * Note `proxy.ts` excludes `api/v1/webhooks` from its matcher. A matched route
 * has its body buffered at 10 MB and **truncated silently** past that, which
 * would hand this handler half a JSON document and no way to know.
 */

/** A form whose arrival means "they have onboarded", not just "they replied". */
function isOnboardingForm(formName: unknown): boolean {
  return typeof formName === "string" && /onboard/i.test(formName);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** A name good enough to file under, when the form did not carry one. */
function synthesiseName(body: Record<string, unknown>): string | undefined {
  const company = firstString(body.companyName, body.company);
  if (company) return company;

  const email = firstString(body.email);
  const local = email?.split("@")[0];
  if (!local) return undefined;

  return (
    local
      .split(/[._+-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || local
  );
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return (await request.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  if (contentType.includes("form")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }

  // Zapier's "custom request" step sends no content type at all. Try JSON,
  // then treat it as a query string, which is what it turns out to be.
  const raw = await request.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const params = Object.fromEntries(new URLSearchParams(raw).entries());
    return Object.keys(params).length > 0 ? params : null;
  }
}

export async function POST(request: NextRequest) {
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Ahead of the secret check, which is a database read: an unauthenticated
  // flood should cost one map lookup, not a query each.
  const limit = checkRateLimit("zapier-leads", client, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many submissions. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const fromHeader = request.headers.get("x-webhook-secret")?.trim() || bearer;
  const fromQuery = new URL(request.url).searchParams.get("secret")?.trim() ?? "";

  if (!(await verifyWebhookSecret(fromHeader || fromQuery))) {
    // No detail: whether the secret was absent, wrong or simply never
    // configured is not something an unauthenticated caller gets told.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!fromHeader && fromQuery) {
    console.warn(
      "[zapier/leads] secret arrived in the query string; move it to the x-webhook-secret header",
    );
  }

  const body = await readBody(request);
  if (!body) {
    return NextResponse.json(
      { error: "Body must be JSON or form-encoded" },
      { status: 400 },
    );
  }

  const given = firstString(
    body.name,
    [body.firstname ?? body.first_name, body.lastname ?? body.last_name]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" "),
  );
  const name = given ?? synthesiseName(body);
  if (!name) {
    return NextResponse.json(
      { error: "Send at least one of: name, company, email" },
      { status: 400 },
    );
  }

  const formName = body.formName ?? body.form_name ?? body.formType ?? body.form_type;
  const onboarding = isOnboardingForm(formName);

  const result = await processLeadWebhook({ ...body, name });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Said on the record rather than left to be guessed at: a lead filed under a
  // company name because the form carried no name in it looks exactly like one
  // somebody introduced themselves on, and the difference matters the first
  // time anybody rings them. Only on a lead this request opened — a merge
  // never touches the name it matched.
  if (!given && "status" in result && result.status === 201) {
    await prisma.leadActivity.create({
      data: {
        leadId: result.leadId,
        type: "SYSTEM",
        title: "Name inferred",
        description: `The submission carried no name, so this was filed under "${name}", taken from the ${
          firstString(body.companyName, body.company) ? "company on the form" : "email address"
        }.`,
        metadata: { source: "zapier-webhook", inferredName: true },
      },
    });
  }

  if (!onboarding) {
    return NextResponse.json(result, {
      status: "status" in result ? (result.status ?? 200) : 200,
    });
  }

  const applied = await applyOnboardingToLead(
    result.leadId,
    {
      name: given,
      companyName: firstString(body.companyName, body.company),
      email: firstString(body.email),
      phone: firstString(body.phone),
      address: firstString(body.address, body.address1, body.street, body.streetAddress),
      billingAddress: firstString(body.billingAddress, body.billing_address),
      notes: firstString(body.notes, body.message),
    },
    { via: "webhook" },
  );

  if ("error" in applied) {
    // The lead landed; only the onboarding half failed. A 200 with the reason
    // beats a 500 that has Zapier retrying a submission already recorded.
    return NextResponse.json(
      { success: true, leadId: result.leadId, onboarding: { applied: false, reason: applied.error } },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      leadId: applied.leadId,
      clientId: applied.clientId,
      onboarding: {
        applied: true,
        clientCreated: applied.clientCreated,
        clearedProspect: applied.wasProspect,
        // Field names, never values — this response goes back into a Zap
        // history that is not access-controlled the way the app is.
        filled: applied.filled,
        keptTyped: applied.keptTyped,
        flaggedOrder: applied.order?.flagged ?? false,
      },
    },
    { status: 200 },
  );
}
