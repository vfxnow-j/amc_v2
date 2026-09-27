import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadAssetCapacity } from "@/lib/portal/capacity-load";
import { businessToday } from "@/lib/billing/calendar";

/**
 * Read-only sanity check for the portal's capacity figures: prints
 * `computeCapacity` for a few real assets against v2's database, alongside the
 * raw unit-status counts so the numbers can be checked by eye. SELECTs only.
 *
 *   npx tsx scripts/print-capacity.ts [name-fragment …]
 */
async function main() {
  const fragments = process.argv.slice(2);
  const names = fragments.length ? fragments : ["A6000", "Workstation", "MacBook"];
  const today = businessToday();

  for (const fragment of names) {
    const asset = await prisma.asset.findFirst({
      where: { name: { contains: fragment, mode: "insensitive" }, units: { some: {} } },
      orderBy: { units: { _count: "desc" } },
      select: { id: true, name: true, category: { select: { name: true, refurbBufferDays: true } } },
    });
    if (!asset) {
      console.log(`\n${fragment}: no asset with units`);
      continue;
    }
    const statuses = await prisma.assetUnit.groupBy({
      by: ["status"],
      where: { assetId: asset.id },
      _count: true,
    });
    const capacity = await loadAssetCapacity(asset.id, today);
    console.log(`\n${asset.name} [${asset.category?.name ?? "no category"}, buffer ${asset.category?.refurbBufferDays ?? "-"}]`);
    console.log("  units:", Object.fromEntries(statuses.map((row) => [row.status, row._count])));
    console.log("  capacity:", JSON.stringify(capacity?.pool));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
