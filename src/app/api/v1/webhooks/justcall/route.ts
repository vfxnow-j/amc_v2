import { NextResponse, type NextRequest } from "next/server";
import { processCallEvent, verifyJustCallRequest } from "@/lib/integrations/justcall";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * POST /api/v1/webhooks/justcall — somebody rang, or was rung.
 *
 * The half of the phone integration that was missing: `processCallEvent` has
 * been in the tree since the port, matching the caller against existing leads
 * and opening a `source: JUSTCALL` lead when no match exists, and nothing in
 * v2 could reach it. This is the door.
 *
 * Built to the same conventions as the Zapier and HubSpot routes — secret in a
 * header, never a query string; the body never logged, because a call event
 * carries a phone number and a caller's name; the rate limit ahead of the
 * first database read; a failed side effect answered with 200 and a reason
 * rather than a 500 that has the sender redelivering the same call forever.
 *
 * **Only call events are acted on.** JustCall pushes SMS through the same
 * webhook configuration, and `processCallEvent` would file a text message as a
 * call — wrong on the lead's timeline, and worse, an "Inbound call" that never
 * happened is the kind of record somebody rings a client about. Anything that
 * is not a call is acknowledged and ignored, and says so.
 *
 * Note what a delivery here can do: create a lead. That is the intended
 * behaviour — a number nobody recognises calling in is exactly the lead most
 * often lost — but it is why this route is signature-checked rather than
 * merely obscure, and why an unconfigured instance refuses everything. There is
 * no `justcall_webhook_secret` row here today, so the route is inert.
 */

type CallPayload = {
  contact_name?: string;
  contact_number?: string;
  duration?: number;
  recording_url?: string;
  direction?: string;
  status?: string;
};

/** True for call events, false for SMS and anything else JustCall adds later. */
function isCallEvent(type: unknown): boolean {
  return typeof type === "string" && /call/i.test(type) && !/sms|message/i.test(type);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * JustCall's payloads are not one shape.
 *
 * Different event types put the call under `data`, under `call_info`, or at
 * the top level, and the number is variously `contact_number`, `from` or
 * `to`. Normalising here rather than in `processCallEvent` keeps the shape
 * JustCall happens to send this year out of the part of the codebase that
 * knows what a lead is.
 */
function normalise(event: Record<string, unknown>): CallPayload {
  const nested = (event.data ?? event.call_info ?? event.call ?? event) as Record<string, unknown>;
  const direction = firstString(nested.direction, nested.call_direction, event.direction as string);

  return {
    contact_name: firstString(nested.contact_name, nested.contact, nested.friendly_name),
    contact_number: firstString(
      nested.contact_number,
      nested.contact_phone,
      // On an inbound call the contact is the caller; on an outbound one it is
      // whoever was dialled. Getting this backwards files the office's own
      // number as a lead.
      direction?.toLowerCase() === "outbound" ? (nested.to as string) : (nested.from as string),
      nested.number,
    ),
    duration:
      typeof nested.duration === "number"
        ? nested.duration
        : Number.isFinite(Number(nested.duration))
          ? Number(nested.duration)
          : undefined,
    recording_url: firstString(nested.recording_url, nested.recording),
    direction: direction?.toLowerCase(),
    status: firstString(nested.status, nested.call_status, nested.disposition),
  };
}

export async function POST(request: NextRequest) {
  const caller =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const limit = checkRateLimit("justcall-webhook", caller, 240, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many deliveries. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  // Raw text: a signature is over the exact bytes, not over a re-encoding.
  const payload = await request.text();

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  const verdict = await verifyJustCallRequest({
    body: payload,
    signature:
      request.headers.get("x-justcall-signature") ??
      request.headers.get("x-signature") ??
      null,
    sharedSecret: request.headers.get("x-webhook-secret") ?? bearer ?? null,
  });

  if (!verdict.ok) {
    console.warn(`[webhooks/justcall] refused a delivery (${verdict.reason})`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const event = parsed as Record<string, unknown>;
  const type = firstString(event.type, event.event, event.event_type) ?? "";

  if (!isCallEvent(type)) {
    return NextResponse.json(
      { success: true, handled: false, reason: `"${type || "untyped"}" is not a call event` },
      { status: 200 },
    );
  }

  const data = normalise(event);
  if (!data.contact_number) {
    // Acknowledged, because redelivering it will not produce a number.
    return NextResponse.json(
      { success: true, handled: false, reason: "The event carried no contact number" },
      { status: 200 },
    );
  }

  try {
    const lead = await processCallEvent({ type, data });
    return NextResponse.json(
      {
        success: true,
        handled: true,
        // The id, never the number or the name — this response is echoed into
        // a delivery log that is not access-controlled the way the app is.
        leadId: lead?.id ?? null,
        direction: data.direction ?? null,
      },
      { status: 200 },
    );
  } catch (cause) {
    console.error(
      "[webhooks/justcall] could not record the call:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return NextResponse.json(
      {
        success: true,
        handled: false,
        reason: "The call could not be recorded against a lead",
      },
      { status: 200 },
    );
  }
}
