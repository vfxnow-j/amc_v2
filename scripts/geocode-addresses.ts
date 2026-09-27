import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { resolveAddress } from "@/lib/geo/geocode";
import { dbLookups, saveGeocode } from "@/lib/geo/geocode-db";
import { addressKey } from "@/lib/geo/normalize";

/**
 * Geocode every address Inventory → Map can show, offline, into the v2-only
 * `geocodes` cache: order delivery addresses, client and billing addresses, and
 * location addresses. ZIP/postal centroid first, then city; nothing leaves the
 * box (needs scripts/load-postal-centroids.ts run once).
 *
 *   npx tsx scripts/geocode-addresses.ts              # dry run: what would resolve
 *   npx tsx scripts/geocode-addresses.ts --apply      # write the cache
 *   npx tsx scripts/geocode-addresses.ts --apply --refresh   # re-resolve GEONAMES rows
 *
 * Run it after each v1 sync — the sync writes addresses without any save hook.
 * MANUAL rows (a corrected pin) are never overwritten.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const refresh = process.argv.includes("--refresh");

  const [orders, clients, locations] = await Promise.all([
    prisma.reservation.findMany({
      where: { deliveryAddress: { not: null } },
      select: { deliveryAddress: true },
    }),
    prisma.client.findMany({ select: { address: true, billingAddress: true } }),
    prisma.location.findMany({
      where: { address: { not: null } },
      select: { address: true },
    }),
  ]);

  const texts = new Map<string, string>();
  const add = (t: string | null) => {
    if (t && t.trim()) {
      const k = addressKey(t);
      if (!texts.has(k)) texts.set(k, t);
    }
  };
  orders.forEach((o) => add(o.deliveryAddress));
  clients.forEach((c) => {
    add(c.address);
    add(c.billingAddress);
  });
  locations.forEach((l) => add(l.address));

  const lookups = dbLookups(prisma);
  const tally: Record<string, number> = {};
  for (const text of texts.values()) {
    const r = await resolveAddress(text, lookups, { refresh });
    if (!r) continue;
    const label = r.status === "OK" ? `OK/${r.precision}` : r.status;
    tally[label] = (tally[label] ?? 0) + 1;
    const where = [r.city, r.region, r.postalCode, r.countryCode].filter(Boolean).join(", ");
    console.log(
      `${label.padEnd(11)} ${text.replace(/\s+/g, " ").slice(0, 70).padEnd(70)} → ${where || "—"}`,
    );
    if (apply) await saveGeocode(prisma, r);
  }
  console.log(`\n${texts.size} distinct addresses:`, tally);
  if (!apply) console.log("Dry run — nothing written. Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
