import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { Card } from "@/components/record/record-card";
import {
  ApiKeyConsole,
  ApiKeyRowActions,
} from "@/components/settings/api-key-console";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import {
  PortalClientConsole,
  PortalClientRowActions,
} from "@/components/settings/portal-client-console";
import { dayYear } from "@/lib/format";
import { getPortalClientRows } from "@/lib/portal/admin-queries";
import { portalSecretKeyConfigured } from "@/lib/portal/secrets";
import { getApiKeyRows } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { roleLabel } from "@/lib/settings/roles";

export const metadata = { title: "API keys" };

const COLUMNS: Column[] = [
  { key: "name", label: "What it is for", width: "minmax(0,1.2fr)" },
  { key: "prefix", label: "Key", width: "150px" },
  { key: "access", label: "Access", width: "88px" },
  { key: "used", label: "Last used", width: "96px" },
  { key: "expires", label: "Expires", width: "96px" },
  { key: "issued", label: "Issued by", width: "minmax(0,0.8fr)" },
  { key: "act", label: "", width: "96px", align: "right" },
];

const PORTAL_COLUMNS: Column[] = [
  { key: "name", label: "Portal", width: "minmax(0,1fr)" },
  { key: "prefix", label: "Token", width: "150px" },
  { key: "scopes", label: "Scopes", width: "minmax(0,1fr)" },
  { key: "cidrs", label: "Addresses", width: "minmax(0,0.8fr)" },
  { key: "webhook", label: "Webhook", width: "96px" },
  { key: "used", label: "Last used", width: "96px" },
  { key: "act", label: "", width: "minmax(0,1.2fr)", align: "right" },
];

/**
 * Settings → API keys.
 *
 * v1 kept these in a tab of the Integrations screen, alongside Zapier and
 * HubSpot. They are not the same kind of thing: an integration is a connection
 * to somebody else's system, and a key is a credential into ours. Keys get
 * their own screen and sit under People and access, next to Users, because that
 * is the question they answer.
 *
 * The table never shows a key. `ApiKey` stores a SHA-256 hash and the first
 * twelve characters, so the prefix is all that exists to show — enough to point
 * at the row somebody means, useless to anyone who finds it.
 */
export default async function ApiKeysPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="api-keys" role={user.title} />;

  const canDelete = user.role === "SUPER_ADMIN";
  const secretKeySet = portalSecretKeyConfigured();

  return (
    <>
      <SettingsHeader id="api-keys" />

      {/* Two stacked sections, so neither may shrink to the viewport (the
          one-section settings pages use min-h-0 flex-1): <main> scrolls. */}
      <div className="grid shrink-0 items-start gap-3 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex flex-col gap-3">
          <Card title="Issue a key" meta="shown once, then never again">
            <ApiKeyConsole canDelete={canDelete} />
          </Card>

          <Card title="What a key can call">
            <div className="flex flex-col gap-2 px-4 pb-4 text-body text-ink-muted">
              <p>
                One endpoint is served in v2 today, and a key is the only way to
                reach it:
              </p>
              <code className="rounded-well bg-sunken p-2 text-detail text-ink">
                POST /api/v1/service/qc-runs
              </code>
              <p>
                The bench rig files a QC result against a work order number.
                The key goes in one header and one only —{" "}
                <code className="text-ink">Authorization: Bearer …</code>; there
                is no query-string or <code className="text-ink">X-API-Key</code>{" "}
                fallback in <code className="text-ink">lib/api-auth</code>.
              </p>
              <p>
                v1 documented a wider surface — assets, reservations, QuickBooks
                sync. Those handlers have not been carried across yet, so they
                are not listed here; a reference to an endpoint that 404s is
                worse than a short one.
              </p>
            </div>
          </Card>
        </div>

        <Suspense fallback={<ListTableSkeleton rows={8} />}>
          <Table canDelete={canDelete} />
        </Suspense>
      </div>

      <div className="grid shrink-0 items-start gap-3 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card title="Portal clients" meta="scoped tokens for /v1, shown once">
          <PortalClientConsole secretKeySet={secretKeySet} />
        </Card>
        <Suspense fallback={<ListTableSkeleton rows={3} />}>
          <PortalTable secretKeySet={secretKeySet} canDelete={canDelete} />
        </Suspense>
      </div>
    </>
  );
}

