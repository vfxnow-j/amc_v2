/** Pure rules for the entity rail and the movement list. No imports from the entity client. */

export type EntityNavItem = { label: string; href: string; exact: boolean; writeOnly: boolean };

export function entityNavItems(slug: string, canWrite: boolean): EntityNavItem[] {
  const base = `/entity/${slug}`;
  const all: EntityNavItem[] = [
    { label: "Dashboard", href: base, exact: true, writeOnly: false },
    { label: "Inventory", href: `${base}/inventory`, exact: false, writeOnly: false },
    { label: "Receive", href: `${base}/receive`, exact: false, writeOnly: true },
    { label: "Release & return", href: `${base}/release`, exact: false, writeOnly: true },
    { label: "Movement log", href: `${base}/log`, exact: false, writeOnly: false },
    { label: "Locations", href: `${base}/locations`, exact: false, writeOnly: false },
  ];
  return all.filter((i) => canWrite || !i.writeOnly);
}

export function isNavActive(pathname: string, item: Pick<EntityNavItem, "href" | "exact">): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
}

export function otherEntities<T extends { slug: string }>(entities: T[], slug: string): T[] {
  return entities.filter((e) => e.slug !== slug);
}

/** What to call a ledger row. A correction is a zero-quantity MOVE that points at the row it fixes. */
export function movementLabel(m: { type: string; quantity: number; correctsId: string | null; finalToOwner: boolean }): string {
  if (m.correctsId) return "Correction";
  if (m.type === "RELEASE" && m.finalToOwner) return "Returned to owner";
  return m.type.charAt(0) + m.type.slice(1).toLowerCase();
}
