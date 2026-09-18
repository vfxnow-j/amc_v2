# Out by category tile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard tile to the Business view showing how many units of each asset category are currently out, against the size of that category in the fleet.

**Architecture:** One `groupBy` query in `lib/queries/inventory.ts` split into a database call plus a pure shaping function (so the shaping is unit-testable without a database), a server-rendered tile in `components/dashboard/tiles/fleet.tsx`, a catalogue entry, and a `prisma/manual` SQL migration that appends the tile to the already-seeded `business` template row.

**Tech Stack:** Next.js 16.2.12 (App Router, Server Components), Prisma 7.9 with the pg adapter, TypeScript, Tailwind.

**Spec:** `docs/dashboard-out-by-category.md`

## Global Constraints

- **Read the guide first.** `AGENTS.md`: this is not the Next.js you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- **"Out" means `CHECKED_OUT` only.** Never fold in `RESERVED`.
- **The denominator is `IN_FLEET`** — `AVAILABLE`, `CHECKED_OUT`, `MAINTENANCE`, `RESERVED`, imported from `@/lib/inventory/availability`. Never re-declare this list.
- **`lib/dashboard/catalog.ts` must stay pure and client-safe.** No imports that reach the database, no JSX. The picker is a client component; a database import there pulls the pg driver into the browser bundle and fails on `dns`.
- **Tile components are server-only** and live behind `tiles/registry.tsx`, which is the sole module that turns a tile id into a component.
- **Grid widths come from the divisors of 12** — {3, 4, 6, 8, 12}. A 5- or 7-wide tile cannot close a row.
- **Tile ids are a persisted data format** (stored in `DashboardLayout.tiles` and template rows). The new id is `out-by-category` and must be spelled identically in every file.
- **Commit after each task.** Do not push.

---

### Task 1: The query and its shaping function

**Files:**
- Create: `src/lib/queries/inventory.shape.test.ts`
- Modify: `src/lib/queries/inventory.ts` (add at end of the "Units" section, after `tallyUnits`)
- Modify: `package.json` (add `test` script and vitest devDependencies)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `export type OutByCategoryRow = { category: string; out: number; fleet: number; share: number }`
- Produces: `export type OutByCategory = { rows: OutByCategoryRow[]; totalOut: number; totalFleet: number; totalShare: number }`
- Produces: `export function shapeOutByCategory(groups: CategoryStatusGroup[]): OutByCategory`
- Produces: `export const getOutByCategory: () => Promise<OutByCategory>` (React `cache()`-wrapped)
- Produces: `export type CategoryStatusGroup = { category: string; status: AssetStatus; count: number }`

This repo has **no test framework**. This task installs Vitest, because the shaping rules (which categories are dropped, which are kept, how share is computed) are exactly the kind of logic that is wrong in a way no screenshot reveals.

- [ ] **Step 1: Install Vitest**

Run:
```bash
npm install --save-dev vitest@^3.2.4
```

