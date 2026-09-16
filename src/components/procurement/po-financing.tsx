"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { money } from "@/lib/format";
import {
  attachPOToFunding,
  detachPOFromFunding,
  setPOLease,
  type POOutcome,
} from "@/lib/procurement/po-actions";
import {
  FUNDING_STATUS_LABEL,
  PO_METHOD_LABEL,
  PO_METHODS,
} from "@/lib/procurement/po-labels";

type Lease = { id: string; leaseNumber: string; leaseName: string; lender: string; status: string };

export type FinancingProps = {
  poId: string;
  lease: Lease | null;
  unitsReceived: number;
  requests: {
    id: string;
    requestNumber: string;
    status: string;
    amountRequested: number;
    requestedBy: string;
  }[];
  leaseOptions: Lease[];
  requestOptions: {
    id: string;
    requestNumber: string;
    status: string;
    amountRequested: number;
    for: string | null;
  }[];
  /** Admins change the financing; everyone else reads it. */
  canEdit: boolean;
};

/**
 * What this order is bought under: the funding requests that justified it and
 * the loan paying for it.
 *
 * This is the middle of the trail a unit reads back — unit → PO → request →
 * loan — so it is shown whether or not anyone can change it. The join to a
 * request is written from here (the PO side); the request's own screen writes
 * it from the other.
 *
 * Putting the PO on a lease moves the units already received against it onto
 * that lease, which is a change to fleet records and not just to this page, so
 * the dialog names how many before it is confirmed. The amount requested is
 * shown as what was asked for — it is the requester's figure, not money that
 * moved.
 */
