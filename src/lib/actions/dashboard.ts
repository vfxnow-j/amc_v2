"use server";

import { revalidatePath } from "next/cache";
import type { UserRole } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth-utils";
import { readAccent } from "@/lib/dashboard/accents";
import { isTileId } from "@/lib/dashboard/catalog";
import { readTiles, serializeTiles } from "@/lib/dashboard/layout";
import { canUseView } from "@/lib/dashboard/store";
import { isViewKey, slugifyViewKey } from "@/lib/dashboard/views";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { logAudit } from "./audit";

/**
 * Writing the dashboard: a user's own shape, and an administrator's views.
 *
 * **Deliberately not exported from `lib/actions/index.ts`.** The barrel is
 * imported by screens that have nothing to do with the dashboard, and every
 * name in it is a module the bundler has to reach; the plan calls this out
 * explicitly and it costs nothing to import this file by its own path.
 *
 * Nothing but async functions lives here, and that is not tidiness. A
 * `"use server"` module may export only async functions: a const table or a
 * type alias in one typechecks, lints and runs in dev, then fails the
 * production build. The shapes these actions take come from
 * `lib/dashboard/layout` and `lib/dashboard/views`, which are plain modules for
 * that reason. `lib/settings/pages.ts` records the same trap.
 *
 * Every one of these re-validates its input against the catalog rather than
 * trusting the caller. A server action is a public HTTP endpoint with a
 * generated name, so "the canvas would never send that" is not a check.
 */

/* ── One user's own shape ────────────────────────────────────────────────── */

/**
 * Save the signed-in user's layout for one view.
 *
 * Explicit, never autosaved — the canvas holds the change until somebody
 * commits it. That is a product decision (a dashboard that rearranges itself
 * because you brushed a tile is a dashboard you stop trusting) and it is also
 * why this takes a whole layout rather than a delta: one write, one audit
 * point, and no way for a half-applied sequence to leave a shape nobody chose.
 *
 * `tiles` arrives as `unknown` and goes through the same reader the render path
 * uses, so a tile the user may not see cannot be stored by sending it here, and
 * geometry is clamped before it is written rather than after it is read.
 */
export async function saveDashboardLayout(
  viewKey: string,
  tiles: unknown,
): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");

  if (!(await canUseView(viewKey, user.role))) {
    throw new Error("That dashboard view is not available to you.");
  }

  const placed = serializeTiles(readTiles(tiles, user.role));
  if (placed.length === 0) {
    // An empty save is almost always a bug on the way in, and it would render
    // as a blank dashboard with no obvious way back. Removing every tile is
    // spelled "reset", which restores the view rather than storing nothing.
    throw new Error("A dashboard needs at least one tile. Reset it instead.");
  }

  await prisma.dashboardLayout.upsert({
    where: { userId_templateKey: { userId: user.id, templateKey: viewKey } },
    create: { userId: user.id, templateKey: viewKey, tiles: placed },
    update: { tiles: placed },
  });

  revalidatePath("/dashboard");
}

/**
 * Throw away this user's copy of a view and fall back to the template.
 *
 * A delete rather than a write of the template's tiles: absent means "the
 * template as-is", so a reset user keeps following the administrator's view as
 * it changes instead of freezing today's version of it into their own row.
 */
export async function resetDashboardLayout(viewKey: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");
  if (!isViewKey(viewKey)) return;

  await prisma.dashboardLayout.deleteMany({
    where: { userId: user.id, templateKey: viewKey },
  });

  revalidatePath("/dashboard");
}

/**
 * Remember which view this user was last looking at.
 *
 * Written on selection rather than behind a "make this my default" control:
 * the view you chose is the view you want next time, and a second control to
 * say so is a question nobody wants asked. `User.dashboardView` is a plain
 * string column, not a foreign key, so a view deleted afterwards degrades to
 * the fallback instead of cascading — which is also why this does no work to
 * keep the column honest.
 */
export async function selectDashboardView(viewKey: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");
  if (!(await canUseView(viewKey, user.role))) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { dashboardView: viewKey },
  });

  revalidatePath("/dashboard");
}

/* ── The company's views ─────────────────────────────────────────────────── */

