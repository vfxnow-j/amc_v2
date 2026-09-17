import { NextResponse, type NextRequest } from "next/server";
import { REPORT_KEYS, isReportKey, type ReportKey } from "@/lib/notifications/reports/registry";
import { emailState, runDailySweep, runDueReports, runReportNow } from "@/lib/notifications/reports/run";

/**
 * The hourly job: the daily sweep and every scheduled report that is due.
 *
 *   curl -s -X POST http://localhost:3001/api/cron/reports \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Poll it every hour, on the hour. What is due is decided here, from the
 * schedules in Settings → Notifications (Pacific time), and each occurrence is
 * claimed before it is sent, so a report goes at most once per occurrence
 * however often this is called. See `lib/notifications/reports/run.ts`.
 *
 * `?force=inventory,depreciation` (or `?force=all`) sends those reports now
 * regardless of schedule — recorded as a manual send, and not touching the
 * scheduled occurrence. `?force=sweep` runs the in-app sweep and personal
 * digests now. Forcing never skips the recipient list or the test redirect.
 *
 * Fails closed on `CRON_SECRET`: no secret configured means nobody gets in.
 * `proxy.ts` exempts `/api/cron` from the session gate, so the secret is the
 * only door.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force");
  const email = emailState();

  if (force) {
    const names = force === "all" ? [...REPORT_KEYS] : force.split(",").map((name) => name.trim()).filter(Boolean);
    const unknown = names.filter((name) => name !== "sweep" && !isReportKey(name));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown report: ${unknown.join(", ")}`, reports: REPORT_KEYS }, { status: 400 });
    }
    const sweep = names.includes("sweep") ? await runDailySweep(new Date(), true) : null;
    const forced: Partial<Record<ReportKey, unknown>> = {};
    for (const key of names.filter(isReportKey)) {
      forced[key] = await runReportNow(key, "cron force");
    }
    return NextResponse.json({ ok: true, forced, sweep, email });
  }

  const now = new Date();
  const sweep = await runDailySweep(now).catch((error) => {
    console.error("Daily sweep failed:", error);
    return null;
  });
  const reports = await runDueReports(now);
  return NextResponse.json({ ok: true, at: now.toISOString(), sweep, reports, email });
}
