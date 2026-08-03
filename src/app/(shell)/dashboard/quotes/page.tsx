import { Suspense } from "react";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { daysUntil, dayYear, money, windowLabel } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/reservations/status";
import { getQuoteHeaderStats, getQuotes } from "@/lib/queries/clients";

export const metadata = { title: "Quotes" };

/** Quote · Client · Window · Value · Sent · Expires · State */
const COLUMNS: Column[] = [
  { key: "number", label: "Quote", width: "136px" },
  { key: "client", label: "Client", width: "minmax(0,1.4fr)" },
  { key: "window", label: "Window", width: "144px" },
  { key: "value", label: "Value", width: "96px", align: "right" },
  { key: "sent", label: "Sent", width: "88px" },
  { key: "expires", label: "Expires", width: "128px" },
  { key: "status", label: "State", width: "112px" },
];

/**
 * How long a quote has left, in words. Returns null when the quote has no
 * expiry date — that means no link was ever generated, which is a different
 * thing from "never expires" and must not be shown as a deadline.
 */
function expiryLabel(expiresAt: Date | null) {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt);
  if (days < 0) return { text: `Expired ${dayYear(expiresAt)}`, urgent: true };
  if (days === 0) return { text: "Expires today", urgent: true };
  if (days === 1) return { text: "Expires tomorrow", urgent: true };
  if (days <= 7) return { text: `${days} days left`, urgent: true };
  return { text: dayYear(expiresAt), urgent: false };
}

async function HeaderBlurb() {
  const { live, expiring } = await getQuoteHeaderStats();
  return (
    <>
      {live} live {live === 1 ? "quote" : "quotes"}
      {expiring > 0 ? (
        <>
          {" · "}
          <span className="text-accent-text">
            {expiring} expiring within a week
          </span>
        </>
      ) : null}
    </>
  );
}

async function Table({ search, page }: { search: string; page: number }) {
  const { rows, total, pageSize } = await getQuotes({ search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/quotes?${query}` : "/dashboard/quotes";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        search ? (
          <>No quote matches &ldquo;{search}&rdquo;.</>
        ) : (
          <>
            No quotes in play. Build an order and send it for approval — it stays
            here until the client accepts or it lapses.
          </>
        )
      }
      rows={rows.map((row) => {
        const expiry = expiryLabel(row.expiresAt);
        return {
          id: row.id,
          href: `/dashboard/reservations/${row.id}`,
          flagged: expiry?.urgent ?? false,
          cells: {
            number: (
              <span className="font-bold tabular-nums">
                {row.reservationNumber}
              </span>
            ),
            client: (
              <span className="truncate">
                {row.clientName}
                {row.projectName ? (
                  <span className="text-ink-faint"> · {row.projectName}</span>
                ) : null}
              </span>
            ),
            window: (
              <span className="tabular-nums text-ink-muted">
                {windowLabel(row.start, row.end)}
              </span>
            ),
            value: money(row.value),
            sent: (
              <span className="tabular-nums text-ink-muted">
                {row.sentAt ? dayYear(row.sentAt) : "—"}
              </span>
            ),
            expires: expiry ? (
              <span
                className={
                  expiry.urgent
                    ? "font-bold text-accent-text"
                    : "tabular-nums text-ink-muted"
                }
              >
                {expiry.text}
              </span>
            ) : (
              // No date means no quote link has been generated, which is not
              // the same as "no deadline".
              <span className="text-ink-faint">No link sent</span>
            ),
            status: (
              <span className="text-ink-muted">
                {STATUS_LABEL[row.status]}
                {row.viewed ? (
                  <span className="text-ink-faint"> · opened</span>
                ) : null}
              </span>
            ),
          },
        };
      })}
    />
  );
}

/**
 * Clients → Quotes: Reservations at quote stage, not a model of their own.
 *
 * The public portal at `/quote/[token]` is unchanged and deliberately not part
 * of this rail — it is what the client sees, this is what the desk sees.
 *
 * The countdown reads `quoteExpiresAt`, the date quoted pricing stops being
 * honoured. Quotes without one have never had a link generated; they read "No
 * link sent" rather than being given an invented deadline. Resend and approve
 * are deferred with the other actions in this breadth pass — rows open the
 * order, where both already work.
 */
export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Quotes"
        blurb={
          <Suspense fallback="Counting live quotes…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search quote, client, project" />}
      />

      <Suspense key={`${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table search={search} page={page} />
      </Suspense>
    </>
  );
}