- [ ] **Step 2: Add the config and the test script**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
```

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/queries/inventory.shape.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { shapeOutByCategory } from "./inventory";

describe("shapeOutByCategory", () => {
  it("counts only CHECKED_OUT as out, and all in-fleet statuses as fleet", () => {
    const { rows } = shapeOutByCategory([
      { category: "Workstations", status: "CHECKED_OUT", count: 141 },
      { category: "Workstations", status: "RESERVED", count: 6 },
      { category: "Workstations", status: "AVAILABLE", count: 191 },
      { category: "Workstations", status: "MAINTENANCE", count: 41 },
    ]);

    expect(rows).toEqual([
      { category: "Workstations", out: 141, fleet: 379, share: 141 / 379 },
    ]);
  });

  it("sorts by out descending, then by name for a stable order", () => {
    const { rows } = shapeOutByCategory([
      { category: "Monitors", status: "CHECKED_OUT", count: 38 },
      { category: "Laptops", status: "CHECKED_OUT", count: 48 },
      { category: "Cables", status: "CHECKED_OUT", count: 1 },
      { category: "Power", status: "CHECKED_OUT", count: 1 },
    ]);

    expect(rows.map((r) => r.category)).toEqual([
      "Laptops",
      "Monitors",
      "Cables",
      "Power",
    ]);
  });

  it("keeps a category that has fleet but nothing out", () => {
    const { rows } = shapeOutByCategory([
      { category: "External Storage", status: "AVAILABLE", count: 2 },
    ]);

    expect(rows).toEqual([
      { category: "External Storage", out: 0, fleet: 2, share: 0 },
    ]);
  });

  it("drops a category with no units in the fleet at all", () => {
    const { rows } = shapeOutByCategory([
      { category: "Motherboards", status: "SOLD", count: 4 },
      { category: "Motherboards", status: "RETIRED", count: 2 },
    ]);

    expect(rows).toEqual([]);
  });

  it("totals across categories and reports the overall share", () => {
    const result = shapeOutByCategory([
      { category: "Workstations", status: "CHECKED_OUT", count: 3 },
      { category: "Workstations", status: "AVAILABLE", count: 1 },
      { category: "Laptops", status: "CHECKED_OUT", count: 1 },
      { category: "Laptops", status: "AVAILABLE", count: 5 },
    ]);

    expect(result.totalOut).toBe(4);
    expect(result.totalFleet).toBe(10);
    expect(result.totalShare).toBe(0.4);
  });

  it("returns zero totals rather than NaN when there is no fleet", () => {
    const result = shapeOutByCategory([]);

    expect(result).toEqual({
      rows: [],
      totalOut: 0,
      totalFleet: 0,
      totalShare: 0,
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- inventory.shape`
Expected: FAIL — `shapeOutByCategory` is not exported from `./inventory`.

- [ ] **Step 5: Implement the shaping function and the query**

In `src/lib/queries/inventory.ts`, confirm the existing import at the top already includes `IN_FLEET` from `@/lib/inventory/availability` (it does, at line 4). Add `import { cache } from "react"` if it is not already imported.

Append to the file:

```ts
/* ── Out by category ────────────────────────────────────────────────────── */

/**
 * How much of each kind of thing is out right now.
 *
 * "Out" is `CHECKED_OUT` and nothing else — the definition Inventory's Out
 * view, the stock-count report and the asset record all use. Folding in
 * RESERVED would make this tile disagree with every other screen about the
 * same word.
 *
 * The denominator is `IN_FLEET`: capacity that could earn. Sold and retired
 * hardware is not fleet and is counted on neither side.
 */
export type CategoryStatusGroup = {
  category: string;
  status: AssetStatus;
  count: number;
};

export type OutByCategoryRow = {
  category: string;
  out: number;
  fleet: number;
  /** `out / fleet`, 0 when the category has no fleet. */
  share: number;
};

export type OutByCategory = {
  rows: OutByCategoryRow[];
  totalOut: number;
  totalFleet: number;
  totalShare: number;
};

/**
 * Pure, so the two rules about which categories appear can be tested without a
 * database. They are different rules and both are deliberate:
 *
 * - no units in the fleet at all → dropped, because a row of zeros is noise;
 * - fleet but nothing out → kept, because "nothing out" is an answer.
 */
export function shapeOutByCategory(
  groups: CategoryStatusGroup[],
): OutByCategory {
  const byCategory = new Map<string, { out: number; fleet: number }>();

  for (const group of groups) {
    if (!IN_FLEET.includes(group.status)) continue;

    const entry = byCategory.get(group.category) ?? { out: 0, fleet: 0 };
    entry.fleet += group.count;
    if (group.status === "CHECKED_OUT") entry.out += group.count;
    byCategory.set(group.category, entry);
  }

  const rows: OutByCategoryRow[] = [];
  for (const [category, { out, fleet }] of byCategory) {
    if (fleet === 0) continue;
    rows.push({ category, out, fleet, share: out / fleet });
  }

  rows.sort((a, b) => b.out - a.out || a.category.localeCompare(b.category));

  const totalOut = rows.reduce((sum, row) => sum + row.out, 0);
  const totalFleet = rows.reduce((sum, row) => sum + row.fleet, 0);

  return {
    rows,
    totalOut,
    totalFleet,
    totalShare: totalFleet === 0 ? 0 : totalOut / totalFleet,
  };
}

/**
 * `cache`d per the tile registry's rule: a tile placed twice, or sharing a
 * query with another tile, must not run that query twice in one render pass.
 *
 * `prisma.assetUnit.groupBy` cannot group by a related model's field, and the
 * category lives two hops away (unit → asset → category). So this reads the
 * in-fleet units with two scalar fields each and tallies them here — ~856 rows
 * today — rather than dropping to raw SQL that hardcodes table names the schema
 * owns.
 */
export const getOutByCategory = cache(async (): Promise<OutByCategory> => {
  const units = await prisma.assetUnit.findMany({
    where: { status: { in: IN_FLEET } },
    select: {
      status: true,
      asset: { select: { category: { select: { name: true } } } },
    },
  });

  const groups = new Map<string, CategoryStatusGroup>();
  for (const unit of units) {
    const category = unit.asset.category.name;
    const key = `${category} ${unit.status}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { category, status: unit.status, count: 1 });
  }

  return shapeOutByCategory([...groups.values()]);
});
```

Confirm `AssetStatus` is imported as a type at the top of the file, and that `cache` is imported from `react`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- inventory.shape`
Expected: PASS, 6 tests.