async function Table({ canDelete }: { canDelete: boolean }) {
  const keys = await getApiKeyRows();
  const now = new Date();
  const live = keys.filter(
    (key) => key.isActive && (!key.expiresAt || key.expiresAt > now),
  ).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={keys.length}
      footerNote={
        keys.length ? (
          <>
            {live} usable right now
            {keys.length - live > 0
              ? ` · ${keys.length - live} revoked or expired`
              : ""}
          </>
        ) : undefined
      }
      empty={
        <>
          No keys issued. Issue one when a machine needs to talk to the system
          without a person signing in — a bench rig filing QC results, say.
        </>
      }
      rows={keys.map((key) => {
        const expired = !!key.expiresAt && key.expiresAt <= now;
        const dead = !key.isActive || expired;

        return {
          id: key.id,
          cells: {
            name: (
              <span className={dead ? "text-ink-faint" : "font-bold"}>
                {key.name}
                {!key.isActive ? " · revoked" : expired ? " · expired" : ""}
              </span>
            ),
            prefix: (
              <code className="text-detail text-ink-muted">
                {key.prefix}
                <span className="text-ink-faint">…</span>
              </code>
            ),
            access: (
              <span className="text-ink-muted">{roleLabel(key.role)}</span>
            ),
            used: key.lastUsedAt ? (
              <span className="tabular-nums text-ink-muted">
                {dayYear(key.lastUsedAt)}
              </span>
            ) : (
              // Never used is the interesting case: it is either brand new or
              // it was issued for something that never happened.
              <span className="text-ink-faint">Never</span>
            ),
            expires: key.expiresAt ? (
              <span
                className={`tabular-nums ${expired ? "text-ink-faint" : "text-ink-muted"}`}
              >
                {dayYear(key.expiresAt)}
              </span>
            ) : (
              <span className="text-ink-faint">No expiry</span>
            ),
            issued: (
              <span className="text-ink-muted">
                {key.createdBy} · {dayYear(key.createdAt)}
              </span>
            ),
            act: (
              <ApiKeyRowActions
                id={key.id}
                name={key.name}
                isActive={key.isActive}
                canDelete={canDelete}
              />
            ),
          },
        };
      })}
    />
  );
}

/**
 * Portal clients: the external client portal's service tokens
 * (docs/portal-api.md). They carry scopes, never a staff role, so they sit in
 * their own table rather than among the keys above.
 */
async function PortalTable({
  secretKeySet,
  canDelete,
}: {
  secretKeySet: boolean;
  canDelete: boolean;
}) {
  const clients = await getPortalClientRows();
  const now = new Date();

  return (
    <ListTable
      columns={PORTAL_COLUMNS}
      total={clients.length}
      empty={
        <>
          No portal clients. Create one when the client portal is ready to
          call /v1.
        </>
      }
      rows={clients.map((client) => {
        const expired = !!client.expiresAt && client.expiresAt <= now;
        const dead = !client.isActive || expired;
        return {
          id: client.id,
          cells: {
            name: (
              <span className={dead ? "text-ink-faint" : "font-bold"}>
                {client.name}
                {!client.isActive ? " · revoked" : expired ? " · expired" : ""}
                {client.accounts ? (
                  <span className="font-normal text-ink-muted">
                    {" "}
                    · {client.accounts} account{client.accounts === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            ),
            prefix: (
              <code className="text-detail text-ink-muted">
                {client.tokenPrefix}
                <span className="text-ink-faint">…</span>
              </code>
            ),
            scopes: (
              <span className="text-ink-muted">
                {client.scopes.map((s) => s.replace("portal:", "")).join(", ")}
              </span>
            ),
            cidrs: client.allowedCidrs.length ? (
              <span className="text-ink-muted">{client.allowedCidrs.join(", ")}</span>
            ) : (
              <span className="text-ink-faint">Any</span>
            ),
            webhook: client.webhookUrl ? (
              <span className="text-ink-muted" title={client.webhookUrl}>
                {client.hasWebhookSecret ? "Signed" : "No secret"}
              </span>
            ) : (
              <span className="text-ink-faint">None</span>
            ),
            used: client.lastUsedAt ? (
              <span className="tabular-nums text-ink-muted">
                {dayYear(client.lastUsedAt)}
              </span>
            ) : (
              <span className="text-ink-faint">Never</span>
            ),
            act: (
              <PortalClientRowActions
                id={client.id}
                name={client.name}
                isActive={client.isActive}
                secretKeySet={secretKeySet}
                canDelete={canDelete}
              />
            ),
          },
        };
      })}
    />
  );
}
