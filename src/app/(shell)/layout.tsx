import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NavPanel } from "@/components/shell/nav-panel";
import { NotificationBell } from "@/components/shell/notification-bell";
import { NotificationBellSlot } from "@/components/shell/notification-bell-slot";
import { getNavCounts } from "@/lib/queries/nav-counts";
import { getSessionUser } from "@/lib/roles";
import { pendingCountFor } from "@/lib/approvals/core";

/**
 * The application shell every routed screen inherits: the rail on the left, a
 * content column on the right.
 *
 * Nothing touches the viewport edge — the ground color does the separating.
 * There are no borders in this direction: surface, radius and shadow only.
 *
 * The session check here is the real boundary. `proxy.ts` redirects anonymous
 * requests one layer earlier, but per next/docs "Proxy" that is an optimiztic
 * check, not authorization — so the shell refuses to render without a session
 * regardless of what got past the proxy.
 */
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Approving is a per-user tag, not a role, so the shell asks once per render:
  // null means this person approves nothing and the Approvals page stays out of
  // their rail; a number is what is waiting on them. SUPER_ADMIN costs one count;
  // everyone else one indexed lookup of their scopes first.
  const [counts, waiting] = await Promise.all([getNavCounts(), pendingCountFor(user)]);
  if (waiting !== null && waiting > 0) counts.pages.approvals = waiting;

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-ground p-3">
      <NavPanel
        user={user}
        counts={counts}
        approver={waiting !== null}
        // Its own boundary, because this layout renders on every authenticated
        // route: a slow notification count here would be a slow app everywhere.
        // The fallback is the same bell without a badge, so nothing moves when
        // the number lands.
        bell={
          <Suspense fallback={<NotificationBell count={null} />}>
            <NotificationBellSlot userId={user.id} />
          </Suspense>
        }
      />
      {/* Scrolls itself, now that the page does not. `min-h-0` so a tall child
          cannot push the main column past the viewport instead of scrolling. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
