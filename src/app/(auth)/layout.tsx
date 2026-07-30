/**
 * The signed-out route group. It deliberately has no chrome: the rail, the
 * command palette and the page header all assume a session.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
