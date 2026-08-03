import { redirect } from "next/navigation";
import { Card } from "@/components/record/record-card";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { InviteForm } from "@/components/settings/user-form";
import { isEmailConfigured } from "@/lib/email";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Invite someone" };

/**
 * Settings → Users → invite.
 *
 * Nobody is given a password here. The account is created without one and the
 * person sets their own from a 72-hour link, so an administrator never handles
 * somebody else's credentials — that is v1's design and it is the right one.
 *
 * What is new is saying out loud that the link will not arrive. Outbound email
 * is off on this instance, so the invite email is written, fails, and is logged;
 * v1's screen would have reported success regardless. The form hands the setup
 * URL back instead (`lib/settings/invites`), and this header warns before the
 * invite is sent rather than after.
 */
export default async function InviteUserPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="users" role={user.title} />;

  const email = isEmailConfigured();

  return (
    <>
      <SettingsHeader
        id="users"
        title="Invite someone"
        blurb="They pick their own password from a link that lasts 72 hours"
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card title="New account">
          <InviteForm canSetAdmin={user.role === "SUPER_ADMIN"} />
        </Card>

        <Card title="Before you send it">
          <div className="flex flex-col gap-2 px-4 pb-4 text-body text-ink-muted">
            {email ? (
              <p>
                Outbound email is configured, so the invite goes to their inbox
                and the link is not shown here — it is a credential, and it
                belongs with the person it is for.
              </p>
            ) : (
              <p>
                <span className="text-ink">
                  Outbound email is switched off on this instance
                </span>{" "}
                (<code>RESEND_API_KEY</code> is blank), so no invite will be
                delivered. The account is still created and the setup link is
                shown here once — pass it on yourself, or the account cannot be
                used.
              </p>
            )}
            <p>
              The link expires after 72 hours and stops working the moment it is
              used. If it lapses, open the account and reissue.
            </p>
            <p>
              Access can be changed later without affecting anything the person
              has already done.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
