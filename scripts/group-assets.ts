import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { suggestFamilies } from "@/lib/inventory/families";

/**
 * Group the fleet into assets, in one pass.
 *
 * Grouping is a one-time job on a catalogue that already exists, so it is a
 * script rather than a screen. It is safe to re-run: only models with no family
 * are ever considered, so nothing already settled is reshuffled, and a model
 * added next month attaches to its asset on the next run instead of needing
 * a UI that would be used twice a year.
 *
 *   npx tsx scripts/group-assets.ts          # show what it would do
 *   npx tsx scripts/group-assets.ts --apply  # do it
 *
 * The rule is in lib/inventory/families: models in the same category sharing
 * their leading words, refined by another word when a group exceeds six. It
 * gets the obvious cases right and it will get some wrong — "Mac Pro" spans
 * three generations of a very different machine. Those are fixed by dissolving
 * the asset on its record, which releases the models untouched.
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.asset.findMany({
    where: { familyId: null },
    select: {
      id: true,
      name: true,
      categoryId: true,
      manufacturer: true,
      category: { select: { name: true } },
      _count: {
        select: { units: { where: { status: { notIn: ["RETIRED", "SOLD"] } } } },
      },
    },
  });

  const makerOf = new Map(rows.map((r) => [r.id, r.manufacturer]));
  const groups = suggestFamilies(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      units: r._count.units,
    })),
  );

  const covered = groups.reduce((n, g) => n + g.assets.length, 0);
  console.log(
    `${rows.length} ungrouped models → ${groups.length} assets covering ${covered}; ${rows.length - covered} stay standalone`,
  );
  if (!APPLY) console.log("(dry run — pass --apply to write)\n");

  let created = 0;
  let extended = 0;
  let moved = 0;

  for (const group of groups) {
    const ids = group.assets.map((a) => a.id);

    // Seed the manufacturer only when every model carries one and they agree.
    // One model saying PNY and another saying nothing means nobody recorded
    // who makes this — not "PNY" inferred from a single purchase.
    const makers = ids.map((id) => makerOf.get(id) ?? null);
    const distinct = [...new Set(makers)];
    const manufacturer =
      distinct.length === 1 && distinct[0] !== null ? distinct[0] : null;

    const existing = await prisma.assetFamily.findUnique({
      where: { name: group.name },
      select: { id: true },
    });

    console.log(
      `${existing ? "+" : "*"} ${group.name.padEnd(26)} ${String(ids.length).padStart(2)} models` +
        `  ${group.assets.reduce((n, a) => n + a.units, 0)}u` +
        `${manufacturer ? `  [${manufacturer}]` : ""}`,
    );
    if (!APPLY) continue;

    const family =
      existing ??
      (await prisma.assetFamily.create({
        data: { name: group.name, manufacturer },
      }));
    if (existing) extended += 1;
    else created += 1;

    const result = await prisma.asset.updateMany({
      where: { id: { in: ids }, familyId: null },
      data: { familyId: family.id },
    });
    moved += result.count;
  }

  if (APPLY) {
    const families = await prisma.assetFamily.count();
    const grouped = await prisma.asset.count({ where: { familyId: { not: null } } });
    const total = await prisma.asset.count();
    console.log(
      `\ncreated ${created}, extended ${extended}, moved ${moved} models`,
    );
    console.log(
      `now: ${families} assets with models, ${grouped} of ${total} models grouped, ${total - grouped} standalone`,
    );
  }
  await prisma.$disconnect();
}

main();
