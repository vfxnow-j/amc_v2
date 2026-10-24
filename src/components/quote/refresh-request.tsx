"use client";

import { useState, useTransition } from "react";
import { requestQuoteRefresh } from "@/lib/actions/quote-tokens";

/** The expired quote page's one action: ask for an updated quote. */
export function RefreshRequest({ token }: { token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={busy || message !== null && !failed}
        onClick={() =>
          start(async () => {
            const result = await requestQuoteRefresh(token).catch(() => ({
              status: "error" as const,
              message: "Something went wrong. Reply to the email this came in and we will help.",
            }));
            setFailed(result.status === "error");
            setMessage(result.message);
          })
        }
        className="rounded-xl bg-[#18181b] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#27272a] disabled:opacity-50"
      >
        {busy ? "Sending…" : "Request an updated quote"}
      </button>
      {message ? (
        <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-[#b91c1c]" : "text-[#52525b]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
