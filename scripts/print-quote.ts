import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadFlowBases } from "@/lib/flow/load-bases";
import { loadFlowDefaults } from "@/lib/flow/order-inputs";
import { loadCreditTiers, tierFor } from "@/lib/portal/tiers";
import { priceQuote, type OfferPricing } from "@/lib/portal/quote";
import { offerRanges } from "@/lib/portal/offers";
import { assertClientSafe } from "@/lib/portal/dto";

/**
 * Read-only check of the portal quote core against v2's database: picks two real
 * assets that have a monthly rate and fully costed units, treats each as a
 * published offer (no portal_offers row is read or written), and prints the
 * client-facing quote lines for a 3-month rental and a Flow 24, plus the public
 * bands. SELECTs only; no snapshot is stored.
 *
 *   npx tsx scripts/print-quote.ts [name-fragment …]
 */
async function main() {
  const fragments = process.argv.slice(2);
  const candidates = await prisma.asset.findMany({
    where: {
      retiredAt: null,
      monthlyRate: { gt: 0 },
      units: { some: { purchasePrice: { gt: 0 } } },
      ...(fragments.length ? { OR: fragments.map((f) => ({ name: { contains: f, mode: "insensitive" as const } })) } : {}),
    },
    orderBy: { monthlyRate: "desc" },
    select: { id: true, name: true, dailyRate: true, weeklyRate: true, monthlyRate: true },
    take: 40,
  });
  const bases = await loadFlowBases(prisma, candidates.map((a) => a.id));
  const assets = candidates.filter((a) => bases[a.id] && bases[a.id].basis > 0 && !bases[a.id].incomplete).slice(0, 2);
  if (!assets.length) throw new Error("No asset with a monthly rate and fully costed units.");

  const [tiers, flowDefaults] = await Promise.all([loadCreditTiers(prisma), loadFlowDefaults(prisma)]);
  const tier = tierFor(tiers, null);
  const offers = new Map<string, OfferPricing>(
    assets.map((a) => [
      a.id,
      {
        id: a.id,
        visible: true,
        solutions: ["rental", "rto", "flow"],
        termsBySolution: null,
        components: [{
          assetId: a.id,
          name: a.name,
          quantity: 1,
          assetRates: { dailyRate: a.dailyRate, weeklyRate: a.weeklyRate, monthlyRate: a.monthlyRate },
          overrideRate: null,
          overridePricingType: null,
          isOneTime: false,
          flowBasis: { basis: bases[a.id].basis, incomplete: bases[a.id].incomplete },
        }],
      },
    ]),
  );

  const start = new Date("2026-11-01T12:00:00Z");
  const end = new Date("2027-01-31T12:00:00Z");
  const result = priceQuote(
    assets.flatMap((a) => [
      { offerId: a.id, qty: 2, solution: "rental" as const, term: null },
      { offerId: a.id, qty: 2, solution: "flow" as const, term: 24 },
    ]),
    { offers, tier, verificationLevel: "agreement_and_coi", flowDefaults, window: { start, end }, capacity: () => null },
  );
  const response = { data: { rate_id: "(not stored)", valid_until: new Date(Date.now() + result.validForMs).toISOString(), total: result.total, lines: result.lines } };
  assertClientSafe(response);

  for (const a of assets) console.log(`${a.id}  ${a.name}  (list $${Number(a.monthlyRate)}/mo)`);
  console.log(`\nPOST /v1/rates/quote — window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}, qty 2 each`);
  console.log(JSON.stringify(response, null, 2));
  console.log("\nPublic bands at the default tier:");
  for (const a of assets) console.log(a.name, JSON.stringify(offerRanges(offers.get(a.id)!, { tier, flowDefaults, today: new Date() })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
