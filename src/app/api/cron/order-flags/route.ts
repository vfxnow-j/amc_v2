import { NextResponse, type NextRequest } from "next/server";
import { runFlagSweep } from "@/lib/flags/digest";

/**
 * The nightly order-flag pass: raise and clear the automatic flags (overdue
 * return, unpaid invoice, unit missing a serial), then email the reservations
 * recipients what was newly raised.
 *
 *   curl -s -X POST http://localhost:3001/api/cron/order-flags \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Fails closed on `CRON_SECRET`, like the other cron endpoints: `proxy.ts`
 * exempts `/api/cron` from the session gate, so the secret is the only door.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const result = await runFlagSweep(now);
  return NextResponse.json({ ok: true, at: now.toISOString(), ...result });
}
