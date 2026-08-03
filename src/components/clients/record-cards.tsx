import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { dayYear, money, windowLabel } from "@/lib/format";
import {
  getClientContacts,
  getClientCredit,
  getClientDocuments,
  getClientInvoices,
  getClientOrders,
} from "@/lib/queries/client-record";
import { STATUS_LABEL } from "@/lib/reservations/status";

const DOC_LABEL: Record<string, string> = {
  ORDER_DETAIL: "Order detail",
  DELIVERY_NOTE: "Delivery note",
  INVOICE: "Invoice",
  PRO_FORMA: "Pro forma",
  PURCHASE_ORDER: "Purchase order",
  PROPOSAL: "Proposal",
  RENTAL_AGREEMENT: "Rental agreement",
};

const INVOICE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PAID: "Paid",
  PARTIAL: "Part paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  VOID: "Void",
};

/**
 * What this account owes.
 *
 * Owed excludes draft, cancelled and voided invoices — they carry a total but
 * nobody is waiting on the money, and someone might chase a payment from this
 * card. Overdue is counted by invoice state rather than by comparing due dates,
 * so an invoice nobody has moved to OVERDUE shows up as a process gap instead
 * of being quietly reclassified here.
 */
export async function CreditCard({ id, terms }: { id: string; terms: number }) {
  const credit = await getClientCredit(id);

  if (credit.invoiced === 0) {
    return (
      <Card title="Credit position">
        <CardEmpty>
          Nothing invoiced to this account yet. Raise an invoice from one of
          their orders and the position appears here.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card title="Credit position" meta={`${terms}-day terms`}>
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Figure label="Owed now" value={money(credit.owed)} loud />
        <Figure
          label="Overdue"
          value={money(credit.overdue)}
          note={
            credit.overdueCount > 0
              ? `${credit.overdueCount} ${credit.overdueCount === 1 ? "invoice" : "invoices"}`
              : "none"
          }
          alarm={credit.overdue > 0}
        />
        <Figure
          label="Billed"
          value={money(credit.billed)}
          note={`${credit.invoiced} sent`}
        />
        <Figure label="Paid" value={money(credit.paid)} />
      </div>
      {/* Drafts are in none of the figures — nobody has been asked for the
          money yet — so the card says how much is sitting unsent rather than
          leaving the count to disagree with the Invoices list beside it. */}
      {credit.draftCount > 0 ? (
        <p className="px-4 pb-2 text-detail text-ink-muted">
          {credit.draftCount} draft {credit.draftCount === 1 ? "invoice" : "invoices"}{" "}
          worth {money(credit.draftTotal)} not sent, and not counted above.
        </p>
      ) : null}
      <p className="px-4 pb-4 text-detail text-ink-muted">
        {credit.lastPayment ? (
          <>
            Last payment {money(credit.lastPayment.amount)} on{" "}
            {dayYear(credit.lastPayment.at)}
            {credit.lastPayment.method
              ? ` · ${credit.lastPayment.method.toLowerCase()}`
              : ""}
          </>
        ) : (
          "No payment recorded against this account."
        )}
      </p>
    </Card>
  );
}

function Figure({
  label,
  value,
  note,
  loud,
  alarm,
}: {
  label: string;
  value: string;
  note?: string;
  loud?: boolean;
  alarm?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"} ${
          alarm ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
      {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
    </div>
  );
}

export async function ContactsCard({ id }: { id: string }) {
  const contacts = await getClientContacts(id);

  return (
    <Card
      title="Contacts"
      meta={contacts.length > 0 ? `${contacts.length}` : undefined}
    >
      {contacts.length === 0 ? (
        <CardEmpty>
          No contacts on this account. Add one so delivery notes and invoices
          have somebody to go to.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="rounded-row px-2 py-[6px] text-detail"
            >
              <span className="flex items-baseline gap-2">
                <span className="truncate font-bold">{contact.name}</span>
                {contact.isPrimary ? (
                  <span className="flex-none text-micro uppercase text-accent-text">
                    Primary
                  </span>
                ) : null}
                {contact.role ? (
                  <span className="flex-none text-ink-faint">
                    {contact.role}
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-ink-muted">
                {[contact.email, contact.phone].filter(Boolean).join(" · ") || (
                  <Unset>No email or phone</Unset>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Open orders first: what is live matters more than what is finished. */
export async function OrdersCard({ id }: { id: string }) {
  const { open, recent } = await getClientOrders(id);

  if (open.length === 0 && recent.length === 0) {
    return (
      <Card title="Orders">
        <CardEmpty>
          This account has never been on an order. Build one and it appears
          here.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Orders"
      meta={
        open.length > 0
          ? `${open.length} open · ${recent.length} shown of the rest`
          : `${recent.length} shown`
      }
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {[...open, ...recent].map((order) => (
          <li key={order.id}>
            <Link
              href={`/dashboard/reservations/${order.id}`}
              className="grid grid-cols-[132px_1fr_110px_92px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold tabular-nums">
                {order.reservationNumber}
              </span>
              <span className="truncate text-ink-muted">
                {windowLabel(order.start, order.end)}
              </span>
              <span className="truncate text-ink-muted">
                {STATUS_LABEL[order.status]}
              </span>
              <span className="text-right tabular-nums">
                {money(order.total)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function InvoicesCard({ id }: { id: string }) {
  const { rows, total } = await getClientInvoices(id);

  return (
    <Card
      title="Invoices"
      meta={
        total === 0
          ? undefined
          : total > rows.length
            ? `${rows.length} of ${total} shown`
            : `all ${total} shown`
      }
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Nothing invoiced to this account. Invoices raised from their orders
          land here.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {rows.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/dashboard/invoices/${invoice.id}`}
                className="grid grid-cols-[1fr_88px_86px_90px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold">
                  {invoice.invoiceNumber}
                </span>
                <span className="truncate text-ink-muted">
                  {INVOICE_LABEL[invoice.status] ?? invoice.status}
                </span>
                <span className="truncate tabular-nums text-ink-muted">
                  {dayYear(invoice.issued)}
                </span>
                <span className="text-right tabular-nums">
                  {money(invoice.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Documents live on orders, not on clients — `Document.entityType` is
 * RESERVATION or PURCHASE_ORDER — so this gathers them across the account's
 * orders and says which order each came from. Worth being explicit about,
 * because "the client's documents" implies a filing cabinet the schema
 * doesn't have.
 */
export async function DocumentsCard({ id }: { id: string }) {
  const { rows, total } = await getClientDocuments(id);

  return (
    <Card
      title="Documents"
      meta={
        total > rows.length ? `${rows.length} of ${total} shown` : undefined
      }
    >
      {rows.length === 0 ? (
        <CardEmpty>
          No documents on this account&rsquo;s orders. Proposals, rental
          agreements and signed delivery notes appear here as they are raised.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {rows.map((document) => (
            <li key={document.id}>
              <Link
                href={`/dashboard/reservations/${document.orderId}`}
                className="grid grid-cols-[1fr_120px_96px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate">
                  <span className="font-bold">
                    {DOC_LABEL[document.type] ?? document.type}
                  </span>
                  {document.isSigned ? (
                    <span className="text-accent-text">
                      {" "}
                      · signed{document.signedBy ? ` by ${document.signedBy}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className="truncate tabular-nums text-ink-muted">
                  {document.orderNumber ?? <Unset />}
                </span>
                <span className="text-right tabular-nums text-ink-faint">
                  {dayYear(document.signedAt ?? document.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
