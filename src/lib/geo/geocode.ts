import {
  addressKey,
  extractCityRegion,
  extractPostalCode,
  isPlaceholderAddress,
} from "./normalize";

/**
 * One address → a coordinate, offline. cache → postal centroid → city → not
 * found. Nothing leaves the box: the lookups are the v2-only `geocodes` cache
 * and the GeoNames `postal_centroids` table (CC-BY 4.0). docs/inventory-map.md.
 *
 * The lookups are injected so the decision logic is unit-tested without a
 * database; lib/geo/geocode-db.ts supplies the Prisma-backed ones.
 */

export type GeocodeStatus = "OK" | "NOT_FOUND" | "SKIPPED";
export type GeocodePrecision = "POSTAL" | "CITY" | "MANUAL";
export type GeocodeSource = "GEONAMES" | "MANUAL";

export type GeocodeResult = {
  addressKey: string;
  addressText: string;
  status: GeocodeStatus;
  lat: number | null;
  lng: number | null;
  precision: GeocodePrecision | null;
  source: GeocodeSource;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
};

export type CentroidHit = {
  lat: number;
  lng: number;
  place: string | null;
  admin1Code: string | null;
};

export type GeoLookups = {
  cached(addressKey: string): Promise<GeocodeResult | null>;
  postal(countryCode: string, code: string): Promise<CentroidHit | null>;
  city(countryCode: string, region: string, city: string): Promise<CentroidHit | null>;
};

export type ResolveOptions = {
  /** Re-resolve a cached GEONAMES row. MANUAL rows are never overwritten. */
  refresh?: boolean;
};

export async function resolveAddress(
  text: string,
  lookups: GeoLookups,
  options: ResolveOptions = {},
): Promise<GeocodeResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const key = addressKey(trimmed);

  const cached = await lookups.cached(key);
  if (cached && (cached.source === "MANUAL" || !options.refresh)) return cached;

  const base: GeocodeResult = {
    addressKey: key,
    addressText: trimmed,
    status: "NOT_FOUND",
    lat: null,
    lng: null,
    precision: null,
    source: "GEONAMES",
    countryCode: null,
    region: null,
    city: null,
    postalCode: null,
  };

  if (isPlaceholderAddress(trimmed)) return { ...base, status: "SKIPPED" };

  const postal = extractPostalCode(trimmed);
  if (postal) {
    const hit = await lookups.postal(postal.countryCode, postal.code);
    if (hit) {
      return {
        ...base,
        status: "OK",
        lat: hit.lat,
        lng: hit.lng,
        precision: "POSTAL",
        countryCode: postal.countryCode,
        region: hit.admin1Code ?? postal.region,
        city: postal.countryCode === "US" ? hit.place : extractCityRegion(trimmed)?.city ?? hit.place,
        postalCode: postal.full,
      };
    }
  }

  const cr = extractCityRegion(trimmed);
  if (cr) {
    const hit = await lookups.city(cr.countryCode, cr.region, cr.city);
    if (hit) {
      return {
        ...base,
        status: "OK",
        lat: hit.lat,
        lng: hit.lng,
        precision: "CITY",
        countryCode: cr.countryCode,
        region: cr.region,
        city: cr.city,
        postalCode: postal?.full ?? null,
      };
    }
  }

  return {
    ...base,
    countryCode: postal?.countryCode ?? cr?.countryCode ?? null,
    region: cr?.region ?? postal?.region ?? null,
    city: cr?.city ?? null,
    postalCode: postal?.full ?? null,
  };
}
