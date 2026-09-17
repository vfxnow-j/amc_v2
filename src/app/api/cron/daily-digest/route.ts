import { NextResponse, type NextRequest } from "next/server";
import { emailState, runDailySweep } from "@/lib/notifications/reports/run";

/**
 * The daily sweep on demand: raise the day's in-app notifications, then send
 * each opted-in person their digest.
 *
 *   curl -X POST http://localhost:3001/api/cron/daily-digest \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Kept for anyone who calls it, but it is no longer what schedules anything:
 * `/api/cron/reports`, polled hourly, runs this sweep once a day at 9:00 PT
 * and sends the day-at-a-glance email on the schedule set in Settings →
 * Notifications. This route used to send the day at a glance too; it doesn't
 * now, so calling both can't mail that list twice.
 *
 * Fails closed on `CRON_SECRET`, like the rest of `/api/cron/*`.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sweep = await runDailySweep(new Date(), true);
  return NextResponse.json({ ok: sweep.ran && sweep.raised !== null, sweep, email: emailState() });
}
