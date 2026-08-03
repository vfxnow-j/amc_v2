import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { handleCallback } from "@/lib/quickbooks/qb-client";

/**
 * GET /api/quickbooks/callback — where Intuit sends the browser back.
 *
 * Exchanges the authorisation code for tokens and stores them against the
 * realm. Every exit from here is a redirect to the QuickBooks settings screen
 * carrying a reason, because this route has no UI of its own and a bare 400
 * would leave somebody staring at JSON after authorising in another window.
 *
 * The state check is a constant-time compare, but only after the lengths match:
 * `crypto.timingSafeEqual` throws on unequal lengths, so a short or absent
 * `state` parameter would have turned a CSRF check into a 500 in the v1
 * handler this is carried from.
 */
export async function GET(request: NextRequest) {
  const settings = new URL("/dashboard/settings/quickbooks", request.nextUrl);

  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "ADMIN" && role !== "SUPER_ADMIN")) {
    // Not a redirect to /login: the handshake cannot be resumed after a
    // sign-in, so send them somewhere that can explain and offer to start again.
    settings.searchParams.set("error", "unauthorized");
    return NextResponse.redirect(settings);
  }

  const params = request.nextUrl.searchParams;
  const denied = params.get("error");
  if (denied) {
    settings.searchParams.set("error", denied);
    return NextResponse.redirect(settings);
  }

  const state = params.get("state");
  const stored = request.cookies.get("qb_oauth_state")?.value;
  if (
    !state ||
    !stored ||
    state.length !== stored.length ||
    !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(stored))
  ) {
    settings.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(settings);
  }

  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || !realmId) {
    settings.searchParams.set("error", "missing_params");
    return NextResponse.redirect(settings);
  }

  try {
    await handleCallback(code, realmId);
  } catch (cause) {
    // The exchange body can quote the client secret back in its error text, so
    // it is logged and never forwarded to the screen.
    console.error("QuickBooks callback failed:", cause);
    settings.searchParams.set("error", "exchange_failed");
    return NextResponse.redirect(settings);
  }

  settings.searchParams.set("connected", "1");
  const response = NextResponse.redirect(settings);
  // Cleared with the path it was set on — a bare delete() targets "/" and
  // would leave the real cookie in place until it expired on its own.
  response.cookies.set("qb_oauth_state", "", {
    path: "/api/quickbooks",
    maxAge: 0,
  });
  return response;
}
