import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { generateOAuthState, getOAuthUri } from "@/lib/quickbooks/qb-client";
import { quickbooksConfig } from "@/lib/quickbooks/config";

/**
 * GET /api/quickbooks/connect — start the Intuit OAuth handshake.
 *
 * A redirect rather than a server action, because the whole point is to leave
 * the app: the person authorises inside Intuit's own UI and comes back to
 * /callback. Nothing here writes.
 *
 * Two differences from the v1 handler this is carried from.
 *
 * It admits SUPER_ADMIN. v1 tested `role !== 'ADMIN'`, which locked out the one
 * role that outranks it — the account most likely to be doing the connecting
 * could not. Both routes here use the same rule as `requireAdmin`.
 *
 * And it refuses when the credentials are blank instead of redirecting anyway.
 * `qb-client` substitutes empty strings for missing environment variables, so
 * an unconfigured instance produces a valid-looking authorise URL that Intuit
 * rejects on its own error page — after the browser has left, where nothing on
 * our side can explain what happened. v2 ships with those variables blank, so
 * that is the default state, not an edge case.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "ADMIN" && role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = quickbooksConfig();
  if (!config.configured) {
    const url = new URL("/dashboard/settings/quickbooks", request.nextUrl);
    url.searchParams.set("error", "not_configured");
    return NextResponse.redirect(url);
  }

  const state = generateOAuthState();
  const response = NextResponse.redirect(getOAuthUri(state));

  // The callback compares this against what Intuit hands back, which is what
  // stops a third party from completing somebody else's handshake. HttpOnly so
  // no script can read it, five minutes because a handshake that takes longer
  // than that has been abandoned.
  response.cookies.set("qb_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 300,
    path: "/api/quickbooks",
  });

  return response;
}
