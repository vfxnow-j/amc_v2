import type { PrismaClient } from "@/generated/prisma/client";
import { addressKey } from "./normalize";
import { resolveAddress, type GeoLookups, type GeocodeResult } from "./geocode";

/**
 * The Prisma-backed lookups `resolveAddress` runs on: the v2-only `geocodes`
 * cache and the GeoNames `postal_centroids` table. Nothing here calls out.
 */
export function dbLookups(prisma: PrismaClient): GeoLookups {
  return {
    async cached(key) {
      const row = await prisma.geocode.findUnique({ where: { addressKey: key } });
      return row ? toResult(row) : null;
    },
    async postal(countryCode, code) {
      const row = await prisma.postalCentroid.findUnique({
        where: { countryCode_postalCode: { countryCode, postalCode: code } },
      });
      return row
        ? { lat: row.lat, lng: row.lng, place: row.place, admin1Code: row.admin1Code }
        : null;
    },
    async city(countryCode, region, city) {
      // A city spans many ZIPs; its centroid is their average. Case-insensitive
      // on the place name, exact on the state.
      const rows = await prisma.postalCentroid.findMany({
        where: {
          countryCode,
          admin1Code: region,
          place: { equals: city, mode: "insensitive" },
        },
        select: { lat: true, lng: true },
      });
      if (rows.length === 0) return null;
      const lat = rows.reduce((s, r) => s + r.lat, 0) / rows.length;
      const lng = rows.reduce((s, r) => s + r.lng, 0) / rows.length;
      return { lat, lng, place: city, admin1Code: region };
    },
  };
}

type GeocodeRow = {
  addressKey: string;
  addressText: string;
  status: GeocodeResult["status"];
  lat: number | null;
  lng: number | null;
  precision: GeocodeResult["precision"];
  source: GeocodeResult["source"];
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
};

function toResult(row: GeocodeRow): GeocodeResult {
  return {
    addressKey: row.addressKey,
    addressText: row.addressText,
    status: row.status,
    lat: row.lat,
    lng: row.lng,
    precision: row.precision,
    source: row.source,
    countryCode: row.countryCode,
    region: row.region,
    city: row.city,
    postalCode: row.postalCode,
  };
}

/** Store a resolution. A MANUAL row is never overwritten by GEONAMES. */
export async function saveGeocode(prisma: PrismaClient, r: GeocodeResult) {
  const existing = await prisma.geocode.findUnique({
    where: { addressKey: r.addressKey },
    select: { source: true },
  });
  if (existing?.source === "MANUAL" && r.source !== "MANUAL") return;
  const data = {
    addressText: r.addressText,
    status: r.status,
    lat: r.lat,
    lng: r.lng,
    precision: r.precision,
    source: r.source,
    countryCode: r.countryCode,
    region: r.region,
    city: r.city,
    postalCode: r.postalCode,
  };
  await prisma.geocode.upsert({
    where: { addressKey: r.addressKey },
    create: { addressKey: r.addressKey, ...data },
    update: data,
  });
}

/** Every cached geocode for a set of address texts, keyed by the raw text. */
export async function geocodesFor(
  prisma: PrismaClient,
  texts: (string | null | undefined)[],
): Promise<Map<string, GeocodeResult>> {
  const keys = new Map<string, string>();
  for (const t of texts) if (t && t.trim()) keys.set(t, addressKey(t));
  const rows = await prisma.geocode.findMany({
    where: { addressKey: { in: [...new Set(keys.values())] } },
  });
  const byKey = new Map(rows.map((r) => [r.addressKey, toResult(r)]));

  // An address nobody has geocoded yet — typed on an order a minute ago, or
  // brought in by a sync — is resolved now, offline, and cached, so the map
  // never waits for scripts/geocode-addresses.ts. Capped per call so a page
  // after a large sync stays quick; the rest resolve on the next loads.
  const lookups = dbLookups(prisma);
  let resolved = 0;
  for (const [text, key] of keys) {
    if (byKey.has(key) || resolved >= NEW_PER_CALL) continue;
    const r = await resolveAddress(text, lookups);
    if (!r) continue;
    await saveGeocode(prisma, r).catch(() => {});
    byKey.set(key, r);
    resolved++;
  }

  const out = new Map<string, GeocodeResult>();
  for (const [text, key] of keys) {
    const hit = byKey.get(key);
    if (hit) out.set(text, hit);
  }
  return out;
}

const NEW_PER_CALL = 200;
