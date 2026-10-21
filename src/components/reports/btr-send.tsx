"use client";

import { useState, useTransition } from "react";
import { sendBtrToAddress } from "@/lib/actions/btr-report";

/** "Send me this" for the BT Report: your own address, or one you type. */
export function BtrSend() {
  const [to, setTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={to}
        type="email"
        aria-label="Send to"
        placeholder="me, or another address"
        onChange={(event) => setTo(event.target.value)}
        className="h-8 w-56 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(async () => setResult(await sendBtrToAddress(to)))}
        className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send"}
      </button>
      {result ? (
        <span role="status" className={`text-detail ${result.ok ? "text-ink-muted" : "text-destructive"}`}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
