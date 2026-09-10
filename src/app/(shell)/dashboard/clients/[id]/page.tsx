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
import { RequirementsCard } from "@/components/clients/requirements-card";
import { dayYear } from "@/lib/format";
import { getClientHeader } from "@/lib/queries/client-record";
import { readTemplateMeta } from "@/lib/requirements/store";
import { getSessionUser } from "@/lib/roles";

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
  const [client, viewer, template] = await Promise.all([
    getClientHeader(id),
    getSessionUser(),
    // Read here rather than inside the card: the card is a client component and
    // cannot reach the document store, and whether a template exists changes
    // what the "ask for documents" dialog is allowed to promise.
    readTemplateMeta(),
  ]);
  if (!client) notFound();

  const role = viewer?.role;

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

          <RequirementsCard
            clientId={client.id}
            clientName={client.name}
            clientEmail={client.email}
            agreementSignedAt={client.agreementSignedAt}
            agreementSignerName={client.agreementSignerName}
            idVerifiedAt={client.idVerifiedAt}
            coiVerifiedAt={client.coiVerifiedAt}
            skipIdRequirement={client.skipIdRequirement}
            skipCoiRequirement={client.skipCoiRequirement}
            hasTemplate={!!template}
            canRequest={
              role === "SUPER_ADMIN" || role === "ADMIN" || role === "STAFF"
            }
            canWaive={role === "SUPER_ADMIN" || role === "ADMIN"}
          />

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
