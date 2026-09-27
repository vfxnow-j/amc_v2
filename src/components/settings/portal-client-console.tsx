"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPortalClient,
  deletePortalClient,
  revokePortalClient,
  rotatePortalClientToken,
  rotatePortalWebhookSecret,
} from "@/lib/actions/portal-clients";
import { Notice } from "@/components/feedback/notice";

const SCOPES = [
  { value: "portal:read", label: "Read", hint: "catalog, capacity, accounts" },
  { value: "portal:quote", label: "Quote", hint: "account prices" },
  { value: "portal:write", label: "Write", hint: "accounts, holds, orders" },
  { value: "portal:billing", label: "Billing", hint: "invoices" },
] as const;

const FIELD =
  "h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

type Shown = { title: string; lines: { label: string; value: string }[] };

/** The once-only reveal of a token or secret. */
function Reveal({ shown, onDone }: { shown: Shown; onDone: () => void }) {
  return (
    <div className="mb-3 rounded-well bg-accent-tint p-3 text-detail text-accent-on-tint">
      <p className="mb-1 font-bold">
        {shown.title} — copy this now, it is not shown again.
      </p>
      {shown.lines.map((line) => (
        <div key={line.label} className="mb-1">
          <span className="text-micro uppercase">{line.label}</span>
          <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
            {line.value}
          </code>
        </div>
      ))}
      <button
        type="button"
        onClick={onDone}
        className="mt-1 rounded-pill bg-panel/60 px-3 py-1 text-pill"
      >
        I&rsquo;ve copied it
      </button>
    </div>
  );
}

/**
 * Issuing a portal client: a scoped service token for the external client
 * portal (docs/portal-api.md). Not a staff key — it has scopes, not a role.
 * The token, and the webhook secret when one is made, are shown once.
 */
export function PortalClientConsole({ secretKeySet }: { secretKeySet: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["portal:read", "portal:quote"]);
  const [cidrs, setCidrs] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [withSecret, setWithSecret] = useState(secretKeySet);
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);

  function toggle(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope],
    );
  }

  function issue(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    setWarning("");
    startTransition(async () => {
      try {
        const created = await createPortalClient({
          name: name.trim(),
          scopes,
          allowedCidrs: cidrs.split(/[\s,]+/).filter(Boolean),
          webhookUrl: webhookUrl || null,
          withWebhookSecret: withSecret,
          expiresAt: expires || null,
        });
        const lines = [{ label: "Token", value: created.token }];
        if (created.webhookSecret)
          lines.push({ label: "Webhook secret", value: created.webhookSecret });
        setShown({ title: name.trim(), lines });
        if (created.webhookSecretSkipped) setWarning(created.webhookSecretSkipped);
        setName("");
        setCidrs("");
        setWebhookUrl("");
        setExpires("");
        router.refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not create the client.",
        );
      }
    });
  }

  return (
    <div className="px-4 pb-4">
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {warning ? (
        <p className="mb-3 rounded-well bg-sunken p-3 text-detail text-ink">
          {warning}
        </p>
      ) : null}
      {shown ? <Reveal shown={shown} onDone={() => setShown(null)} /> : null}

      <form onSubmit={issue} className="flex flex-col gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Portal</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Client portal — production"
            className={FIELD}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Scopes</span>
          {SCOPES.map((scope) => (
            <label key={scope.value} className="flex items-center gap-2 text-detail">
              <input
                type="checkbox"
                checked={scopes.includes(scope.value)}
                onChange={() => toggle(scope.value)}
              />
              <span className="text-ink">{scope.label}</span>
              <span className="text-ink-faint">{scope.hint}</span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">
            Allowed addresses — CIDRs, blank for any
          </span>
          <input
            value={cidrs}
            onChange={(event) => setCidrs(event.target.value)}
            placeholder="e.g. 10.8.0.0/24"
            className={FIELD}
          />
        </label>
        {cidrs.trim() ? null : (
          <p role="note" className="rounded-well bg-sunken p-2 text-detail text-ink">
            Left blank, this token works from any address. Recommended: the
            WireGuard subnet (e.g. 10.8.0.0/24).
          </p>
        )}

        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">
            Webhook URL — optional
          </span>
          <input
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://portal.internal/webhooks/amc (https only)"
            className={FIELD}
          />
        </label>

        <label className="flex items-center gap-2 text-detail">
          <input
            type="checkbox"
            checked={withSecret}
            disabled={!secretKeySet}
            onChange={(event) => setWithSecret(event.target.checked)}
          />
          <span className={secretKeySet ? "text-ink" : "text-ink-faint"}>
            Make a webhook signing secret
          </span>
        </label>
        {secretKeySet ? null : (
          <p className="text-detail text-ink-faint">
            PORTAL_SECRET_KEY is not set on the server (or is not 32 random
            bytes as hex or base64), so no webhook secret can be made — it is
            never stored unencrypted. The token still works.
          </p>
        )}

        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">
            Expires — optional
          </span>
          <input
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
            className={FIELD}
          />
        </label>

        <button
          type="submit"
          disabled={busy || !name.trim() || scopes.length === 0}
          className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create portal client"}
        </button>
      </form>
    </div>
  );
}

/** Rotate token, rotate secret, revoke — per row; delete once revoked. */
export function PortalClientRowActions({
  id,
  name,
  isActive,
  secretKeySet,
  canDelete,
}: {
  id: string;
  name: string;
  isActive: boolean;
  secretKeySet: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  function run(work: () => Promise<Shown | null>) {
    setError("");
    startTransition(async () => {
      try {
        const result = await work();
        if (result) setShown(result);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.");
      }
    });
  }

  if (!isActive) {
    if (!canDelete) return <span className="text-ink-faint">Revoked</span>;
    return (
      <div className="flex flex-col items-end gap-1">
        {error ? <span className="text-destructive">{error}</span> : null}
        {confirming ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await deletePortalClient(id);
                return null;
              })
            }
            className="text-destructive hover:underline disabled:opacity-50"
            title={`Delete ${name} and its request log for good`}
          >
            Really delete
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-ink-muted hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {shown ? (
        <div className="w-[320px] text-left">
          <Reveal shown={shown} onDone={() => setShown(null)} />
        </div>
      ) : null}
      {error ? <span className="text-destructive">{error}</span> : null}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { token } = await rotatePortalClientToken(id);
              return { title: `${name} — new token`, lines: [{ label: "Token", value: token }] };
            })
          }
          className="text-accent-text hover:underline disabled:opacity-50"
        >
          Rotate token
        </button>
        {secretKeySet ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { webhookSecret } = await rotatePortalWebhookSecret(id);
                return {
                  title: `${name} — new webhook secret`,
                  lines: [{ label: "Webhook secret", value: webhookSecret }],
                };
              })
            }
            className="text-accent-text hover:underline disabled:opacity-50"
          >
            Rotate secret
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await revokePortalClient(id);
              return null;
            })
          }
          className="text-destructive hover:underline disabled:opacity-50"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
