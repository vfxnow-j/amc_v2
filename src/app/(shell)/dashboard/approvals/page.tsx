import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { PlaceholderLeaseHost } from "@/components/procurement/placeholder-lease-prompt";
import { queueFor, type QueueItem } from "@/lib/approvals/core";
import { APPROVAL_TYPE_LABEL, APPROVAL_TYPE_NOUN } from "@/lib/approvals/labels";
import { dayYear, moneyExact } from "@/lib/format";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "Approvals" };

/**
 * Procurement → Approvals (docs/procurement.md, Phase 6).
 *
 * One list of everything waiting on the signed-in approver — purchase orders,
 * funding requests and client quotes together, oldest first, because the
 * oldest ask is the one somebody has been waiting on longest. Each row carries
 * enough to decide from (who asked, what for, who the money goes to, how much,
 * and whether the figure moved since it was asked) and the decision itself, so
 * the common case never needs the record opened; the record is one click away
 * for the rest.
 *
 * Their own requests are not here: nobody decides a request they raised. The
 * rail shows this page only to approvers, and the page says so to anyone else
 * who lands on it.
 */
export default async function ApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { types, items, ownWaiting } = await queueFor(user);

  if (types.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Procurement" title="Approvals" />
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            You don&rsquo;t approve anything, so nothing waits on you here. A super
            admin names approvers under Settings → Users.
            {ownWaiting > 0
              ? ` ${ownWaiting} ${ownWaiting === 1 ? "request you raised is" : "requests you raised are"} waiting on an approver — each record says who.`
              : ""}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Approvals"
        blurb={
          <>
            {items.length === 0
              ? "Nothing waiting on you"
              : `${items.length} waiting on you, oldest first`}
            {" · you approve "}
            {types.map((type) => APPROVAL_TYPE_LABEL[type].toLowerCase()).join(", ")}
            {ownWaiting > 0 ? ` · ${ownWaiting} of your own waiting on someone else` : ""}
          </>
        }
      />

      {/* Approving a funding request offers a placeholder lease; the host keeps
          that question on screen after the approved row leaves the list. */}
      <PlaceholderLeaseHost>
      {items.length === 0 ? (
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            Nothing is waiting on you. A request lands here when someone who
            doesn&rsquo;t approve{" "}
            {types.map((type) => `${APPROVAL_TYPE_NOUN[type]}s`).join(", ")} submits one,
            or changes the money on one that was approved. You are told in the app
            and by email when it does.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
      </PlaceholderLeaseHost>
    </>
  );
}

function Row({ item }: { item: QueueItem }) {
  const age = item.waitingDays;
  const moved = Math.round(item.currentAmount * 100) !== Math.round(item.amountAtRequest * 100);
  return (
    <li className="grid gap-3 rounded-card bg-panel p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-micro uppercase text-ink-muted">
          {APPROVAL_TYPE_NOUN[item.recordType]} · waiting{" "}
          {age === 0 ? "since today" : age === 1 ? "1 day" : `${age} days`}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link href={item.href} className="text-card-title text-accent-text hover:underline">
            {item.label}
          </Link>
          {item.party ? (
            <span className="text-body text-ink-muted">
              {item.party.label} · {item.party.value}
            </span>
          ) : null}
          <span className="ml-auto text-[20px] font-bold tabular-nums tracking-[-0.02em]">
            {moneyExact(item.currentAmount)}
          </span>
        </p>
        <p className="text-detail text-ink-muted">
          Asked by {item.requestedByName} on {dayYear(item.requestedAt)}
          {item.note ? ` — ${item.note}` : ""}
        </p>
        {moved ? (
          <p className="text-detail text-accent-text">
            Asked at {moneyExact(item.amountAtRequest)}; it has changed since. Deciding
            renews the ask at today&rsquo;s figure — open the record first.
          </p>
        ) : null}
        {item.why ? (
          <p className="line-clamp-3 whitespace-pre-line text-detail text-ink">{item.why}</p>
        ) : null}
      </div>
      <div className="flex flex-col justify-center">
        <ApprovalDecision
          requestId={item.id}
          label={item.label}
          amount={moneyExact(item.currentAmount)}
          requestedBy={item.requestedByName}
          compact
          placeholderLeaseFor={item.recordType === "FUNDING_REQUEST" ? item.recordId : undefined}
        />
      </div>
    </li>
  );
}
