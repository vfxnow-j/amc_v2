import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { findUnitByCode } from "@/lib/queries/operate";

/**
 * What is this thing?
 *
 * A GET route handler rather than a Server Function, for two reasons that both
 * matter on a scan surface. Next dispatches Server Functions one at a time, so
 * a read would queue behind whatever write is in flight; and a fetch can be
 * aborted, so an operator scanning faster than the network gets last-scan-wins
 * instead of a backlog of stale cards resolving in order.
 *
 * `/api/scan` is in neither PUBLIC_PREFIXES nor KEYED_PREFIXES in proxy.ts, so
 * the proxy already requires a session and an unauthenticated request is
 * redirected rather than answered. requireAuth here is the second gate, because
 * the proxy is explicitly not the auth boundary in this app.
 *
 * Read-only: it resolves a code and reports. Nothing about a lookup writes.
 */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return NextResponse.json({ error: "No code given." }, { status: 400 });
  }

  const unit = await findUnitByCode(code);
  if (!unit) {
    return NextResponse.json({ unit: null }, { headers: NO_STORE });
  }

  return NextResponse.json({ unit }, { headers: NO_STORE });
}

// A unit's whereabouts change while somebody is looking at them, and this
// answers about hardware in a person's hands. Never serve it from a cache.
const NO_STORE = { "Cache-Control": "private, no-store" };
