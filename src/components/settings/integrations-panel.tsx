"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IntegrationState } from "@/lib/queries/settings";
import { rotateZapierSecret, saveHubSpot } from "@/lib/settings/integrations";
import { Notice } from "@/components/feedback/notice";

/**
 * The two settings panels for outside systems that aren't QuickBooks.
 *
 * Neither renders a credential. The HubSpot fields are write-only — blank means
 * "leave it alone", which is why the merge happens server-side in
 * `lib/settings/integrations.ts` rather than by shipping the current values to
 * the browser and sending them back. The Zapier secret is shown once, at the
 * moment it is generated, and never again.
 */

export function HubSpotForm({ state }: { state: IntegrationState["hubspot"] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(state.enabled);
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [rental, setRental] = useState(state.pipelineRental);
  const [sale, setSale] = useState(state.pipelineSale);
  const [rto, setRto] = useState(state.pipelineRTO);
  const [cloud, setCloud] = useState(state.pipelineCloud);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveHubSpot({
        enabled,
        accessToken: token,
        webhookSecret: secret,
        pipelineRental: rental,
        pipelineSale: sale,
        pipelineRTO: rto,
        pipelineCloud: cloud,
      });
      if (result.status === "error") setError(result.message);
      else {
        setToken("");
        setSecret("");
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? (
        <Notice tone="error">
          {error}
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="ok">
          Saved.
        </Notice>
      ) : null}

      <label className="flex cursor-pointer items-start gap-2 rounded-well bg-sunken p-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-[2px] size-[14px] flex-none accent-accent-solid"
        />
        <span>
          <span className="block text-detail font-bold text-ink">
            Push orders to HubSpot
          </span>
          <span className="block text-detail text-ink-muted">
            Creating, quoting or confirming an order writes a deal. Off means the
            calls are made and drop out immediately.
          </span>
        </span>
      </label>

      <Secret
        label="Private app token"
        value={token}
        onChange={setToken}
        present={state.hasToken}
      />
      <Secret
        label="Webhook signing secret"
        value={secret}
        onChange={setSecret}
        present={state.hasWebhookSecret}
      />

      <div className="grid grid-cols-2 gap-2">
        <Pipeline label="Rentals" value={rental} onChange={setRental} />
        <Pipeline label="Sales" value={sale} onChange={setSale} />
        <Pipeline label="Rent to own" value={rto} onChange={setRto} />
        <Pipeline label="Cloud" value={cloud} onChange={setCloud} />
      </div>
      <p className="text-detail text-ink-muted">
        A pipeline of <code className="text-ink">default</code> lets HubSpot
        decide. The ids are on the pipeline in HubSpot&rsquo;s deal settings.
      </p>

      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save HubSpot settings"}
      </button>
    </form>
  );
}

function Secret({
  label,
  value,
  onChange,
  present,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  present: boolean;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        type="password"
        value={value}
        autoComplete="off"
        placeholder={present ? "Set — leave blank to keep it" : "Not set"}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="text-detail text-ink-faint">
        {present
          ? "Stored. It is never read back onto this screen — typing here replaces it."
          : "Nothing stored yet."}
      </span>
    </label>
  );
}

function Pipeline({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

export function ZapierSecret({ present }: { present: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [issued, setIssued] = useState("");
  const [confirming, setConfirming] = useState(false);

  function rotate() {
    setError("");
    startTransition(async () => {
      const result = await rotateZapierSecret();
      if (result.status === "error") setError(result.message);
      else {
        setIssued(result.secret);
        setConfirming(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {error ? (
        <Notice tone="error">
          {error}
        </Notice>
      ) : null}

      {issued ? (
        <div className="rounded-well bg-accent-tint p-3 text-detail text-accent-on-tint">
          <p className="mb-1 font-bold">
            Copy this into Zapier now — it is not shown again.
          </p>
          <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
            {issued}
          </code>
        </div>
      ) : (
        <p className="text-body text-ink-muted">
          {present
            ? "A secret is set. It is not readable from here — generating a new one is the only way to see a value, and it stops the old one working immediately."
            : "No secret set, so nothing could authenticate against the inbound hook."}
        </p>
      )}

      {present && !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          Generate a new one
        </button>
      ) : present ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={rotate}
            className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
          >
            Yes — the old one stops working
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted hover:text-ink"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={rotate}
          className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate a secret"}
        </button>
      )}
    </div>
  );
}
