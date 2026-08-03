"use client";

import { useActionState, useState } from "react";
import { saveNotificationPreferencesAction } from "@/lib/actions/notification-feed";
import {
  NOTIFICATION_LABEL,
  NOTIFICATION_TRIGGER,
  NOTIFICATION_TYPES,
  type NotificationPreferences,
} from "@/lib/notifications/types";

/**
 * The per-type switchboard.
 *
 * A real `<form>` posting a Server Action, so it submits and saves with
 * JavaScript off; the client half exists only to say "Saved" and to keep the
 * boxes where the user put them while the action is in flight. Every value is
 * read server-side from the `FormData`, so nothing here is trusted.
 *
 * Imports only `lib/notifications/types`, which is a plain module holding const
 * maps — nothing on this path reaches `lib/prisma`, which from a client
 * component would drag the pg driver into the browser bundle and fail the build
 * on `dns`.
 */
export function PreferencesForm({
  initial,
  emailConfigured,
}: {
  initial: NotificationPreferences;
  /** False when RESEND_API_KEY is blank, which is this instance's normal state. */
  emailConfigured: boolean;
}) {
  // `useActionState` with a Server Action, so the form still posts and saves
  // with JavaScript off — the client half only supplies "Saving…" / "Saved."
  const [status, save, pending] = useActionState(
    saveNotificationPreferencesAction,
    null,
  );
  const [digest, setDigest] = useState(initial.digest);

  return (
    <form action={save} className="flex min-h-0 flex-col">
      <div
        className="grid gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted"
        style={{ gridTemplateColumns: "minmax(0,1fr) 72px 72px" }}
      >
        <span>Type</span>
        <span className="text-center">In app</span>
        <span className="text-center">In digest</span>
      </div>

      <ul className="flex flex-col gap-[2px] px-2">
        {NOTIFICATION_TYPES.map((type, index) => (
          <li
            key={type}
            className={`grid items-center gap-2 rounded-row p-2 ${index % 2 === 1 ? "bg-row-alt" : ""}`}
            style={{ gridTemplateColumns: "minmax(0,1fr) 72px 72px" }}
          >
            <span className="min-w-0">
              <span className="block truncate font-bold">
                {NOTIFICATION_LABEL[type]}
              </span>
              {/* The rule that raises it, in full. A switch whose trigger you
                  can't see is a switch nobody dares turn off. */}
              <span className="block truncate text-detail text-ink-muted">
                {NOTIFICATION_TRIGGER[type]}
              </span>
            </span>

            <Switch
              name={`inApp:${type}`}
              defaultChecked={initial.types[type].inApp}
              label={`${NOTIFICATION_LABEL[type]} in the feed`}
            />
            <Switch
              name={`email:${type}`}
              defaultChecked={initial.types[type].email}
              label={`${NOTIFICATION_LABEL[type]} in the digest email`}
              // Off-looking rather than disabled: the value still posts, so a
              // user can set up what they want now and have it work the day the
              // digest is switched on for them.
              dimmed={!digest}
            />
          </li>
        ))}
      </ul>

      <div className="mx-4 mt-3 rounded-well bg-sunken p-3">
        <label className="flex items-start gap-[9px] text-body">
          <input
            type="checkbox"
            name="digest"
            checked={digest}
            onChange={(event) => setDigest(event.target.checked)}
            className="mt-[2px] size-[14px] flex-none accent-[var(--accent-solid)]"
          />
          <span>
            <span className="block font-bold">Email me the daily digest</span>
            <span className="block text-detail text-ink-muted">
              One message a day listing whatever is still unread above, sent by
              the 9am sweep. Off by default — nobody is subscribed to mail they
              didn&rsquo;t ask for.
              {emailConfigured ? null : (
                <>
                  {" "}
                  <span className="text-accent-text">
                    Outbound email is switched off in this instance, so nothing
                    will actually send until a Resend key is configured.
                  </span>
                </>
              )}
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
        {status && !pending ? (
          <span className="text-detail text-ink-muted">{status}</span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * A checkbox, drawn to the row density rather than the browser default. Not the
 * shared `ui/switch` primitive: that one is a Radix control backed by client
 * state, and this form has to post its values without JavaScript.
 */
function Switch({
  name,
  defaultChecked,
  label,
  dimmed = false,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
  dimmed?: boolean;
}) {
  return (
    <span className="flex justify-center">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        aria-label={label}
        className={`size-[14px] accent-[var(--accent-solid)] ${dimmed ? "opacity-40" : ""}`}
      />
    </span>
  );
}
