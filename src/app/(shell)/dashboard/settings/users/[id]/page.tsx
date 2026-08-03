import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Card, CardSkeleton, Field, Unset } from "@/components/record/record-card";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { UserEditor } from "@/components/settings/user-form";
import { dayYear } from "@/lib/format";
import { isMfaEnforced } from "@/lib/mfa-enforcement";
import { getUserDetail } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { roleLabel } from "@/lib/settings/roles";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const user = await getUserDetail(id);
  return { title: user?.name ?? "Account" };
}

/**
 * Settings → Users → one account.
 *
 * The edit form and, beside it, what this person has done. The trail is not
 * decoration: the only irreversible action on this screen is Delete, and the
 * question it should raise is "whose name is on two hundred check-outs" rather
 * than "are you sure". Those rows keep the name either way — the relations are
 * not cascading — but the account that could answer for them stops existing.
 */
export default async function UserRecordPage({ params }: Params) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/login");
  if (!isAdminRole(viewer.role))
    return <SettingsDenied id="users" role={viewer.title} />;

  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) notFound();

  return (
    <>
      <SettingsHeader
        id="users"
        title={user.name}
        blurb={
          <>
            {user.email} · {roleLabel(user.role)} ·{" "}
            {user.active ? "signs in" : "invite never completed"}
          </>
        }
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card title="Account">
          <UserEditor
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              active: user.active,
            }}
            canSetAdmin={viewer.role === "SUPER_ADMIN"}
            isSelf={viewer.id === user.id}
          />
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Trail" rows={4} />}>
            <TrailCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function TrailCard({ id }: { id: string }) {
  const user = await getUserDetail(id);
  if (!user) return null;

  const enforced = isMfaEnforced();

  return (
    <Card title="Trail" meta="what this account has touched">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Orders prepared">{user.ordersPrepared}</Field>
        <Field label="Check-outs raised">{user.checkoutsCreated}</Field>
        <Field label="Check-ins handled">{user.checkinsHandled}</Field>
        <Field label="Audit entries">{user.auditEvents}</Field>
        <Field label="Last activity">
          {user.lastSeen ? (
            dayYear(user.lastSeen)
          ) : (
            // No lastLoginAt column exists; the audit log is the only record of
            // the account being used, and an account with no entries has none.
            <Unset>No entries</Unset>
          )}
        </Field>
        <Field label="Added">{dayYear(user.createdAt)}</Field>
        <Field label="Password last changed">
          {user.lastPasswordChange ? (
            dayYear(user.lastPasswordChange)
          ) : (
            <Unset>Not recorded</Unset>
          )}
        </Field>
        <Field label="Second factor">
          {!user.mfaEnabled ? (
            <Unset>Off</Unset>
          ) : enforced ? (
            user.hasTotpSecret ? "Authenticator app" : "Emailed codes"
          ) : (
            <>
              Enrolled{user.hasTotpSecret ? " (authenticator)" : " (email)"}
              <span className="text-ink-faint"> · not being asked for</span>
            </>
          )}
        </Field>
      </div>
      {user.mfaEnabled && !enforced ? (
        <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          Sign-in is email and password only on this instance, so this
          enrolment is dormant rather than protecting the account. Nothing has
          been cleared — see My profile for why.
        </p>
      ) : null}
    </Card>
  );
}
