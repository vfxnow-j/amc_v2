import { NextResponse, type NextRequest } from "next/server";
import { notifyDailyDigest } from "@/lib/actions/notifications";
import {
  emailConfigured,
  sendNotificationDigests,
} from "@/lib/notifications/digest-email";
import { raiseNotifications } from "@/lib/notifications/raise";

/**
 * The daily sweep. Scheduled Mon–Sat at 9:00 AM PT; Sunday is the weekly report.
 *
 *   curl -X POST http://localhost:3001/api/cron/daily-digest \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Three steps, in this order, because each one depends on the last:
 *
 * 1. **Raise.** Ask the database the five questions `NotificationType` names and
 *    write what is new. Nothing else in v2 writes to `Notification`, so without
 *    this the bell reads zero forever — see `lib/notifications/raise.ts`.
 * 2. **Day at a glance.** v1's `notifyDailyDigest`, carried over untouched. It
 *    goes to the addresses in the `notification_recipients` setting, which can
 *    be distribution lists rather than users, and it is about the business
 *    rather than about a person.
 * 3. **Notification digests.** One personal email per opted-in user, listing
 *    what step 1 just left in their feed. Sent after the raise so today's items
 *    are in today's mail rather than tomorrow's.
 *
 * v1's handler took no authorization "for legacy reasons", which its own
 * traffic-report sibling calls out as the thing new endpoints should not copy.
 * v2 is a new deployment with no legacy callers, so this fails closed on
 * `CRON_SECRET` like the rest of `/api/cron/*`. `proxy.ts` already exempts the
 * prefix from the session gate, so the secret is the only door.
 *
 * A step that fails does not stop the ones after it: raising is the valuable
 * half and email is the half that is switched off in this instance, and a dead
 * mailer must never mean nobody's feed gets filled.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raised = await raiseNotifications().catch((error) => {
    console.error("Raising notifications failed:", error);
    return null;
  });

  const glance = await notifyDailyDigest().catch((error) => {
    console.error("Day-at-a-glance digest failed:", error);
    return null;
  });

  const digests = await sendNotificationDigests().catch((error) => {
    console.error("Notification digests failed:", error);
    return null;
  });

  return NextResponse.json({
    ok: raised !== null,
    raised,
    dayAtAGlance: glance,
    notificationDigests: digests,
    // Stated rather than inferred: with no Resend key every send count above is
    // zero for a reason that has nothing to do with the data.
    emailConfigured: emailConfigured(),
  });
}