- [ ] **Step 7: Verify against the real database**

Create `scripts/tmp-verify-out.ts`:
```ts
import "dotenv/config";
import { getOutByCategory } from "@/lib/queries/inventory";

async function main() {
  const result = await getOutByCategory();
  console.table(result.rows);
  console.log({
    totalOut: result.totalOut,
    totalFleet: result.totalFleet,
    share: result.totalShare,
  });
}
main();
```

Run: `npx tsx scripts/tmp-verify-out.ts`

Expected, measured 2026-09-17 (figures will drift as orders move — the shape is what you are checking):
- `Workstations` first, `out: 141`, `fleet: 379`
- `Laptops` present with `out: 48`, `fleet: 52`
- `Motherboards` absent
- `totalOut: 335`, `totalFleet: 856`

Then: `rm scripts/tmp-verify-out.ts`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/queries/inventory.ts src/lib/queries/inventory.shape.test.ts
git commit -m "feat(dashboard): count units out per asset category

Adds getOutByCategory and the pure shapeOutByCategory beneath it, plus
Vitest — the repo had no test framework and the rules about which
categories appear are not visible in a screenshot.

Out is CHECKED_OUT alone, the denominator is IN_FLEET, and a category with
no fleet is dropped while one with fleet and nothing out is kept.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `Bar` primitive and the tile

**Files:**
- Modify: `src/components/dashboard/tiles/parts.tsx` (append)
- Modify: `src/components/dashboard/tiles/fleet.tsx` (append, beside `RateHealthTile`)
- Modify: `src/components/dashboard/tiles/registry.tsx`
- Modify: `src/lib/dashboard/catalog.ts`

**Interfaces:**
- Consumes: `getOutByCategory`, `OutByCategory` from Task 1.
- Produces: `export function Bar({ share, tone }: { share: number; tone?: "accent" | "plain" })` in `parts.tsx`
- Produces: `export async function OutByCategoryTile()` in `fleet.tsx`
- Produces: tile id `"out-by-category"` in `catalog.ts`

`components/ui/progress.tsx` cannot be reused — it is a client component (`'use client'`, Radix) and this renders on the server.

- [ ] **Step 1: Add the `Bar` primitive**

