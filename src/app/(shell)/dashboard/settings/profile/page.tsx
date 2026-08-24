import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  Card,
  CardEmpty,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import { PasswordForm } from "@/components/settings/password-form";
import { SettingsHeader } from "@/components/settings/settings-chrome";
import { TrustedDevices } from "@/components/settings/trusted-devices";
import { AppearanceControls } from "@/components/theme/appearance-controls";
import { dayYear } from "@/lib/format";
import { isMfaEnforced } from "@/lib/mfa-enforcement";
import { prisma } from "@/lib/prisma";
import { getTrustedDevicesFor } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "My profile" };

/**
 * Settings → My profile.
 *
 * The one settings screen everybody can open, and the only one that is about
 * the person reading it rather than about the business. Four things: who the
 * system thinks you are, your password, where the second factor stands, and how
 * you want the app to look.
 *
 * The second factor is the reason this screen needed care rather than a port.
 * v1 offers enrollment in email codes and an authenticator app; in v2 neither
 * completes — `RESEND_API_KEY` is blank so no code is delivered, and the
 * restored TOTP secrets were encrypted under v1's key. Offering the flow anyway
 * would strand somebody halfway through securing their account, so while
 * `AUTH_MFA` is off the card states the position instead. See
 * `lib/mfa-enforcement`.
 */
export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <SettingsHeader id="profile" blurb={user.email} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Account" rows={3} />}>
            <AccountCard id={user.id} name={user.name} email={user.email} title={user.title} />
          </Suspense>

          <Suspense
            fallback={<CardSkeleton title="Two-factor authentication" rows={2} />}
          >
            <SecondFactorCard id={user.id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Card
            title="Change password"
            meta="8 characters, upper and lower case, a number and a symbol"
          >
            <PasswordForm />
          </Card>

          <Card title="Appearance" meta="saved to your account, applied as you click">
            <AppearanceControls />
          </Card>
        </div>
      </div>
    </>
  );
}

async function AccountCard({
  id,
  name,
  email,
  title,
}: {
  id: string;
  name: string;
  email: string;
  title: string;
}) {
  const record = await prisma.user.findUnique({
    where: { id },
    select: { createdAt: true, passwordChangedAt: true },
  });

  return (
    <Card title="Account">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Name">{name}</Field>
        <Field label="Email">{email}</Field>
        <Field label="Access">{title}</Field>
        <Field label="On the system since">
          {record ? dayYear(record.createdAt) : <Unset />}
        </Field>
        <Field label="Password last changed">
          {record?.passwordChangedAt ? (
            dayYear(record.passwordChangedAt)
          ) : (
            // Every account restored from v1 predates the column, so "never"
            // would be a claim the data can't support.
            <Unset>Not recorded</Unset>
          )}
        </Field>
      </div>
      <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
        Your name, email and access level are set by an administrator under
        Settings → Users.
      </p>
    </Card>
  );
}

/**
 * Where the second factor stands for this account — which, with `AUTH_MFA` off,
 * is a different question from whether it is switched on.
 *
 * `mfaEnabled` on the row is left exactly as v1 set it; the login flow simply
 * stops consulting it. Showing "enabled" with no qualification would tell
 * somebody their account is protected by something that is not currently being
 * asked for.
 */
async function SecondFactorCard({ id }: { id: string }) {
  const [record, devices] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: { mfaEnabled: true, mfaSecret: true, mfaDefault: true },
    }),
    getTrustedDevicesFor(id),
  ]);

  const enforced = isMfaEnforced();
  const enabled = record?.mfaEnabled ?? false;
  const factor = record?.mfaSecret
    ? "an authenticator app"
    : "emailed codes";

  return (
    <Card
      title="Two-factor authentication"
      meta={enforced ? (enabled ? "on" : "off") : "not being asked for"}
    >
      <div className="px-4 pb-4 text-body text-ink-muted">
        {!enforced ? (
          <>
            <p className="mb-2">
              Sign-in on this instance is email and password only. The second
              factor is switched off system-wide (<code>AUTH_MFA</code>), because
              this database is a restore of the live system: the stored
              authenticator secrets were encrypted under the other instance&rsquo;s
              key and cannot be read here, and there is no outbound email to
              deliver a code.
            </p>
            <p>
              Your account is still marked{" "}
              <span className="text-ink">{enabled ? "enrolled" : "not enrolled"}</span>{" "}
              {enabled ? `in ${factor}` : ""} and nothing has been deleted — the
              login screen is not asking. Enrolment is deliberately not offered
              here while that is true, because it could not be completed.
            </p>
          </>
        ) : enabled ? (
          <p>
            On, using {factor}. Ask an administrator to reset it if you have lost
            the device.
          </p>
        ) : (
          <p>
            Off for your account. An administrator can turn it on for you — there
            is no self-service enrolment on this instance yet.
          </p>
        )}
      </div>

      {devices.length > 0 ? (
        <>
          <div className="flex items-center gap-2 px-4 pb-2">
            <h3 className="text-card-title">Trusted devices</h3>
            <span className="text-detail text-ink-muted">
              {devices.length} that would skip the code
            </span>
          </div>
          <TrustedDevices devices={devices} />
        </>
      ) : enabled ? (
        <CardEmpty>
          No trusted devices. Every sign-in would be asked for a code once the
          second factor is switched back on.
        </CardEmpty>
      ) : null}
    </Card>
  );
}
