import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { dayYear } from "@/lib/format";
import { isMfaEnforced } from "@/lib/mfa-enforcement";
import { getUserRows } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { roleLabel } from "@/lib/settings/roles";

export const metadata = { title: "Users" };

const COLUMNS: Column[] = [
  { key: "name", label: "Name", width: "minmax(0,1fr)" },
  { key: "email", label: "Email", width: "minmax(0,1.3fr)" },
  { key: "access", label: "Access", width: "120px" },
  { key: "signin", label: "Sign-in", width: "150px" },
  { key: "factor", label: "2FA", width: "100px" },
  { key: "added", label: "Added", width: "84px", align: "right" },
];

/**
 * Settings → Users.
 *
 * Who can sign in, and what each of them may do. Admin-only to open, and the
 * role column is the reason: it is the one list in the app where a wrong value
 * hands somebody the whole system.
 *
 * Two columns say things the v1 screen didn't. "Sign-in" separates an account
 * that works from an invite nobody ever completed — v1 showed a small "Pending"
 * chip beside the name, which is easy to miss on a row you are scanning for a
 * role. And "2FA" reports the stored flag alongside the fact that the login
 * screen is not currently asking for it, because on this instance those are
 * different statements (`lib/mfa-enforcement`).
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="users" role={user.title} />;

  const params = await searchParams;
  const search = params.q?.trim() ?? "";

  return (
    <>
      <SettingsHeader
        id="users"
        actions={
          <>
            <ListSearch placeholder="Search name or email" />
            <Link
              href="/dashboard/settings/users/new"
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Invite someone
            </Link>
          </>
        }
      />

      <Suspense key={search} fallback={<ListTableSkeleton />}>
        <Table search={search} selfId={user.id} />
      </Suspense>
    </>
  );
}

async function Table({ search, selfId }: { search: string; selfId: string }) {
  const users = await getUserRows(search);
  const enforced = isMfaEnforced();
  const outstanding = users.filter((row) => !row.active).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={users.length}
      footerNote={
        outstanding > 0 ? (
          <>
            {outstanding} {outstanding === 1 ? "invite" : "invites"} never
            completed
          </>
        ) : undefined
      }
      empty={
        search ? (
          <>
            Nobody matches &ldquo;{search}&rdquo;. Search runs over name and
            email only.
          </>
        ) : (
          <>
            No accounts. Invite someone to give them a way in — they choose their
            own password from the link.
          </>
        )
      }
      rows={users.map((row) => ({
        id: row.id,
        href: `/dashboard/settings/users/${row.id}`,
        // An account that was invited and never set up can't be used by
        // anybody; somebody has to either chase it or remove it.
        flagged: !row.active,
        cells: {
          name: (
            <span className="font-bold">
              {row.name}
              {row.id === selfId ? (
                <span className="font-normal text-ink-faint"> · you</span>
              ) : null}
            </span>
          ),
          email: <span className="text-ink-muted">{row.email}</span>,
          access: roleLabel(row.role),
          signin: row.active ? (
            <span className="text-ink-muted">Password set</span>
          ) : (
            <span className="font-bold text-accent-on-tint">
              Invite outstanding
            </span>
          ),
          factor: !row.mfaEnabled ? (
            <span className="text-ink-faint">Off</span>
          ) : enforced ? (
            <span className="text-ink-muted">On</span>
          ) : (
            // The flag is set but nothing asks for it — see the profile screen.
            <span className="text-ink-faint" title="Enrolled, but sign-in is not asking">
              Enrolled
            </span>
          ),
          added: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.createdAt)}
            </span>
          ),
        },
      }))}
    />
  );
}