Append to `src/components/dashboard/tiles/parts.tsx`:
```tsx
/**
 * A proportion, drawn. Server-rendered on purpose: `components/ui/progress.tsx`
 * is a Radix client component, and a tile is a Server Component handed to the
 * canvas as finished UI.
 *
 * `share` is 0–1. Anything outside that is clamped rather than trusted, because
 * a bar wider than its track is a layout bug on a grid, not a visible error.
 */
export function Bar({
  share,
  tone = "accent",
}: {
  share: number;
  tone?: "accent" | "plain";
}) {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  return (
    <div
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="img"
      aria-label={`${pct}%`}
    >
      <div
        className={
          tone === "accent"
            ? "bg-accent-solid h-full rounded-full"
            : "bg-muted-foreground h-full rounded-full"
        }
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

Check the two colour tokens against a sibling tile before committing: open `src/components/dashboard/tiles/parts.tsx` and `tile.tsx` and use whatever accent/muted token names those files already use. Per the design-tokens work on this branch, do **not** introduce a raw colour.

- [ ] **Step 2: Add the tile**

Append to `src/components/dashboard/tiles/fleet.tsx`, and add `getOutByCategory` to the existing import from `@/lib/queries/reports`/`inventory` as appropriate (it lives in `@/lib/queries/inventory`):

```tsx
/**
 * How much of each kind of thing is out.
 *
 * Counts units, not orders and not money — a unit out on a free evaluation
 * counts exactly like one on a paying order. The footer says so rather than
 * leaving it to be assumed.
 */
export async function OutByCategoryTile() {
  const { rows, totalOut, totalFleet, totalShare } = await getOutByCategory();
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Out by category"
        meta={
          totalFleet === 0
            ? undefined
            : `${totalOut} of ${totalFleet} units out · ${pct(totalShare)}`
        }
        href="/dashboard/reports/inventory"
        hrefLabel="Stock count →"
      />

      {rows.length === 0 ? (
        <Empty>
          No category has units in the fleet yet. A category appears here once
          it has hardware that is available, out, reserved or in service.
        </Empty>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-8 gap-y-3 overflow-y-auto sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.category} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm">{row.category}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {row.out} / {row.fleet} · {pct(row.share)}
                  </span>
                </div>
                <Bar share={row.share} tone={row.out === 0 ? "plain" : "accent"} />
              </div>
            ))}
          </div>

          <Excludes>
            Out means checked out, the same as everywhere else — reserved and
            in-service units count towards the fleet, not towards what is out.
            These are units, not orders or money: a unit out on a free
            evaluation counts exactly like one on a paying order.
          </Excludes>
        </>
      )}
    </Tile>
  );
}
```

Add `Bar` to the existing `@/components/dashboard/tiles/parts` import in that file.

- [ ] **Step 3: Add the catalogue entry**

In `src/lib/dashboard/catalog.ts`, add to the `TileId` union, in the Client Tracker block's place at the end with its own comment:
```ts
  // Client Tracker, Phase 2: the follow-up queue.
  | "tracker-queue"
  // The fleet, by category.
  | "out-by-category";
```

Add to `TILE_CATALOG`:
```ts
  "out-by-category": {
    id: "out-by-category",
    title: "Out by category",
    blurb:
      "How much of each kind of thing is out — workstations, monitors, the rest — against the size of the category.",
    category: "The fleet",
    size: {
      default: { w: 12, h: 6 },
      min: { w: 6, h: 4 },
      max: { w: 12, h: 10 },
    },
    access: "everyone",
    // Unit status is a right-now fact; there is no historical status to filter.
    // A tile that moved with the header's range control would be lying about
    // what the control did to it.
    readsRange: false,
  },
```

- [ ] **Step 4: Register the tile**

In `src/components/dashboard/tiles/registry.tsx`, add `OutByCategoryTile` to the existing import from `@/components/dashboard/tiles/fleet`, and add the entry:
```tsx
  "out-by-category": {
    meta: TILE_CATALOG["out-by-category"],
    Component: OutByCategoryTile,
    fallback: <TileSkeleton title="Out by category" h={6} />,
  },
