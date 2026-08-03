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
import { dayYear } from "@/lib/format";
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

  return (
    <>
      <SettingsHeader id="api-keys" />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,380px)_1fr]">
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
