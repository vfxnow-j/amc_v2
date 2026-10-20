import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/roles";
import { EntityAccessError, listEntitiesFor, requireEntity } from "@/lib/entities/context";
import { EntityNav } from "@/components/entities/entity-nav";
import { EntityDenied } from "@/components/entities/entity-denied";

/**
 * The entity shell: outside the (shell) group, so it gets the root layout but
 * not the main rail. Access is re-checked from the URL's slug on every request;
 * a cookie or a remembered "current entity" is never consulted.
 */
export default async function EntityLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  let ctx;
  try {
    ctx = await requireEntity(slug);
  } catch (error) {
    if (error instanceof EntityAccessError) return <EntityDenied message={error.message} />;
    throw error;
  }
  const entities = await listEntitiesFor(user.id);

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-ground p-3">
      <EntityNav user={user} slug={slug} name={ctx.entity.name} entities={entities} canWrite={ctx.canWrite} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">{children}</main>
    </div>
  );
}