```

For the fallback, use whatever skeleton helper the neighbouring entries use — read the top of `registry.tsx` and match it. The fallback must match the real tile's height (6 rows): a skeleton that reflows when data lands shoves its neighbours on a grid.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors. If `Record<TileId, TileEntry>` complains, the registry entry is missing or misspelled — that is the type doing its job.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/tiles/parts.tsx src/components/dashboard/tiles/fleet.tsx src/components/dashboard/tiles/registry.tsx src/lib/dashboard/catalog.ts
git commit -m "feat(dashboard): out-by-category tile and a server-rendered Bar

ui/progress.tsx is a Radix client component and a tile is a Server
Component, so the proportion bar is a new primitive in tiles/parts.tsx
where the next tile that wants one will find it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Place it on the Business view

**Files:**
- Modify: `src/lib/dashboard/views.ts`
- Create: `prisma/manual/2026-09-17-out-by-category-tile.sql`

**Interfaces:**
- Consumes: tile id `"out-by-category"` from Task 2.

Editing the seed alone changes nothing in this database. `store.ts:seedViews` writes seeds only into an **empty** table, and the `business` template is already a row with ten tiles. The migration is what actually places it.

- [ ] **Step 1: Add it to the seed**

In `src/lib/dashboard/views.ts`, in the `business` view's `tiles` array, append after `at("rate-health", 6, 24, 6, 6)`:
```ts
      at("out-by-category", 0, 30, 12, 6),
```

The row rule holds: width 12 closes the row on its own.

- [ ] **Step 2: Write the migration**

Create `prisma/manual/2026-09-17-out-by-category-tile.sql`:
```sql
-- Append the "Out by category" tile to the Business dashboard.
--
-- The seed in lib/dashboard/views.ts does not reach this database: seedViews
-- writes only into an empty dashboard_templates table, guarded on the table
-- being empty rather than on each key being present, and the business template
-- is already a row. So the tile is placed here.
--
-- Idempotent: the WHERE clause skips the row if the id is already present, so
-- running this twice does not place the tile twice.

UPDATE dashboard_templates
SET tiles = tiles || jsonb_build_array(
  jsonb_build_object('id', 'out-by-category', 'x', 0, 'y', 30, 'w', 12, 'h', 6)
)
WHERE key = 'business'
  AND NOT (tiles @> '[{"id": "out-by-category"}]'::jsonb);
```

- [ ] **Step 3: Check the column type before running it**

Run:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "\d dashboard_templates"
```
Expected: a `tiles` column of type `jsonb`. If it reports `json` rather than `jsonb`, change the SQL to cast: `tiles::jsonb || ...` and `WHERE NOT (tiles::jsonb @> ...)`, assigning back with `::json`. Do not guess — check.

- [ ] **Step 4: Dry-run the migration**

Run:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "SELECT key, jsonb_array_length(tiles) AS tiles FROM dashboard_templates WHERE key = 'business';"
```
Expected: `business | 10`

- [ ] **Step 5: Apply it**

Run:
```bash
docker exec -i vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 < prisma/manual/2026-09-17-out-by-category-tile.sql
```
Expected: `UPDATE 1`

- [ ] **Step 6: Verify it is idempotent**

Run the same command a second time.
Expected: `UPDATE 0` — the guard held.

Then:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "SELECT jsonb_array_length(tiles) AS tiles FROM dashboard_templates WHERE key = 'business';"
```
Expected: `11`

- [ ] **Step 7: See it in the app**

Start the dev server if it is not running (`npm run dev`, port 3001) and open `/dashboard?view=business`.

Expected: the tile at the bottom of the Business view, full width, `Workstations` first. Confirm the header reads `335 of 856 units out · 39%` (or today's equivalent) and that the figure matches what Task 1 Step 7 printed.

Per `docs` and prior experience: if the tile renders but the figures look stale or a column is missing, restart the dev server — the Prisma client is pinned to `globalThis`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dashboard/views.ts prisma/manual/2026-09-17-out-by-category-tile.sql
git commit -m "feat(dashboard): place Out by category on the Business view

Seed edit plus a prisma/manual migration, because seedViews only fills an
empty table and the business template is already a row — the seed alone
would change nothing in any existing database. The migration is idempotent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification

- [ ] `npm test` — all shaping tests pass
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — no new errors
- [ ] `npx tsx scripts/smoke-routes.ts` — `/dashboard` still 200s (per project practice; a 200 does not mean built, which is why Step 7 above looks at the tile)
- [ ] The tile appears on `/dashboard?view=business` with `Workstations` leading
- [ ] The tile appears in the picker under "The fleet" and can be added to Engineering
- [ ] Re-running the migration reports `UPDATE 0`
