import { AuthShell, SECONDARY_CLASS } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/roles";
import { signOutAction } from "@/lib/actions/session";

export const metadata = { title: "No access" };

/**
 * Where a FLOW_USER lands. Flow was dropped from v2 along with its rail entry
 * (see the comment on SETTINGS_PAGE in lib/nav/clusters.ts), so these accounts
 * have no destination here — and bouncing them to /login would loop, because
 * they are signed in perfectly well.
 */
export default async function NoAccessPage() {
  const user = await getSessionUser();

  return (
    <AuthShell
      title="Nothing here for this account"
      blurb="Flow isn’t part of AMC v2."
    >
      <p className="mb-5 text-body text-ink-muted">
        {user ? `${user.name} is a ` : "This account is a "}
        Flow user. The task area those accounts use lives on the v1 instance,
        port 3000 — v2 doesn’t rebuild it. If you need access to AMC itself, ask
        an administrator to change the role on your account.
      </p>
      <form action={signOutAction}>
        <button type="submit" className={SECONDARY_CLASS}>
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
