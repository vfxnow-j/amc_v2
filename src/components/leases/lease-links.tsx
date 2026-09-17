"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, X } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import {
  findLinkable,
  linkToLease,
  unlinkFromLease,
  type LinkKind,
  type LinkOutcome,
} from "@/lib/actions/lease-links";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit" });

type Doc = { id: string; filename: string };
type FundingRow = {
  id: string;
  number: string;
  status: string;
  purpose: string | null;
  requested: number;
  borrowed: number | null;
  date: string;
  documents: Doc[];
};
type PoRow = { id: string; number: string; status: string; vendor: string; total: number; date: string; documents: Doc[] };

const label = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");

/**
 * What this lease financed: the funding requests it funded and the purchase
 * orders drawn against it, each with its PDFs. Link one by searching its number,
 * purpose or vendor; a record already on another lease moves here.
 */
export function LeaseLinks({
  leaseId,
  fundingRequests,
  purchaseOrders,
}: {
  leaseId: string;
  fundingRequests: FundingRow[];
  purchaseOrders: PoRow[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<LinkOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<LinkOutcome>) {
    startTransition(async () => {
      const result = await action();
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      {outcome ? <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice> : null}

      <section>
        <h3 className="mb-1 text-micro uppercase text-ink-muted">Funding requests · {fundingRequests.length}</h3>
        {fundingRequests.length === 0 ? (
          <p className="text-detail text-ink-faint">None linked.</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {fundingRequests.map((row) => (
              <Row
                key={row.id}
                href={`/dashboard/funding/${row.id}`}
                number={row.number}
                detail={`${label(row.status)} · ${row.purpose ?? "no purpose recorded"}`}
                amount={row.borrowed ?? row.requested}
                amountNote={row.borrowed === null ? "requested" : "borrowed"}
                date={row.date}
                documents={row.documents}
                busy={busy}
                onUnlink={() => run(() => unlinkFromLease(leaseId, "fundingRequest", row.id))}
              />
            ))}
          </ul>
        )}
        <Picker leaseId={leaseId} kind="fundingRequest" busy={busy} run={run} />
      </section>

      <section>
        <h3 className="mb-1 text-micro uppercase text-ink-muted">Purchase orders · {purchaseOrders.length}</h3>
        {purchaseOrders.length === 0 ? (
          <p className="text-detail text-ink-faint">None linked.</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {purchaseOrders.map((row) => (
              <Row
                key={row.id}
                href={`/dashboard/purchase-orders/${row.id}`}
                number={row.number}
                detail={`${label(row.status)} · ${row.vendor}`}
                amount={row.total}
                amountNote="total"
                date={row.date}
                documents={row.documents}
                busy={busy}
                onUnlink={() => run(() => unlinkFromLease(leaseId, "purchaseOrder", row.id))}
              />
            ))}
          </ul>
        )}
        <Picker leaseId={leaseId} kind="purchaseOrder" busy={busy} run={run} />
      </section>
    </div>
  );
}

function Row({
  href,
  number,
  detail,
  amount,
  amountNote,
  date,
  documents,
  busy,
  onUnlink,
}: {
  href: string;
  number: string;
  detail: string;
  amount: number;
  amountNote: string;
  date: string;
  documents: Doc[];
  busy: boolean;
  onUnlink: () => void;
}) {
  return (
    <li className="rounded-row px-2 py-[6px] text-detail odd:bg-row-alt">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_20px] items-baseline gap-2">
        <span className="min-w-0 truncate">
          <Link href={href} className="font-bold hover:underline">
            {number}
          </Link>
          <span className="text-ink-muted"> · {detail}</span>
        </span>
        <span className="tabular-nums">
          {MONEY.format(amount)} <span className="text-ink-faint">{amountNote} · {DAY.format(new Date(date))}</span>
        </span>
        <button type="button" disabled={busy} aria-label={`Unlink ${number}`} onClick={onUnlink} className="text-ink-faint hover:text-destructive">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {documents.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {documents.map((doc) => (
            <a
              key={doc.id}
              href={`/api/documents/${doc.id}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1 rounded-pill bg-sunken px-2 py-[1px] text-micro text-ink hover:bg-row-hover"
            >
              <FileText className="size-3" aria-hidden /> {doc.filename}
            </a>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Picker({
  leaseId,
  kind,
  busy,
  run,
}: {
  leaseId: string;
  kind: LinkKind;
  busy: boolean;
  run: (action: () => Promise<LinkOutcome>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof findLinkable>>>([]);
  const latest = useRef(0);
  const noun = kind === "fundingRequest" ? "funding request" : "purchase order";

  useEffect(() => {
    if (!open) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = query.trim().length >= 2 ? await findLinkable(leaseId, kind, query) : [];
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [open, query, leaseId, kind]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        <Plus className="size-[13px]" aria-hidden /> Link a {noun}
      </button>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <input
          id={`link-${kind}`}
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "fundingRequest" ? "Search FR number, purpose, requester" : "Search PO number or vendor"}
          className="h-8 min-w-0 flex-1 rounded-well border border-hairline bg-sunken px-2 text-detail outline-none placeholder:text-ink-faint"
        />
        <button type="button" onClick={() => { setOpen(false); setQuery(""); setHits([]); }} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
          Done
        </button>
      </div>
      {hits.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-px rounded-well bg-sunken p-1">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                disabled={busy || hit.onLease === "this"}
                onClick={() => run(() => linkToLease(leaseId, kind, hit.id))}
                className="flex w-full items-baseline gap-2 rounded-row px-2 py-[5px] text-left text-detail hover:bg-row-hover disabled:opacity-50"
              >
                <span className="font-bold">{hit.label}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{hit.detail}</span>
                <span className="tabular-nums text-ink-faint">{MONEY.format(hit.amount)}</span>
                <span className="text-micro text-ink-faint">
                  {hit.onLease === "this" ? "linked" : hit.onLease ? `on ${hit.onLease}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
