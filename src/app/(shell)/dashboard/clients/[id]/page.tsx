import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  ContactsCard,
  CreditCard,
  DocumentsCard,
  InvoicesCard,
  OrdersCard,
} from "@/components/clients/record-cards";
import { dayYear } from "@/lib/format";
import { getClientHeader } from "@/lib/queries/client-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getClientHeader(id);
  return { title: header?.name ?? "Account" };
}

/**
 * Clients → Accounts → the record.
 *
 * The screen the order record links a client name to, and the answer to "can we
 * ship to these people, and are they paying." Credit position and the
 * requirements block lead, because those are the two things that stop an order
 * — contacts, orders and invoices are reference.
 *
 * A card per Suspense boundary: the document sweep across every one of the
 * account's orders is the slowest query here and must never hold up the
 * credit position.
 */
export default async function ClientRecordPage({ params }: Params) {
  const { id } = await params;
  const client = await getClientHeader(id);
  if (!client) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Clients · Account"
        title={client.name}
        blurb={
          <>
            {client.companyName ? `${client.companyName} · ` : ""}
            {client.orders} {client.orders === 1 ? "order" : "orders"} ·{" "}
            {client.contacts} {client.contacts === 1 ? "contact" : "contacts"} ·
            on the books since {dayYear(client.createdAt)}
          </>
        }
        actions={
          <>
            {client.taxExempt ? (
              <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
                Tax exempt
              </span>
            ) : null}
            <Link
              href={`/dashboard/orders/new?client=${client.id}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              New order
            </Link>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Credit position" rows={3} />}>
            <CreditCard id={id} terms={client.paymentTerms} />
          </Suspense>

          <Requirements client={client} />

          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Email">
                {client.email ?? <Unset>None on file</Unset>}
              </Field>
              <Field label="Phone">
                {client.phone ?? <Unset>None on file</Unset>}
              </Field>
              <Field label="Terms">{client.paymentTerms} days</Field>
              <Field label="QuickBooks">
                {client.qbCustomerId ? (
                  `Customer ${client.qbCustomerId}`
                ) : (
                  <Unset>Not linked</Unset>
                )}
              </Field>
              <Field label="Address">
                {client.address ?? <Unset>None on file</Unset>}
              </Field>
              <Field label="Billing address">
                {client.billingAddress ?? <Unset>Same as address</Unset>}
              </Field>
            </div>
            {client.notes ? (
              <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
                {client.notes}
              </p>
            ) : null}
          </Card>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Orders" rows={8} />}>
            <OrdersCard id={id} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Contacts" rows={4} />}>
            <ContactsCard id={id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Invoices" rows={8} />}>
            <InvoicesCard id={id} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Documents" rows={5} />}>
            <DocumentsCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

/**
 * The three things that gate shipping to an account: a signed rental agreement,
 * ID, and a certificate of insurance.
 *
 * Each can be waived per-account (`skipIdRequirement`, `skipCoiRequirement`),
 * and a waived requirement is shown as waived rather than as met — they are
 * different facts, and collapsing them would hide who decided what.
 */
function Requirements({
  client,
}: {
  client: NonNullable<Awaited<ReturnType<typeof getClientHeader>>>;
}) {
  const rows = [
    {
      label: "Rental agreement",
      at: client.agreementSignedAt,
      by: client.agreementSignerName,
      waived: false,
    },
    {
      label: "ID verified",
      at: client.idVerifiedAt,
      by: null,
      waived: client.skipIdRequirement,
    },
    {
      label: "Insurance (COI)",
      at: client.coiVerifiedAt,
      by: null,
      waived: client.skipCoiRequirement,
    },
  ];

  const outstanding = rows.filter((row) => !row.at && !row.waived).length;

  return (
    <Card
      title="Requirements"
      meta={
        outstanding === 0
          ? "all settled"
          : `${outstanding} outstanding`
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="truncate">
              {row.label}
              {row.by ? (
                <span className="text-ink-faint"> · {row.by}</span>
              ) : null}
            </span>
            {row.at ? (
              <span className="tabular-nums text-ink-muted">
                {dayYear(row.at)}
              </span>
            ) : row.waived ? (
              <span className="text-ink-faint">Waived</span>
            ) : (
              <span className="font-bold text-destructive">Outstanding</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
