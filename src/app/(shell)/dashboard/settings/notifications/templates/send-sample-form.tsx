"use client";

import { useActionState } from "react";
import { sendTemplateSampleAction } from "@/lib/actions/notification-settings";

/** "Send me a sample" for the template on screen. */
export function SendSampleForm({ template }: { template: string }) {
  const [outcome, send, pending] = useActionState(sendTemplateSampleAction, null);
  return (
    <form action={send} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="template" value={template} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send me a sample"}
      </button>
      {outcome && !pending ? (
        <span role="status" className={`text-detail ${outcome.ok ? "text-ink-muted" : "text-destructive"}`}>
          {outcome.message}
        </span>
      ) : null}
    </form>
  );
}
