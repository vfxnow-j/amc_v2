import { prisma } from "@/lib/prisma";

/**
 * Entity code's only reach into the main database: read-only name lookups,
 * plus createSite below, which is the ONE write from entity code to the main
 * database.
 */

/** Warehouse locations and customer sites, as a flat list with a readable path. */
export async function locationOptions() {
  const rows = await prisma.location.findMany({ select: { id: true, name: true, parentLocationId: true }, orderBy: { name: "asc" } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (id: string): string => {
    const names: string[] = [];
    for (let at = byId.get(id), guard = 0; at && guard < 8; at = at.parentLocationId ? byId.get(at.parentLocationId) : undefined, guard++) names.unshift(at.name);
    return names.join(" / ");
  };
  return rows.map((r) => ({ id: r.id, name: r.name, path: pathOf(r.id) })).sort((a, b) => a.path.localeCompare(b.path));
}

export async function locationNames(ids: string[]) {
  const rows = await prisma.location.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function userNames(ids: string[]) {
  const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Creates a destination site (a real VFXnow location) on the spot during a
 * release. This is the single write from entity code into the main database;
 * everything else in this file only reads.
 */
export async function createSite(name: string, address?: string) {
  const site = await prisma.location.create({ data: { name: name.trim(), address: address?.trim() || null } });
  return site.id;
}
