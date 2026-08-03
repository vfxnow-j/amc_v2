import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, CardSkeleton, Field, Unset } from "@/components/record/record-card";
import { QuickBooksPanel } from "@/components/settings/quickbooks-panel";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { getConnectionInfo } from "@/lib/quickbooks/qb-client";
import { getSyncStatus } from "@/lib/quickbooks/qb-sync";
import { quickbooksConfig } from "@/lib/quickbooks/config";
import { getSessionUser } from "@/lib/roles";
import { stamp } from "@/lib/settings/format";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "QuickBooks" };

/**
 * Why a handshake ended where it did.
 *
 * The callback route has no UI, so every way out of it is a redirect carrying
 * one of these. They are phrased as what to do next, because the person reading
 * one has just come back from another company's website and has no idea what
 * happened.
 */
const REASONS: Record<string, string> = {
  not_configured:
    "The app credentials aren't set on this instance, so there is nothing to connect with. See the panel on the right.",
  unauthorized:
    "You were signed out, or your access changed, part way through. Sign in as an administrator and start again.",
  invalid_state:
    "The handshake didn't match the one this browser started — either it took more than five minutes, or it began somewhere else. Start again.",
  missing_params:
    "Intuit came back without an authorisation code. Nothing was stored; start again.",
  exchange_failed:
    "Intuit refused to exchange the code for a token. The detail is in the server log — it is withheld here because those responses quote the request back.",
  access_denied:
    "The connection was declined at Intuit's consent screen. Nothing was stored.",
};

/**
 * Settings → QuickBooks.
 *
 * The accounting connection, and a first-class deliverable of this stage rather
 * than a tab: v1 filed it under Integrations alongside Zapier, but this is the
 * only integration that moves money records, and it is the one demoed against
 * the QuickBooks sandbox.
 *
 * The screen is built around what is actually knowable. `QBToken` holds one row
 * — the connection is per-instance, not per-user — so "connected" is a single
 * fact, and the realm id is the only proof of *which* company file it points
 * at. The sync figures are counts of stored QuickBooks ids on our side; they
 * say what we have sent, and deliberately do not claim anything about what
 * exists over there, because nothing here reads it back.
 *
 * On this instance the credentials are blank by design, so the connect path
 * cannot be exercised end to end. The screen states that as a configuration
 * fact with the variable names, rather than presenting a Connect button that
 * would fail on somebody else's error page.
 */
export default async function QuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="quickbooks" role={user.title} />;

  const params = await searchParams;
  const config = quickbooksConfig();

  return (
    <>
      <SettingsHeader
        id="quickbooks"
        blurb={`Company file: ${config.environment === "production" ? "production" : "sandbox"}`}
      />

      {params.error ? (
        <p
          role="alert"
          className="rounded-card bg-destructive/10 px-4 py-3 text-body text-destructive shadow-sm"
        >
          {REASONS[params.error] ??
            `The connection ended with "${params.error}". Nothing was stored; start again.`}
        </p>
      ) : null}
      {params.connected ? (
        <p
          role="status"
          className="rounded-card bg-accent-tint px-4 py-3 text-body text-accent-on-tint shadow-sm"
        >
          Connected. Push clients and invoices below to send what has never been
          across.
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[1fr_minmax(0,340px)]">
        <div className="flex flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Connection" rows={3} />}>
            <ConnectionCard configured={config.configured} />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="What has gone across" rows={3} />}>
            <SyncCard />
          </Suspense>
        </div>

        <Card
          title="Configuration"
          meta={config.configured ? "complete" : "incomplete"}
        >
          <div className="flex flex-col gap-3 px-4 pb-4">
            {config.configured ? (
              <p className="text-body text-ink-muted">
                All four variables are set. A connection points at the{" "}
                <span className="text-ink">{config.environment}</span> company
                file.
              </p>
            ) : (
              <>
                <p className="text-body text-ink-muted">
                  This instance ships with the integration credentials blank, so
                  no connection can be made. These are unset in{" "}
                  <code className="text-ink">.env</code>:
                </p>
                <ul className="rounded-well bg-sunken p-2 text-detail text-ink">
                  {config.missing.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="text-detail text-ink-muted">
              <p className="mb-1">
                The redirect URI has to match the one registered in the Intuit
                developer console character for character:
              </p>
              <code className="block break-all rounded-well bg-sunken p-2 text-ink">
                {config.redirectUri || "not set"}
              </code>
            </div>

            <p className="text-detail text-ink-faint">
              The client secret is never shown here, and never reaches a rendered
              page — this card reports only whether it is present.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

async function ConnectionCard({ configured }: { configured: boolean }) {
  const [info, status] = await Promise.all([getConnectionInfo(), getSyncStatus()]);
  const connected = !!info?.connected;

  return (
    <Card
      title="Connection"
      meta={connected ? "connected" : configured ? "not connected" : "unavailable"}
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Company (realm)">
          {info?.realmId ?? <Unset>No connection</Unset>}
        </Field>
        <Field label="Access token">
          {info?.expiresAt ? (
            <>
              {stamp(info.expiresAt)}
              <span className="text-ink-faint"> · refreshes on use</span>
            </>
          ) : (
            <Unset>None stored</Unset>
          )}
        </Field>
      </div>

      {connected ? (
        <p className="mx-4 mb-3 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          The stored access token lasts an hour and is refreshed automatically
          on the next call. What actually expires is the refresh token, after a
          hundred days without use — and Intuit does not tell us when that is,
          so this screen cannot show a date for it. A push that comes back
          refused is the symptom.
        </p>
      ) : null}

      <QuickBooksPanel
        connected={connected}
        configured={configured}
        unsyncedClients={status.clients.total - status.clients.synced}
        unsyncedInvoices={status.invoices.total - status.invoices.synced}
      />
    </Card>
  );
}

async function SyncCard() {
  const status = await getSyncStatus();

  const rows = [
    { label: "Clients", ...status.clients, note: "every account on the system" },
    {
      label: "Invoices",
      ...status.invoices,
      note: "sent, part-paid, paid and overdue — drafts are not sent",
    },
    { label: "Payments", ...status.payments, note: "money received" },
  ];

  return (
    <Card title="What has gone across" meta="counted on our side">
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="min-w-0">
              <span className="font-bold">{row.label}</span>
              <span className="block truncate text-ink-faint">{row.note}</span>
            </span>
            <span className="tabular-nums text-ink-muted">
              {row.total === 0 ? (
                <span className="text-ink-faint">none to send</span>
              ) : (
                <>
                  {row.synced} of {row.total} carry a QuickBooks id
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
        These are our records that hold a QuickBooks id, which is proof we sent
        them once. It is not a reconciliation: nothing here reads QuickBooks
        back, so a record deleted or edited over there still counts as sent.
      </p>
    </Card>
  );
}
