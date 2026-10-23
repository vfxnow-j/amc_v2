import { Suspense } from "react";
import Link from "next/link";
import { ListSearch } from "@/components/list/list-search";
import { ListTable, ListTableSkeleton, type Column } from "@/components/list/list-table";
import { EmailApprovalToggle } from "@/components/clients/email-approval-toggle";
import { AddContactButton, ContactRowActions } from "@/components/clients/contact-editor";
import { PageHeader } from "@/components/shell/page-header";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { getContactRows } from "@/lib/queries/contacts";

export const metadata = { title: "Contacts" };

const PAGE_SIZE = 40;

/** Contact · Account · Role · Email · Phone · Email approval */
const COLUMNS: Column[] = [
  { key: "name", label: "Contact", width: "minmax(0,1.1fr)" },
  { key: "account", label: "Account", width: "minmax(0,1.1fr)" },
  { key: "role", label: "Role", width: "110px" },
  { key: "email", label: "Email", width: "minmax(0,1.3fr)" },
  { key: "phone", label: "Phone", width: "120px" },
  { key: "approval", label: "Email approval", width: "minmax(0,1fr)" },
  { key: "actions", label: "", width: "120px" },
];

async function Table({ search, page }: { search: string; page: number }) {
  const [all, user] = await Promise.all([getContactRows(search), getSessionUser()]);
  const canEdit = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const canManage = canEdit || user?.role === "STAFF";
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/clients/contacts?${query}` : "/dashboard/clients/contacts";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={all.length}
      page={page}
      pageSize={PAGE_SIZE}
      pagination={{ page, pages, hrefFor }}
      empty={search ? <>No contact matches &ldquo;{search}&rdquo;.</> : <>No contacts yet. Add them from an account.</>}
      rows={rows.map((row) => ({
        id: row.id,
        cells: {
          name: (
            <Link href={`/dashboard/clients/contacts/${row.id}`} className="font-bold hover:underline">
              {row.name}
              {row.isPrimary ? <span className="font-normal text-accent-text"> · Primary</span> : null}
            </Link>
          ),
          account: (
            <Link href={`/dashboard/clients/${row.clientId}`} className="text-ink-muted hover:underline">
              {row.account}
            </Link>
          ),
          role: <span className="text-ink-muted">{row.role ?? "—"}</span>,
          email: <span className="text-ink-muted">{row.email ?? <span className="text-ink-faint">No email</span>}</span>,
          phone: <span className="text-ink-muted">{row.phone ?? "—"}</span>,
          actions: canManage ? (
            <ContactRowActions
              contact={{
                id: row.id,
                name: row.name,
                email: row.email,
                phone: row.phone,
                role: row.role,
                isPrimary: row.isPrimary,
              }}
            />
          ) : null,
          approval: row.email ? (
            <EmailApprovalToggle
              kind="contact"
              id={row.id}
              approved={row.emailApproved}
              canEdit={canEdit}
              hasEmail
            />
          ) : (
            <span className="text-ink-faint">—</span>
          ),
        },
      }))}
    />
  );
}

/**
 * Clients → Contacts.
 *
 * The people at each account (an account is the company or individual),
 * contact-first, with the "approved for email" switch (admins only). The same switch sits on
 * the client record; this is the one place to see all of them at once.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const user = await getSessionUser();
  const manage = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" || user?.role === "STAFF";
  const accounts = manage
    ? (
        await prisma.client.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, companyName: true },
        })
      ).map((client) => ({
        id: client.id,
        label:
          client.companyName && client.companyName !== client.name
            ? `${client.companyName} (${client.name})`
            : client.name,
      }))
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Contacts"
        blurb="The people at each account. An account's own email is managed on the account. Mail goes only to addresses an admin has approved."
        actions={
          <>
            <ListSearch placeholder="Search contact, account, email" />
            {accounts ? <AddContactButton accounts={accounts} solid /> : null}
          </>
        }
      />
      <Suspense key={`${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table search={search} page={page} />
      </Suspense>
    </>
  );
}
