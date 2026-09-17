"use client";

import { useActionState } from "react";
import { sendTestEmailAction } from "@/lib/actions/notification-settings";

/**
 * "Send a test email" — the layout specimen, to an address or to yourself.
 *
 * A plain form posting a Server Action; the only client state is the outcome
 * line, which matters here more than usual: with the test redirect on, the
 * message does not arrive where it was addressed, and the line says where it
 * went instead.
 */
export function TestEmailForm({ placeholder }: { placeholder: string }) {
  const [outcome, send, pending] = useActionState(sendTestEmailAction, null);

  return (
    <form action={send} className="flex flex-col gap-2 px-4 pb-4">
      <label className="text-detail text-ink-muted" htmlFor="test-email-to">
        Send the layout specimen to
      </label>
      <div className="flex gap-2">
        <input
          id="test-email-to"
          name="to"
          type="email"
          placeholder={placeholder}
          className="h-8 min-w-0 flex-1 rounded-well bg-sunken px-3 text-body text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send test"}
        </button>
      </div>
      {outcome && !pending ? (
        <p
          role="status"
          className={`text-detail ${outcome.ok ? "text-ink-muted" : "text-destructive"}`}
        >
          {outcome.message}
        </p>
      ) : null}
    </form>
  );
}
