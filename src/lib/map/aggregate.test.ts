import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeocodeResult } from "@/lib/geo/geocode";
import {
  coverageText,
  dominantKind,
  placeCandidates,
  reachFrom,
  toGeoJSON,
  unplacedReason,
  type Candidate,
} from "./aggregate";

const geo = (over: Partial<GeocodeResult>): GeocodeResult => ({
  addressKey: "k",
  addressText: "t",
  status: "OK",
  lat: 34.17,
  lng: -118.31,
  precision: "POSTAL",
  source: "GEONAMES",
  countryCode: "US",
  region: "CA",
  city: "Burbank",
  postalCode: "91502",
  ...over,
});

const row = (over: Partial<Candidate>): Candidate => ({
  id: "r1",
  kind: "RENTAL",
  title: "RES-1",
  subtitle: "Client",
  href: "/dashboard/orders/r1",
  weight: 1,
  address: "A",
  ...over,
});

test("unplaced reasons name the fix", () => {
  assert.equal(unplacedReason(null, undefined), "NO_ADDRESS");
  assert.equal(unplacedReason("  ", undefined), "NO_ADDRESS");
  assert.equal(unplacedReason("TBD", undefined), "TBD");
  assert.equal(unplacedReason("A", undefined), "NOT_GEOCODED");
  assert.equal(unplacedReason("A", geo({ status: "SKIPPED" })), "TBD");
  assert.equal(unplacedReason("A", geo({ status: "NOT_FOUND", lat: null, lng: null })), "NOT_FOUND");
  assert.equal(unplacedReason("A", geo({})), null);
});

test("rows at one coordinate aggregate into one place; the rest are unplaced", () => {
  const geocodes = new Map<string, GeocodeResult>([
    ["A", geo({})],
    ["B", geo({ addressText: "B" })], // another address in the same ZIP
    ["C", geo({ lat: 40.74, lng: -74.0, city: "New York", region: "NY", postalCode: "10011" })],
    ["D", geo({ status: "NOT_FOUND", lat: null, lng: null })],
  ]);
  const { places, unplaced } = placeCandidates(
    [
      row({ id: "1", weight: 5, address: "A" }),
      row({ id: "2", weight: 2, address: "B", kind: "SALE" }),
      row({ id: "3", weight: 4, address: "C" }),
      row({ id: "4", weight: 7, address: "D" }),
      row({ id: "5", weight: 3, address: null }),
      row({ id: "6", weight: 1, address: "Dallas (TBD)" }),
    ],
    geocodes,
  );
  assert.equal(places.length, 2);
  assert.equal(places[0].label, "Burbank, CA 91502");
  assert.equal(places[0].weight, 7);
  assert.equal(places[0].kind, "RENTAL");
  assert.deepEqual(places[0].items.map((i) => i.id), ["1", "2"]);
  assert.equal(places[1].weight, 4);
  assert.deepEqual(
    unplaced.map((u) => [u.id, u.reason]),
    [["4", "NOT_FOUND"], ["5", "NO_ADDRESS"], ["6", "TBD"]],
  );

  const fc = toGeoJSON(places);
  assert.equal(fc.features.length, 2);
  assert.deepEqual(fc.features[0].geometry.coordinates, [-118.31, 34.17]);
  assert.equal(fc.features[0].properties.placeId, places[0].id);
  assert.equal(fc.features[0].properties.weight, 7);
});

test("dominant kind is by weight, not by count", () => {
  assert.equal(
    dominantKind([
      { kind: "RENTAL", weight: 1 },
      { kind: "RENTAL", weight: 1 },
      { kind: "STOCK", weight: 40 },
    ]),
    "STOCK",
  );
});

test("reach counts placed rows only, by country, region and city", () => {
  const geocodes = new Map<string, GeocodeResult>([
    ["A", geo({})],
    ["C", geo({ lat: 40.74, lng: -74.0, city: "New York", region: "NY", postalCode: "10011" })],
    ["E", geo({ lat: 51.5, lng: -119.2, city: "Revelstoke", region: "BC", countryCode: "CA", postalCode: "V0E 2S0" })],
  ]);
  const { places } = placeCandidates(
    [
      row({ id: "1", weight: 5, address: "A" }),
      row({ id: "2", weight: 2, address: "A" }),
      row({ id: "3", weight: 4, address: "C" }),
      row({ id: "4", weight: 9, address: "E" }),
      row({ id: "5", weight: 100, address: null }),
    ],
    geocodes,
  );
  const reach = reachFrom(places);
  assert.deepEqual(
    reach.countries.map((r) => [r.label, r.records, r.weight]),
    [["United States", 3, 11], ["Canada", 1, 9]],
  );
  assert.deepEqual(reach.regions.map((r) => r.label), ["British Columbia", "California", "New York"]);
  assert.deepEqual(reach.cities[0], { key: "CA:BC:revelstoke", label: "Revelstoke, BC", records: 1, weight: 9 });
});

test("coverage line never implies full coverage", () => {
  const u = (reason: "NO_ADDRESS" | "TBD" | "NOT_FOUND", weight: number) => ({
    id: reason, kind: "RENTAL" as const, title: "", subtitle: "", href: "", weight, reason, address: null,
  });
  assert.equal(
    coverageText({
      placed: 14,
      total: 324,
      noun: "units out",
      unplaced: [u("NO_ADDRESS", 300), u("TBD", 6), u("NOT_FOUND", 4)],
      addressNoun: "delivery address",
    }),
    "Showing 14 of 324 units out — 300 have no delivery address, 6 are TBD, 4 couldn't be located.",
  );
  assert.equal(
    coverageText({ placed: 3, total: 3, noun: "clients", unplaced: [], addressNoun: "address" }),
    "Showing 3 of 3 clients — every one has a located address.",
  );
  assert.equal(
    coverageText({ placed: 0, total: 0, noun: "units out", unplaced: [], addressNoun: "delivery address" }),
    "No units out match these filters.",
  );
});
