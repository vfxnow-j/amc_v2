import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/actions/audit";

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

/** Which of these ids are real locations. Read-only. */
export async function existingLocationIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = await prisma.location.findMany({ where: { id: { in: unique } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * Finds or creates a destination site (a real VFXnow location) on the spot
 * during a release. This is the single write from entity code into the main
 * database; everything else in this file only reads.
 *
 * It follows the main app's createLocation rules: the name is matched
 * case-insensitively, so releasing again to "stage 9" reuses "Stage 9" (and a
 * site left behind by a failed movement is reused, not duplicated), and a new
 * site gets an audit entry attributed to the acting user. Length caps are the
 * schema's (120 / 300). The main action also revalidates
 * /dashboard/settings/locations and /dashboard/assets; so does this.
 * Authorization is the caller's: the entity action has already required write
 * access, which is a role the main app's requireEditor also accepts (it is not
 * re-run here because it would need a second session lookup).
 */
export async function createSite(name: string, address: string | undefined, actorUserId: string) {
  const clean = name.trim();
  if (!clean || clean.length > 120) throw new Error("A site name must be 1 to 120 characters.");
  const addr = address?.trim() || null;
  if (addr && addr.length > 300) throw new Error("A site address must be 300 characters or fewer.");
  const existing = await prisma.location.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, select: { id: true } });
  if (existing) return existing.id;
  const site = await prisma.location.create({ data: { name: clean, address: addr } });
  await logAudit({
    action: "CREATE", entityType: "Location", entityId: site.id, userId: actorUserId,
    newValues: { name: site.name, address: site.address, source: "entity release" },
  });
  revalidatePath("/dashboard/settings/locations");
  revalidatePath("/dashboard/assets");
  return site.id;
}
