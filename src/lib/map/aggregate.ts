import type { GeocodeResult } from "@/lib/geo/geocode";
import { CA_PROVINCES, US_STATES, isPlaceholderAddress } from "@/lib/geo/normalize";
import type {
  MapFeatureCollection,
  MapItem,
  MapKind,
  MapPlace,
  ReachRow,
  UnplacedReason,
  UnplacedRow,
} from "./types";

/**
 * The pure half of Inventory → Map: rows with an address → points on the map,
 * rows without one → the Unplaced list, and the reach strip counted from the
 * placed rows only. No Prisma, so every rule here is unit-tested.
 */

/** A row to place — an order's units, a location's stock, a client. */
export type Candidate = Omit<MapItem, "address"> & { address: string | null };

/**
 * Why a row cannot be placed, or null when `geo` places it. The reason is what
 * the Unplaced list says, so it names the fix: no address, a placeholder, or an
 * address the offline geocoder could not resolve.
 */
export function unplacedReason(
  address: string | null,
  geo: GeocodeResult | undefined,
): UnplacedReason | null {
  if (!address || !address.trim()) return "NO_ADDRESS";
  if (isPlaceholderAddress(address)) return "TBD";
  if (!geo) return "NOT_GEOCODED";
  if (geo.status === "SKIPPED") return "TBD";
  if (geo.status !== "OK" || geo.lat == null || geo.lng == null) return "NOT_FOUND";
  return null;
}

function placeLabel(geo: GeocodeResult): string {
  const cityRegion = [geo.city, geo.region].filter(Boolean).join(", ");
  const code = geo.precision === "POSTAL" ? geo.postalCode : null;
  return [cityRegion, code].filter(Boolean).join(" ") || geo.addressText;
}

/** The kind carrying the most weight; ties go to the first seen. */
export function dominantKind(items: { kind: MapKind; weight: number }[]): MapKind {
  const sums = new Map<MapKind, number>();
  for (const i of items) sums.set(i.kind, (sums.get(i.kind) ?? 0) + i.weight);
  let best: MapKind = items[0]?.kind ?? "STOCK";
  let bestWeight = -1;
  for (const [kind, w] of sums) {
    if (w > bestWeight) {
      best = kind;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * Split candidates into places (aggregated per coordinate — two addresses in
 * one ZIP share its centroid, so they are one point) and unplaced rows.
 */
export function placeCandidates(
  candidates: Candidate[],
  geocodes: Map<string, GeocodeResult>,
): { places: MapPlace[]; unplaced: UnplacedRow[] } {
  const byPoint = new Map<string, MapPlace>();
  const unplaced: UnplacedRow[] = [];

  for (const c of candidates) {
    const geo = c.address ? geocodes.get(c.address) : undefined;
    const reason = unplacedReason(c.address, geo);
    if (reason || !geo || geo.lat == null || geo.lng == null) {
      unplaced.push({
        id: c.id,
        kind: c.kind,
        title: c.title,
        subtitle: c.subtitle,
        href: c.href,
        weight: c.weight,
        reason: reason ?? "NOT_FOUND",
        address: c.address?.trim() || null,
      });
      continue;
    }
    const pointKey = `${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`;
    let place = byPoint.get(pointKey);
    if (!place) {
      place = {
        id: pointKey,
        lat: geo.lat,
        lng: geo.lng,
        label: placeLabel(geo),
        precision: geo.precision ?? "POSTAL",
        countryCode: geo.countryCode,
        region: geo.region,
        city: geo.city,
        weight: 0,
        kind: c.kind,
        items: [],
      };
      byPoint.set(pointKey, place);
    }
    place.items.push({ ...c, address: c.address!.trim() });
    place.weight += c.weight;
  }

  const places = [...byPoint.values()];
  for (const p of places) {
    p.kind = dominantKind(p.items);
    p.items.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  }
  places.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  unplaced.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  return { places, unplaced };
}

export function toGeoJSON(places: MapPlace[]): MapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { placeId: p.id, weight: p.weight, kind: p.kind, label: p.label },
    })),
  };
}

const COUNTRY_NAME: Record<string, string> = { US: "United States", CA: "Canada" };

function regionName(country: string | null, region: string): string {
  if (country === "CA") return CA_PROVINCES[region] ?? region;
  if (country === "US") return US_STATES[region] ?? region;
  return region;
}

/**
 * Countries, states/provinces and cities served, from placed rows only.
 * `records` counts items (orders or clients); `weight` sums their weights.
 * Stock on our own shelf is not reach — a location is not a place served — so
 * STOCK items are left out even where they share a point with an order.
 */
export function reachFrom(places: MapPlace[]): {
  countries: ReachRow[];
  regions: ReachRow[];
  cities: ReachRow[];
} {
  const tally = (
    map: Map<string, ReachRow>,
    key: string,
    label: string,
    records: number,
    weight: number,
  ) => {
    const row = map.get(key) ?? { key, label, records: 0, weight: 0 };
    row.records += records;
    row.weight += weight;
    map.set(key, row);
  };
  const countries = new Map<string, ReachRow>();
  const regions = new Map<string, ReachRow>();
  const cities = new Map<string, ReachRow>();

  for (const p of places) {
    const served = p.items.filter((i) => i.kind !== "STOCK");
    if (served.length === 0) continue;
    const n = served.length;
    const w = served.reduce((s, i) => s + i.weight, 0);
    const cc = p.countryCode;
    if (cc) tally(countries, cc, COUNTRY_NAME[cc] ?? cc, n, w);
    if (p.region) tally(regions, `${cc}:${p.region}`, regionName(cc, p.region), n, w);
    if (p.city) {
      tally(
        cities,
        `${cc}:${p.region}:${p.city.toLowerCase()}`,
        [p.city, p.region].filter(Boolean).join(", "),
        n,
        w,
      );
    }
  }
  const sorted = (m: Map<string, ReachRow>) =>
    [...m.values()].sort((a, b) => b.weight - a.weight || b.records - a.records || a.label.localeCompare(b.label));
  return { countries: sorted(countries), regions: sorted(regions), cities: sorted(cities) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The coverage sentence the screen always shows. It never implies full
 * coverage: the unplaced part is said out loud, split by why.
 */
export function coverageText(args: {
  placed: number;
  total: number;
  noun: string;
  unplaced: UnplacedRow[];
  /** What a missing address is called here: "delivery address", "address". */
  addressNoun: string;
}): string {
  const { placed, total, noun, unplaced, addressNoun } = args;
  if (total === 0) return `No ${noun} match these filters.`;
  const head = `Showing ${placed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`;
  if (placed === total) return `${head} — every one has a located ${addressNoun}.`;
  const by: Record<UnplacedReason, number> = { NO_ADDRESS: 0, TBD: 0, NOT_FOUND: 0, NOT_GEOCODED: 0 };
  for (const u of unplaced) by[u.reason] += u.weight;
  const parts: string[] = [];
  if (by.NO_ADDRESS) parts.push(`${by.NO_ADDRESS.toLocaleString("en-US")} have no ${addressNoun}`);
  if (by.TBD) parts.push(`${by.TBD.toLocaleString("en-US")} are TBD`);
  if (by.NOT_FOUND) parts.push(`${by.NOT_FOUND.toLocaleString("en-US")} couldn't be located`);
  if (by.NOT_GEOCODED) parts.push(`${by.NOT_GEOCODED.toLocaleString("en-US")} aren't geocoded yet`);
  return `${head} — ${parts.join(", ")}.`;
}

export { plural };
