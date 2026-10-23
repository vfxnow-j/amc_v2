import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Unset } from "@/components/record/record-card";
import { ContactRowActions } from "@/components/clients/contact-editor";
import { EmailApprovalToggle } from "@/components/clients/email-approval-toggle";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear } from "@/lib/format";
import { getContact } from "@/lib/queries/contacts";
import { getSessionUser } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getContact(id))?.name ?? "Contact" };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-detail">{children}</span>
    </div>
  );
}

/**
 * Clients → Contacts → one person.
 *
 * The contact is the person; the account (company or individual) is where
 * terms, billing and orders live, so this page says which account they belong
 * to and links back to it. Edit and delete are here; so is the email approval.
 */
export default async function ContactPage({ params }: Params) {
  const { id } = await params;
  const [contact, user] = await Promise.all([getContact(id), getSessionUser()]);
  if (!contact) notFound();

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const canManage = isAdmin || user?.role === "STAFF";
  const account = contact.client;
  const accountName = account.companyName?.trim() || account.name;

  return (
    <>
      <PageHeader
        eyebrow="Clients · Contact"
        title={contact.name}
        blurb={
          <>
            {contact.role ?? "Contact"}
            {contact.isPrimary ? " · Primary" : ""} at{" "}
            <Link href={`/dashboard/clients/${account.id}`} className="underline">
              {accountName}
            </Link>
          </>
        }
        actions={
          canManage ? (
            <ContactRowActions
              afterDeleteGoTo="/dashboard/clients/contacts"
              contact={{
                id: contact.id,
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                role: contact.role,
                isPrimary: contact.isPrimary,
              }}
            />
          ) : null
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Contact">
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <Field label="Email">
              {contact.email ?? <Unset>None on file</Unset>}
              <EmailApprovalToggle
                kind="contact"
                id={contact.id}
                approved={contact.emailApproved}
                canEdit={isAdmin}
                hasEmail={!!contact.email}
              />
            </Field>
            <Field label="Phone">{contact.phone ?? <Unset>None on file</Unset>}</Field>
            <Field label="Role">{contact.role ?? <Unset>Not set</Unset>}</Field>
            <Field label="Primary">{contact.isPrimary ? "Yes" : "No"}</Field>
            <Field label="Added">{dayYear(contact.createdAt)}</Field>
            <Field label="Last changed">{dayYear(contact.updatedAt)}</Field>
          </div>
          {contact.notes ? (
            <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
              {contact.notes}
            </p>
          ) : null}
        </Card>

        <Card
          title="Account"
          action={
            <Link href={`/dashboard/clients/${account.id}`} className="text-detail text-ink-muted hover:underline">
              Open account
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <Field label="Account">{account.name}</Field>
            <Field label="Company">{account.companyName ?? <Unset>None</Unset>}</Field>
            <Field label="Account email">{account.email ?? <Unset>None on file</Unset>}</Field>
            <Field label="Terms">Net {account.paymentTerms}</Field>
            <Field label="Contacts">{account._count.contacts}</Field>
            <Field label="Orders">{account._count.reservations}</Field>
          </div>
        </Card>
      </div>
    </>
  );
}
