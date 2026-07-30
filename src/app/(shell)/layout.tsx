import { redirect } from "next/navigation";
import { NavPanel } from "@/components/shell/nav-panel";
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
      <NavPanel user={user} counts={counts} />
      <main className="flex min-w-0 flex-1 flex-col gap-3">{children}</main>
    </div>
  );
}
