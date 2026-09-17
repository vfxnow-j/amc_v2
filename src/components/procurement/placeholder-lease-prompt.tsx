"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { createPlaceholderLease, type LeaseOutcome } from "@/lib/actions/lease-create";

/**
 * "Create a placeholder lease for this?" — asked the moment a funding request
 * is approved.
 *
 * Approval is where the business commits to borrowing, and the lease is the
 * record the borrowing lives on. Leaving it until the request is marked funded
 * meant the loan appeared nowhere in Accounting → Leases for however long the
 * paperwork took. So approving asks, in the same place the approve button was:
 * on the funding request's lifecycle card and in the approvals queue. Declining
 * the offer changes nothing — the approval has already been recorded by then.
 *
 * What gets created and why the figures are what they are is in
 * `createPlaceholderLease`.
 */
export function PlaceholderLeasePrompt({
  fundingRequestId,
  onDone,
}: {
  fundingRequestId: string;
  /** Called when the person has answered, either way, once any result has shown. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<LeaseOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const result = await createPlaceholderLease(fundingRequestId);
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  if (outcome?.status === "ok") {
    return (
      <Notice tone="ok">
        {outcome.message}{" "}
        <Link href={`/dashboard/leases/${outcome.id}`} className="font-bold underline">
          Open the lease
        </Link>
      </Notice>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="Create a placeholder lease"
      className="flex flex-col gap-2 rounded-well bg-accent-tint p-3"
    >
      <p className="text-body font-bold text-accent-on-tint">
        Create a placeholder lease for this?
      </p>
      <p className="text-detail text-accent-on-tint">
        A provisional lease, numbered from the request, prefilled with the amount
        and whatever financing terms the request gives, starting today — and
        linked to the request so it shows in Accounting → Leases now. Complete it
        from the lender&rsquo;s agreement later.
      </p>
      {outcome?.status === "error" ? <Notice tone="error">{outcome.message}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={create}
          className="h-8 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create placeholder lease"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDone}
          className="h-8 rounded-pill bg-panel px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
        >
          No, just approve
        </button>
      </div>
    </div>
  );
}

/**
 * Where the approvals queue asks.
 *
 * A row in the queue cannot hold the question itself. Deciding calls
 * `revalidatePath("/dashboard/approvals")` inside the server action, so the page
 * re-renders as the decision returns and the approved row — with anything
 * mounted inside it — drops out of the list. The host sits above the list,
 * outside anything that re-renders away, and the row only tells it which request
 * was just approved.
 */
type Offer = { fundingRequestId: string; label: string };

const OfferContext = createContext<((offer: Offer) => void) | null>(null);

/** Null outside a host; the decision control then simply doesn't offer. */
export function usePlaceholderLeaseOffer() {
  return useContext(OfferContext);
}

export function PlaceholderLeaseHost({ children }: { children: ReactNode }) {
  const [offers, setOffers] = useState<Offer[]>([]);

  return (
    <OfferContext
      value={(offer) =>
        setOffers((current) =>
          current.some((o) => o.fundingRequestId === offer.fundingRequestId)
            ? current
            : [...current, offer],
        )
      }
    >
      {offers.map((offer) => (
        <section
          key={offer.fundingRequestId}
          className="flex flex-col gap-2 rounded-card bg-panel p-4 shadow-sm"
        >
          <p className="text-micro uppercase text-ink-muted">Just approved · {offer.label}</p>
          <PlaceholderLeasePrompt
            fundingRequestId={offer.fundingRequestId}
            onDone={() =>
              setOffers((current) =>
                current.filter((o) => o.fundingRequestId !== offer.fundingRequestId),
              )
            }
          />
        </section>
      ))}
      {children}
    </OfferContext>
  );
}

/**
 * The same offer on the record's "Funded by" card, for a request that was
 * approved without anyone being asked — an approver's own submission clears
 * itself — or where the prompt was declined and somebody changed their mind.
 */
export function CreatePlaceholderLeaseButton({ fundingRequestId }: { fundingRequestId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createPlaceholderLease(fundingRequestId);
            if (result.status === "error") setError(result.message);
            else router.refresh();
          })
        }
        className="h-8 self-start rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create placeholder lease"}
      </button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
