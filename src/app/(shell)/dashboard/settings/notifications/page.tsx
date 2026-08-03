import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { getNotificationRecipients } from "@/lib/actions/notifications";
import { isEmailConfigured } from "@/lib/email/client";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { getSessionUser } from "@/lib/roles";
import { PreferencesForm } from "./preferences-form";

export const metadata = { title: "Notification preferences" };

/**
 * Settings → Notifications.
 *
 * Preferences belong here rather than on the feed for the same reason the theme
 * switch isn't on the Overview: what you want to be told is account
 * configuration, not part of the task you opened the feed to do. It is also
 * where v1 kept its notification settings and where the build plan's Stage 8
 * lists `notifications` among the fourteen settings children, so nobody has to
 * learn a new place.
 *
 * Two cards, and they answer two different questions. The first is "what
 * reaches me", which is per-user and editable by whoever is signed in. The
 * second is "who else is on the digest", which is the `notification_recipients`
 * setting ported from v1 — a global list of addresses, some of which are
 * distribution lists rather than users. It is shown read-only because its
 * editor is a Stage 8 settings deliverable, and because a per-user screen
 * silently rewriting a company-wide list would be a nasty surprise.
 */
export default async function NotificationSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Notifications"
        blurb={
          <>
            What reaches {user.email}, and by which route. These switches apply
            to this account only.
          </>
        }
        actions={
          <Link
            href="/dashboard/notifications"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
          >
            Open the feed
          </Link>
        }
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[2fr_1fr]">
        <Suspense fallback={<CardSkeleton title="What reaches you" rows={6} />}>
          <YourPreferences userId={user.id} />
        </Suspense>

        <Suspense fallback={<CardSkeleton title="Digest recipients" rows={3} />}>
          <DigestRecipients />
        </Suspense>
      </div>
    </>
  );
}

async function YourPreferences({ userId }: { userId: string }) {
  const preferences = await getNotificationPreferences(userId);

  return (
    <Card
      title="What reaches you"
      meta="in app, and in the daily digest"
      className="pb-1"
    >
      <PreferencesForm
        initial={preferences}
        emailConfigured={isEmailConfigured()}
      />
    </Card>
  );
}

/**
 * The addresses v1's notification settings put on the digest, unchanged.
 *
 * Kept visible because the daily digest genuinely sends to these as well as to
 * opted-in users — leaving it off this screen would mean the only way to find
 * out who receives the mail is to read the cron handler.
 */
async function DigestRecipients() {
  const recipients = await getNotificationRecipients();
  const onDigest = recipients.filter((recipient) => recipient.insights);

  return (
    <Card
      title="Digest recipients"
      meta={
        recipients.length === 0
          ? undefined
          : `${onDigest.length} of ${recipients.length} on the digest`
      }
    >
      {recipients.length === 0 ? (
        <CardEmpty>
          No addresses are configured, so the daily digest currently goes only to
          users who have switched it on for themselves. The company-wide list is
          edited in v1&rsquo;s notification settings; its editor is part of the
          Settings stage here.
        </CardEmpty>
      ) : (
        <>
          <ul className="flex flex-col gap-px px-2 pb-2">
            {recipients.map((recipient) => (
              <li
                key={recipient.email}
                className="grid grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
              >
                <span className="truncate">{recipient.email}</span>
                <span
                  className={
                    recipient.insights ? "text-ink-muted" : "text-ink-faint"
                  }
                >
                  {recipient.insights ? "Digest" : "Other categories"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
            A company-wide list carried over from v1, some of it distribution
            addresses rather than people. Read-only here — its editor belongs
            with the rest of Settings.
          </p>
        </>
      )}
    </Card>
  );
}