/**
 * Create or rename a view, and set what is on it.
 *
 * Administrators pick **which tiles and in what order**, not where they sit.
 * Geometry is derived from the catalog's default sizes and flowed left to right
 * (`placeInReadingOrder`), because a company template that carried one person's
 * pixel arrangement would be handing everyone else their taste as a starting
 * point — and every user reshapes their own copy anyway. That is the whole
 * template/layout split, and it is why this screen is a checklist rather than a
 * second drag canvas.
 *
 * The key is settled at creation and never changed after. It is the identity a
 * user's saved layout hangs off (`DashboardLayout.templateKey`), so renaming
 * one would silently orphan every reshaped copy of the view.
 *
 * A **colour** is the exception to "not where it sits", and it is the exception
 * for the same reason the rest of the rule holds: an accent says which tile
 * this is rather than where it goes, so it survives a reshape and belongs to
 * the company view. It is written as `{ id, accent }` and an uncoloured tile is
 * still written as the bare id it always was, so a view nobody has coloured
 * stores byte-identical JSON to what it stored before. Neither form carries
 * geometry, and `layout.readTiles` flows both in reading order.
 */
export async function saveDashboardView(input: {
  id?: string;
  key?: string;
  label: string;
  tiles: { id: string; accent?: string }[];
  access: string[];
  sortOrder?: number;
}): Promise<void> {
  const auth = await requireAdmin();
  if (!auth.authorized) throw new Error(auth.error);

  const label = input.label.trim();
  if (!label) throw new Error("A view needs a name.");

  // Re-validated here rather than trusted, like every other field: this is a
  // public endpoint with a generated name, and an accent nobody recognises
  // would be a `data-accent` with no rule behind it on everybody's dashboard.
  const tiles = input.tiles
    .filter((tile) => isTileId(tile.id))
    .map((tile) => {
      const accent = readAccent(tile.accent);
      return accent ? { id: tile.id, accent } : tile.id;
    });
  if (tiles.length === 0) throw new Error("A view needs at least one tile.");

  const roles: UserRole[] = input.access.filter((role): role is UserRole =>
    ["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER", "FLOW_USER"].includes(role),
  );
  const sortOrder = Number.isFinite(input.sortOrder)
    ? Math.max(0, Math.round(input.sortOrder as number))
    : 0;

  if (input.id) {
    const existing = await prisma.dashboardTemplate.findUnique({
      where: { id: input.id },
      select: { key: true, label: true, tiles: true, access: true },
    });
    if (!existing) throw new Error("That view no longer exists.");

    await prisma.dashboardTemplate.update({
      where: { id: input.id },
      data: { label, tiles, access: roles, sortOrder },
    });
    await logAudit({
      action: "UPDATE",
      entityType: "Settings",
      entityId: input.id,
      oldValues: { ...existing },
      newValues: { label, tiles, access: roles, sortOrder },
    });
  } else {
    const key = isViewKey(input.key) ? input.key : slugifyViewKey(label);
    if (!isViewKey(key)) {
      throw new Error(
        "That name has no letters or digits in it, so it cannot become a key.",
      );
    }

    const clash = await prisma.dashboardTemplate.findUnique({
      where: { key },
      select: { id: true },
    });
    if (clash) throw new Error(`A view with the key "${key}" already exists.`);

    const created = await prisma.dashboardTemplate.create({
      data: { key, label, tiles, access: roles, sortOrder },
      select: { id: true },
    });
    await logAudit({
      action: "CREATE",
      entityType: "Settings",
      entityId: created.id,
      newValues: { key, label, tiles, access: roles, sortOrder },
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings/dashboards");
}

/**
 * Remove a view.
 *
 * The reshaped copies go with it. `DashboardLayout.templateKey` is a plain
 * string with no foreign key, so nothing cascades on its own — and leaving the
 * rows behind would mean recreating a view under the same key silently
 * restoring layouts saved against a different set of tiles.
 *
 * Users pointed at it by `User.dashboardView` are left alone deliberately: the
 * read path already degrades a missing view to the first one they can open, and
 * rewriting other people's rows to clean up after a deletion is a bigger blast
 * radius than the problem.
 */
export async function deleteDashboardView(id: string): Promise<void> {
  const auth = await requireAdmin();
  if (!auth.authorized) throw new Error(auth.error);

  const row = await prisma.dashboardTemplate.findUnique({
    where: { id },
    select: { key: true, label: true },
  });
  if (!row) return;

  await prisma.dashboardTemplate.delete({ where: { id } });
  await prisma.dashboardLayout.deleteMany({ where: { templateKey: row.key } });

  await logAudit({
    action: "DELETE",
    entityType: "Settings",
    entityId: id,
    oldValues: { key: row.key, label: row.label },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings/dashboards");
}
