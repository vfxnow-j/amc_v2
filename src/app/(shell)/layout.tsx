import { NavPanel } from "@/components/shell/nav-panel";
import { getSessionUser } from "@/lib/roles";

/**
 * The application shell every routed screen inherits: the rail on the left, a
 * content column on the right.
 *
 * Nothing touches the viewport edge — the ground colour does the separating.
 * There are no borders in this direction: surface, radius and shadow only.
 */
export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = getSessionUser();

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-ground p-3">
      <NavPanel user={user} />
      <main className="flex min-w-0 flex-1 flex-col gap-3">{children}</main>
    </div>
  );
}
