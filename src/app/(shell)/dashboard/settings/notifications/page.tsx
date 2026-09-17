import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { getNotificationRecipients } from "@/lib/actions/notifications";
import { APP_URL, EMAIL_FROM, isEmailConfigured } from "@/lib/email/client";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { readRecipients } from "@/lib/notifications/recipients";
import {
  CATEGORY_META,
  RECIPIENT_CATEGORIES,
  receives,
} from "@/lib/notifications/recipients-schema";
import { REPORTS, REPORT_KEYS } from "@/lib/notifications/reports/registry";
import { readSchedule, readSentState, type RunRecord } from "@/lib/notifications/reports/run";
import { nextRunLabel } from "@/lib/notifications/reports/schedule";
import { getSessionUser } from "@/lib/roles";
import { PreferencesForm } from "./preferences-form";
import { RecipientsEditor } from "./recipients-editor";
import { ReportSchedules, type ReportRow } from "./report-schedules";
import { TestEmailForm } from "./test-email-form";

export const metadata = { title: "Notification preferences" };

/**
 * Settings → Notifications.
 *
 * Two kinds of setting on one screen, told apart by who may change them:
 *
 * - **What reaches you** — per user, editable by whoever is signed in: the feed,
 *   the bell and the personal digest.
 * - **The company's mail** — admins only: the outbound email state and a test
 *   send, the recipient list (`notification_recipients`, the setting v1 keeps,
 *   addresses that may be distribution lists), the scheduled reports and Send
 *   now, and the template gallery. Everyone else sees the recipient list
 *   read-only, because who receives the company's mail is not a secret among
 *   staff and a screen that hid it would leave the cron handler as the only
 *   place to find out.
 *
 * The admin check here is presentation. Every write re-checks in its action.
 */
export default async function NotificationSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const admin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Notifications"
        blurb={
          admin ? (
            <>
              What reaches {user.email}, and — for the company — who receives
              each kind of mail and when the reports go out.
            </>
          ) : (
            <>
              What reaches {user.email}, and by which route. These switches apply
              to this account only.
            </>
          )
        }
        actions={
          <div className="flex gap-2">
            {admin ? (
              <Link
                href="/dashboard/settings/notifications/templates"
                className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
              >
                Email templates
              </Link>
            ) : null}
            <Link
              href="/dashboard/notifications"
              className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
            >
              Open the feed
            </Link>
          </div>
        }
      />

      <div className="grid shrink-0 items-start gap-3 lg:grid-cols-[2fr_1fr]">
        <Suspense fallback={<CardSkeleton title="What reaches you" rows={6} />}>
          <YourPreferences userId={user.id} />
        </Suspense>

        <div className="flex min-w-0 flex-col gap-3">
          {admin ? (
            <OutboundEmail email={user.email} />
          ) : (
            <Suspense fallback={<CardSkeleton title="Company recipients" rows={3} />}>
              <ReadOnlyRecipients />
            </Suspense>
          )}
        </div>
      </div>

      {admin ? (
        <>
          <Suspense fallback={<CardSkeleton title="Recipients" rows={4} />}>
            <Recipients />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Scheduled reports" rows={6} />}>
            <ScheduledReports />
          </Suspense>
        </>
      ) : null}
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
 * Where outbound mail stands on this instance, and a way to see the layout.
 *
 * Admin-only on the screen and in the action. The facts are read from the
 * environment at render, not remembered: whether a key is set, who mail comes
 * from, where links point, and — the one that matters most on a copy of live
 * data — whether the test redirect is catching everything.
 */
