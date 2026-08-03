import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NavPanel } from "@/components/shell/nav-panel";
import { NotificationBell } from "@/components/shell/notification-bell";
import { NotificationBellSlot } from "@/components/shell/notification-bell-slot";
import { getNavCounts } from "@/lib/queries/nav-counts";
import { getSessionUser } from "@/lib/roles";

/**
 * The application shell every routed screen inherits: the rail on the left, a
 * content column on the right.
 *
 * Nothing touches the viewport edge — the ground colour does the separating.
 * There are no borders in this direction: surface, radius and shadow only.
 *
 * The session check here is the real boundary. `proxy.ts` redirects anonymous
 * requests one layer earlier, but per next/docs "Proxy" that is an optimistic
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

  const counts = await getNavCounts();

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-ground p-3">
      <NavPanel
        user={user}
        counts={counts}
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
      <main className="flex min-w-0 flex-1 flex-col gap-3">{children}</main>
    </div>
  );
}
