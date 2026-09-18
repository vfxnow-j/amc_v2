import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { coverPlanLines, unitsForLine, type CandidateUnit, type POLine } from "@/lib/coverage/po-plans";

/**
 * Record the AppleCare+ bought on purchase orders against the units it covers.
 *
 * Melrose Mac bills AppleCare+ as its own PO line on "Auto Enroll" — Apple ties
 * it to the serial. v2 had nowhere to say so per unit; CoverageEnrollment is
 * that place, and this fills it from the POs that already carry the lines. The
 * matching rules and why they are strict are in lib/coverage/po-plans.ts.
 *
 *   npx tsx scripts/coverage-from-pos.ts            # say what it would do
 *   npx tsx scripts/coverage-from-pos.ts --apply    # do it
 *
 * Every row starts PURCHASED — paid for, not yet seen on Apple's own record —
 * with no start or end date, because no PO states a term. Re-runnable: a unit
 * that already has an enrollment from the same PO line is left alone, so a
 * status somebody has since confirmed is never reset.
 */
const money = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const apply = process.argv.includes("--apply");

  const pos = await prisma.purchaseOrder.findMany({
    where: { items: { some: { description: { contains: "AppleCare", mode: "insensitive" } } } },
    orderBy: { poNumber: "asc" },
    select: {
      id: true,
      poNumber: true,
      orderDate: true,
      expectedDate: true,
      receivedDate: true,
      vendor: { select: { name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: { id: true, description: true, quantity: true, unitPrice: true, assetId: true, isInventoried: true },
      },
    },
  });

  const toCreate: {
    unitId: string;
    barcode: string;
    name: string;
    provider: string;
    cost: number;
    purchaseOrderId: string;
    poItemId: string;
    source: string;
  }[] = [];
  let skipped = 0;

  for (const po of pos) {
    const lines: POLine[] = po.items.map((item) => ({ ...item, description: item.description.trim(), unitPrice: Number(item.unitPrice) }));
    const window = { from: po.orderDate, to: po.receivedDate ?? po.expectedDate ?? new Date() };
    console.log(`\n${po.poNumber} · ${po.vendor.name} · ordered ${day(po.orderDate)}, received ${po.receivedDate ? day(po.receivedDate) : "—"}`);

    const assetIds = [...new Set(lines.map((line) => line.assetId).filter((id): id is string => id !== null))];
    const units: CandidateUnit[] = (
      await prisma.assetUnit.findMany({
        where: { assetId: { in: assetIds } },
        select: { id: true, barcode: true, assetId: true, purchaseOrderId: true, purchasePrice: true, purchaseDate: true },
      })
    ).map((unit) => ({ ...unit, purchasePrice: unit.purchasePrice === null ? null : Number(unit.purchasePrice) }));
    const taken = new Set<string>();

    for (const cover of coverPlanLines(lines)) {
      const head = `  "${cover.planLine.description}" × ${cover.planLine.quantity} at ${money(cover.planLine.unitPrice)}`;
      if (!cover.ok) {
        console.log(`${head}\n    left alone: ${cover.reason}`);
        continue;
      }
      // All of a plan line's hardware must match, or none of it is recorded.
      const matches = cover.hardware.map((hardware) => ({ hardware, match: unitsForLine(hardware, { id: po.id, window }, units, taken) }));
      const failed = matches.find((m) => !m.match.ok);
      if (failed && !failed.match.ok) {
        console.log(`${head}\n    left alone: "${failed.hardware.description}": ${failed.match.reason}`);
        continue;
      }
      console.log(head);
      for (const { hardware, match } of matches) {
        match.units.forEach((unit) => taken.add(unit.id));
        const how =
          match.ok && match.basis === "received"
            ? "received against this PO"
            : `matched by model, unit price (${money(hardware.unitPrice)}) and a purchase date inside the PO's dates (receiving did not record the PO on the unit)`;
        console.log(`    → "${hardware.description}" × ${hardware.quantity}: ${match.units.map((u) => u.barcode).sort().join(", ")}`);
        for (const unit of match.units) {
          toCreate.push({
            unitId: unit.id,
            barcode: unit.barcode,
            name: cover.plan.name,
            provider: cover.plan.provider,
            cost: cover.planLine.unitPrice,
            purchaseOrderId: po.id,
            poItemId: cover.planLine.id,
            source:
              `${po.poNumber} (${po.vendor.name}), line "${cover.planLine.description}" × ${cover.planLine.quantity} at ${money(cover.planLine.unitPrice)} each. ` +
              `Unit is from line "${hardware.description}", ${how}. ` +
              `The PO states no term, so start and end dates are unknown until read off ${cover.plan.provider}'s coverage record for the serial.`,
          });
        }
      }
    }
  }

  const existing = await prisma.coverageEnrollment.findMany({
    where: { poItemId: { in: [...new Set(toCreate.map((row) => row.poItemId))] } },
    select: { unitId: true, poItemId: true },
  });
  const have = new Set(existing.map((row) => `${row.unitId}:${row.poItemId}`));
  const fresh = toCreate.filter((row) => {
    const already = have.has(`${row.unitId}:${row.poItemId}`);
    if (already) skipped++;
    return !already;
  });

  console.log(`\n${toCreate.length} units covered by PO plan lines; ${skipped} already recorded; ${fresh.length} to add.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write them.");
    return;
  }
  if (fresh.length) {
    await prisma.coverageEnrollment.createMany({
      data: fresh.map((row) => ({
        unitId: row.unitId,
        name: row.name,
        provider: row.provider,
        cost: row.cost,
        purchaseOrderId: row.purchaseOrderId,
        poItemId: row.poItemId,
        source: row.source,
        status: "PURCHASED" as const,
      })),
    });
  }
  console.log(`Added ${fresh.length}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
