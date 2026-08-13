"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectQuickBooks,
  pushCustomers,
  pushInvoices,
  type QuickBooksOutcome,
} from "@/lib/quickbooks/actions";
import { Notice } from "@/components/feedback/notice";

/**
 * Connect, disconnect, and push what hasn't gone across yet.
 *
 * Connecting is a plain link, not a button with a handler: the handshake has to
 * leave the app for Intuit's own consent screen, and `/api/quickbooks/connect`
 * is what sets the CSRF state cookie on the way out. Anything clever here would
 * only get in the way of a redirect.
 *
 * The two push buttons are one-way on purpose. They send records that have no
 * QuickBooks id yet; nothing here pulls from QuickBooks or reconciles a record
 * that has drifted since it was sent, because deciding which side wins on a
 * changed invoice is a finance question and not one a settings screen should
 * answer silently.
 */
export function QuickBooksPanel({
  connected,
  configured,
  unsyncedClients,
  unsyncedInvoices,
}: {
  connected: boolean;
  configured: boolean;
  unsyncedClients: number;
  unsyncedInvoices: number;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<QuickBooksOutcome | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run(work: () => Promise<QuickBooksOutcome>) {
    setOutcome(null);
    startTransition(async () => {
      const result = await work();
      setOutcome(result);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {outcome ? (
        <Notice tone={outcome.status === "error" ? "error" : "ok"}>
          {outcome.message}
        </Notice>
      ) : null}

      {!connected ? (
        configured ? (
          // Deliberately not next/link. The target is a route handler, not a
          // page: Link would attempt a client-side navigation and ask for an
          // RSC payload that a redirect response cannot provide. This has to be
          // a real browser navigation, because the whole point is to leave for
          // Intuit's consent screen and come back.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/quickbooks/connect"
            className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
          >
            Connect to QuickBooks
          </a>
        ) : (
          <p className="text-body text-ink-muted">
            Connecting needs the app credentials to be set first. Nothing to
            press until then.
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || unsyncedClients === 0}
              onClick={() => run(pushCustomers)}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
              title="Sends clients that have no QuickBooks customer id yet"
            >
              {unsyncedClients === 0
                ? "All clients pushed"
                : `Push ${unsyncedClients} clients`}
            </button>
            <button
              type="button"
              disabled={busy || unsyncedInvoices === 0}
              onClick={() => run(pushInvoices)}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
              title="Sends sent, part-paid, paid and overdue invoices with no QuickBooks id"
            >
              {unsyncedInvoices === 0
                ? "All invoices pushed"
                : `Push ${unsyncedInvoices} invoices`}
            </button>
          </div>

          <p className="text-detail text-ink-muted">
            Pushing sends records that have never been across. It does not
            re-send anything that has changed since, and it never pulls: which
            side wins on an invoice edited in both places is a decision for
            whoever does the books, not for this screen.
          </p>

          <div className="rounded-well bg-sunken p-3 text-detail text-ink-muted">
            {confirming ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(disconnectQuickBooks)}
                  className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
                >
                  Yes, disconnect
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-pill bg-panel px-3 py-1 text-pill text-ink-muted hover:text-ink"
                >
                  Stay connected
                </button>
              </div>
            ) : (
              <>
                <p className="mb-2">
                  Disconnecting revokes the token at Intuit and removes it here.
                  The QuickBooks ids already stored on clients and invoices stay,
                  so reconnecting to the same company resumes rather than
                  duplicating.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="rounded-pill bg-panel px-3 py-1 text-pill text-destructive hover:bg-row-hover"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