function OutboundEmail({ email }: { email: string }) {
  const redirect = process.env.EMAIL_TEST_REDIRECT?.trim() || null;
  const configured = isEmailConfigured();
  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: "Sending", value: configured ? "On — Resend key set" : "Off — no RESEND_API_KEY", warn: !configured },
    { label: "From", value: EMAIL_FROM },
    {
      label: "Test redirect",
      value: redirect ? `Everything goes to ${redirect}` : "Off — mail reaches real recipients",
      warn: !redirect,
    },
    {
      label: "Links point at",
      value: APP_URL,
      warn: APP_URL.includes("localhost"),
    },
  ];

  return (
    <Card title="Outbound email" meta="admins">
      <dl className="flex flex-col gap-px px-2 pb-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[96px_1fr] items-baseline gap-2 rounded-row px-2 py-[5px] text-detail"
          >
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className={`min-w-0 break-words ${row.warn ? "text-destructive" : ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {APP_URL.includes("localhost") ? (
        <p className="mx-4 mb-3 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          APP_URL is localhost, so buttons in emails open only on this machine.
        </p>
      ) : null}
      <TestEmailForm placeholder={email} />
    </Card>
  );
}

/**
 * Who receives the company's mail, for anyone who isn't an admin. Each address
 * with the kinds of mail it is ticked for, in words.
 */
async function ReadOnlyRecipients() {
  const recipients = await getNotificationRecipients();

  return (
    <Card title="Company recipients" meta={recipients.length ? `${recipients.length} addresses` : undefined}>
      {recipients.length === 0 ? (
        <CardEmpty>
          No addresses are configured, so the company&rsquo;s reports and alerts
          go nowhere. An admin adds them here.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {recipients.map((recipient) => {
            const ticks = RECIPIENT_CATEGORIES.filter((category) => receives(recipient, category));
            return (
              <li key={recipient.email} className="rounded-row px-2 py-[6px] text-detail">
                <span className="block truncate font-bold">
                  {recipient.email}
                  {typeof recipient.name === "string" && recipient.name ? (
                    <span className="font-normal text-ink-muted"> · {recipient.name}</span>
                  ) : null}
                </span>
                <span className="block text-ink-muted">
                  {ticks.length ? ticks.map((category) => CATEGORY_META[category].label).join(", ") : "Nothing ticked"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

async function Recipients() {
  const recipients = await readRecipients();
  const rows = recipients.map((recipient) => ({
    email: recipient.email,
    name: typeof recipient.name === "string" ? recipient.name : "",
    categories: Object.fromEntries(
      RECIPIENT_CATEGORIES.map((category) => [category, receives(recipient, category)]),
    ) as Record<(typeof RECIPIENT_CATEGORIES)[number], boolean>,
  }));

  return (
    <Card
      className="shrink-0"
      title="Recipients"
      meta={`${recipients.length} ${recipients.length === 1 ? "address" : "addresses"} · people or distribution lists`}
    >
      <p className="mx-4 mb-3 text-detail text-ink-muted">
        Who receives the company&rsquo;s mail, and which kinds. Mail about a
        person — approvals, tasks, the personal digest, security — goes to that
        person and isn&rsquo;t set here. This list is the setting v1 keeps: a
        refresh of v2 from v1 replaces it with v1&rsquo;s, and puts back only the
        ticks v1 doesn&rsquo;t have (Coverage, Depreciation) and labels, by
        address.
      </p>
      <RecipientsEditor initial={rows} />
    </Card>
  );
}

function when(run: RunRecord | undefined): string | null {
  if (!run) return null;
  const at = new Date(run.at).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const result =
    run.skipped === "no-recipients"
      ? "nobody ticked"
      : run.skipped === "nothing-to-report"
        ? "nothing to report"
        : run.sent > 0
          ? `sent to ${run.sent} of ${run.recipients}`
          : `failed — ${run.error ?? "unknown error"}`;
  return `${at} PT, ${result}${run.by && run.by !== "schedule" ? ` (${run.by})` : ""}`;
}

async function ScheduledReports() {
  const now = new Date();
  const recipients = await readRecipients();
  const rows: ReportRow[] = await Promise.all(
    REPORT_KEYS.map(async (key) => {
      const def = REPORTS[key];
      const [schedule, state] = await Promise.all([readSchedule(key), readSentState(key)]);
      return {
        key,
        label: def.label,
        what: def.what,
        categoryLabel: CATEGORY_META[def.category].short,
        recipients: recipients.filter((recipient) => receives(recipient, def.category)).length,
        schedule,
        next: nextRunLabel(schedule, state.occurrence, now),
        lastScheduled: when(state.scheduled),
        lastManual: when(state.manual),
      };
    }),
  );

  return (
    <Card className="shrink-0" title="Scheduled reports" meta="Pacific time · checked hourly">
      <p className="mx-4 mb-3 text-detail text-ink-muted">
        An hourly job sends each report on the first check at or after its time,
        once per occurrence. If that job isn&rsquo;t running, nothing here sends
        on its own — Send now always works.
      </p>
      <ReportSchedules reports={rows} />
    </Card>
  );
}