export function POFinancingCard(props: FinancingProps) {
  const { poId, lease, requests, canEdit, unitsReceived } = props;
  const router = useRouter();
  const [dialog, setDialog] = useState<"lease" | "request" | null>(null);
  const [pickedLease, setPickedLease] = useState(lease?.id ?? "");
  const [pickedRequest, setPickedRequest] = useState("");
  const [clearedMethod, setClearedMethod] = useState("");
  const [outcome, setOutcome] = useState<POOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function run(work: () => Promise<POOutcome>) {
    startTransition(async () => {
      const result = await work();
      setOutcome(result);
      setDialog(null);
      if (result.status === "ok") {
        setPickedRequest("");
        router.refresh();
      }
    });
  }

  const attached = new Set(requests.map((request) => request.id));
  const available = props.requestOptions.filter((request) => !attached.has(request.id));

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Funding &amp; loan</h2>
      </header>

      <div className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="text-micro uppercase text-ink-muted">Funding requests</p>
            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setOutcome(null);
                  setDialog("request");
                }}
                className="ml-auto text-detail text-accent-text hover:underline"
              >
                Attach
              </button>
            ) : null}
          </div>
          {requests.length === 0 ? (
            <p className="text-detail text-ink-muted">
              Not cited by any funding request.
              {canEdit ? (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/funding/new?po=${poId}`}
                    className="text-accent-text hover:underline"
                  >
                    Start a funding request
                  </Link>{" "}
                  from this PO, or attach it to one already open.
                </>
              ) : null}
            </p>
          ) : (
            <ul className="flex flex-col gap-px">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2 rounded-row py-1 text-detail"
                >
                  <Link
                    href={`/dashboard/funding/${request.id}`}
                    className="truncate hover:underline"
                  >
                    <span className="font-bold tabular-nums">{request.requestNumber}</span>
                    <span className="text-ink-faint">
                      {" "}
                      · asked for {money(request.amountRequested)} by {request.requestedBy}
                    </span>
                  </Link>
                  <span className="text-ink-muted">
                    {FUNDING_STATUS_LABEL[request.status] ?? request.status}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => detachPOFromFunding(poId, request.id))}
                      className="text-ink-faint hover:text-ink disabled:opacity-50"
                      aria-label={`Detach from ${request.requestNumber}`}
                      title={`Detach from ${request.requestNumber}`}
                    >
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
          {requests.length > 0 && canEdit ? (
            <Link
              href={`/dashboard/funding/new?po=${poId}`}
              className="mt-1 inline-block text-detail text-accent-text hover:underline"
            >
              Start another funding request from this PO
            </Link>
          ) : null}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="text-micro uppercase text-ink-muted">Loan or lease</p>
            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setOutcome(null);
                  setPickedLease(lease?.id ?? "");
                  setDialog("lease");
                }}
                className="ml-auto text-detail text-accent-text hover:underline"
              >
                {lease ? "Change" : "Put on a lease"}
              </button>
            ) : null}
          </div>
          {lease ? (
            <Link
              href={`/dashboard/leases/${lease.id}`}
              className="block truncate text-detail hover:underline"
            >
              <span className="font-bold">{lease.leaseName}</span>
              <span className="text-ink-faint">
                {" "}
                · {lease.leaseNumber} · {lease.lender}
              </span>
            </Link>
          ) : (
            <p className="text-detail text-ink-muted">
              Not financed by a loan — received units are owned the way this PO
              says it was paid.
            </p>
          )}
        </div>

        {outcome ? (
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
        ) : null}
      </div>

      <Modal
        open={dialog === "request"}
        onOpenChange={(next) => !next && setDialog(null)}
        title="Attach to a funding request"
        blurb="The PO becomes evidence on the request — the hard figures behind the case for the money."
        footer={
          <>
            <ModalCancel />
            <ModalConfirm
              disabled={busy || !pickedRequest}
              onClick={() => run(() => attachPOToFunding(poId, pickedRequest))}
            >
              {busy ? "Attaching…" : "Attach"}
            </ModalConfirm>
          </>
        }
      >
        {available.length === 0 ? (
          <p className="text-detail text-ink-muted">
            No open funding request to attach to — declined and canceled requests
            take no more evidence.{" "}
            <Link
              href={`/dashboard/funding/new?po=${poId}`}
              className="text-accent-text hover:underline"
            >
              Start one from this PO
            </Link>
            .
          </p>
        ) : (
          <select
            value={pickedRequest}
            onChange={(event) => setPickedRequest(event.target.value)}
            aria-label="Funding request"
            className={SELECT}
          >
            <option value="">Choose a request…</option>
            {available.map((request) => (
              <option key={request.id} value={request.id}>
                {request.requestNumber} — {request.for ?? "general inventory"} ·{" "}
                {money(request.amountRequested)} ·{" "}
                {FUNDING_STATUS_LABEL[request.status] ?? request.status}
              </option>
            ))}
          </select>
        )}
      </Modal>

      <Modal
        open={dialog === "lease"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={lease ? "Change the lease" : "Put on a lease"}
        blurb="A PO on a lease is a loan purchase: its method becomes Lease or loan, and every unit received against it belongs to the lease."
        footer={
          <>
            <ModalCancel />
            <ModalConfirm
              disabled={
                busy ||
                pickedLease === (lease?.id ?? "") ||
                (!pickedLease && !clearedMethod)
              }
              onClick={() =>
                run(() => setPOLease(poId, pickedLease || null, pickedLease ? null : clearedMethod))
              }
            >
              {busy ? "Saving…" : pickedLease ? "Save" : "Take it off the lease"}
            </ModalConfirm>
          </>
        }
      >
        <select
          value={pickedLease}
          onChange={(event) => setPickedLease(event.target.value)}
          aria-label="Lease"
          className={SELECT}
        >
          <option value="">Not financed by a loan</option>
          {props.leaseOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.leaseNumber} — {option.leaseName} ({option.lender})
            </option>
          ))}
        </select>
        {lease && !pickedLease ? (
          <div className="mt-3">
            <p className="mb-[6px] text-micro uppercase text-ink-muted">Paid for instead with</p>
            <select
              value={clearedMethod}
              onChange={(event) => setClearedMethod(event.target.value)}
              aria-label="Paid for instead with"
              className={SELECT}
            >
              <option value="">Choose…</option>
              {PO_METHODS.filter((method) => method !== "LOAN").map((method) => (
                <option key={method} value={method}>
                  {PO_METHOD_LABEL[method]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-micro text-ink-faint">
              Putting it on the lease replaced the PO&rsquo;s method with Lease or
              loan, and the original was not kept — so it has to be said again.
            </p>
          </div>
        ) : null}
        {unitsReceived > 0 ? (
          <p className="mt-2 text-detail text-ink-muted">
            {unitsReceived} {unitsReceived === 1 ? "unit" : "units"} already
            received against this PO will move with it
            {pickedLease
              ? " onto the lease, owned as LOAN."
              : lease
                ? ", owned the way chosen above."
                : "."}
          </p>
        ) : null}
      </Modal>
    </section>
  );
}

const SELECT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none";
