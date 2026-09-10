import { NextResponse, type NextRequest } from "next/server";
import { processWebhookEvent, verifyHubSpotRequest } from "@/lib/integrations/hubspot";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { APP_URL } from "@/lib/email/client";

/**
 * POST /api/v1/webhooks/hubspot — contact changes, pushed from HubSpot.
 *
 * Ported from v1 to the conventions the Zapier route set: the body is never
 * logged, the rate limit sits ahead of the first database read, and a side
 * effect that fails returns 200 with a reason rather than a 500 that has the
 * sender retrying a request it has already delivered.
 *
 * What arrives is a batch — HubSpot sends up to a hundred events in one POST —
 * of subscription notifications carrying an object id and nothing else. The
 * contact itself is then **pulled** by `syncContactFromHubSpot`, which needs
 * `hubspot_access_token`. So an instance with a webhook secret and no access
 * token verifies the request, accepts it, and can do nothing with it. That is
 * reported per event rather than hidden: `{ processed, failed[] }` tells
 * whoever set it up which half of the configuration is missing, without a
 * retry storm while they find out.
 *
 * **Nothing here is configured in this instance.** There is no
 * `hubspot_webhook_secret` row and no `hubspot_access_token` row, so every
 * request is refused at the signature check. It is built now so that turning
 * HubSpot on is a settings change rather than a deploy.
 *
 * One direction only, deliberately. This route pulls contacts *in*. Pushing
 * them back *out* is `syncContactToHubSpot`, gated separately on
 * `hubspot_enabled`, and it is not called from here: a contact that arrived
 * from HubSpot must never be written back to HubSpot, or one edit there
 * becomes a loop between the two systems.
 */

/** HubSpot batches at 100. Twice that is generous and still bounded. */
const MAX_EVENTS = 200;

type HubSpotEvent = {
  subscriptionType?: string;
  objectId?: number;
  propertyName?: string;
  propertyValue?: string;
};

/**
 * Every URL this request could have arrived as.
 *
 * HubSpot signs the URL it called. Behind a proxy that is not the URL this
 * process sees, so the public one is reconstructed from the forwarded headers
 * and from `APP_URL`, and the raw one is kept as the last candidate for the
 * case where there is no proxy at all.
 */
function candidateUrls(request: NextRequest): string[] {
  const raw = new URL(request.url);
  const suffix = raw.pathname + raw.search;

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.trim();

  const candidates = new Set<string>();
  if (host) candidates.add(`${proto || "https"}://${host}${suffix}`);
  if (APP_URL) candidates.add(`${APP_URL.replace(/\/$/, "")}${suffix}`);
  candidates.add(request.url);

  return [...candidates];
}

export async function POST(request: NextRequest) {
  const caller =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Ahead of the signature check, which reads settings from the database.
  const limit = checkRateLimit("hubspot-webhook", caller, 240, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many deliveries. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  // Raw text, because every one of HubSpot's schemes signs the exact bytes.
  const payload = await request.text();

  const verdict = await verifyHubSpotRequest({
    method: "POST",
    urls: candidateUrls(request),
    body: payload,
    headers: {
      v3: request.headers.get("x-hubspot-signature-v3"),
      v2OrV1: request.headers.get("x-hubspot-signature"),
      version: request.headers.get("x-hubspot-signature-version"),
      timestamp: request.headers.get("x-hubspot-request-timestamp"),
    },
  });

  if (!verdict.ok) {
    // Logged as a count, not a payload, and the caller is told nothing about
    // which of the four ways this failed.
    console.warn(`[webhooks/hubspot] refused a delivery (${verdict.reason})`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const all: HubSpotEvent[] = Array.isArray(parsed)
    ? (parsed as HubSpotEvent[])
    : [parsed as HubSpotEvent];
  const events = all.slice(0, MAX_EVENTS);
  const skipped = all.length - events.length;

  let processed = 0;
  const failed: { objectId: number | null; reason: string }[] = [];

  for (const event of events) {
    if (typeof event?.subscriptionType !== "string" || typeof event.objectId !== "number") {
      failed.push({ objectId: null, reason: "Event carried no subscriptionType and objectId" });
      continue;
    }

    try {
      await processWebhookEvent({
        subscriptionType: event.subscriptionType,
        objectId: event.objectId,
        propertyName: event.propertyName,
        propertyValue: event.propertyValue,
      });
      processed += 1;
    } catch (cause) {
      // One contact that cannot be pulled must not cost the other 99 in the
      // batch, and it must not cost HubSpot a retry of the whole delivery.
      failed.push({
        objectId: event.objectId,
        reason: cause instanceof Error ? cause.message : "Could not process the event",
      });
    }
  }

  if (failed.length > 0) {
    console.warn(
      `[webhooks/hubspot] ${failed.length} of ${events.length} events could not be processed`,
    );
  }

  return NextResponse.json(
    {
      success: true,
      scheme: verdict.scheme,
      received: all.length,
      processed,
      failed,
      ...(skipped > 0 ? { skipped } : {}),
    },
    { status: 200 },
  );
}
