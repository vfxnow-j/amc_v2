import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAddress, type GeoLookups, type GeocodeResult } from "./geocode";

const CENTROIDS: Record<string, { lat: number; lng: number; place: string; admin1Code: string }> = {
  "US:91502": { lat: 34.17, lng: -118.31, place: "Burbank", admin1Code: "CA" },
  "CA:V0E": { lat: 51.0, lng: -118.2, place: "Revelstoke", admin1Code: "BC" },
};
const CITIES: Record<string, { lat: number; lng: number }> = {
  "US:TX:Dallas": { lat: 32.78, lng: -96.8 },
  "US:CA:Burbank": { lat: 34.18, lng: -118.32 },
};

function lookups(cache: Record<string, GeocodeResult> = {}): GeoLookups & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async cached(key) {
      calls.push(`cache:${key}`);
      return cache[key] ?? null;
    },
    async postal(cc, code) {
      calls.push(`postal:${cc}:${code}`);
      const hit = CENTROIDS[`${cc}:${code}`];
      return hit ? { ...hit } : null;
    },
    async city(cc, region, city) {
      calls.push(`city:${cc}:${region}:${city}`);
      const hit = CITIES[`${cc}:${region}:${city}`];
      return hit ? { ...hit, place: city, admin1Code: region } : null;
    },
  };
}

test("postal centroid first", async () => {
  const r = await resolveAddress("134 W Verdugo Ave, Burbank, CA 91502", lookups());
  assert.equal(r?.status, "OK");
  assert.equal(r?.precision, "POSTAL");
  assert.equal(r?.lat, 34.17);
  assert.equal(r?.city, "Burbank");
  assert.equal(r?.region, "CA");
  assert.equal(r?.countryCode, "US");
  assert.equal(r?.postalCode, "91502");
});

test("Canadian FSA resolves with the city from the text", async () => {
  const r = await resolveAddress("96 Cartier St\nRevelstoke BC  V0E 2S0", lookups());
  assert.equal(r?.status, "OK");
  assert.equal(r?.countryCode, "CA");
  assert.equal(r?.region, "BC");
  assert.equal(r?.city, "Revelstoke");
});

test("unknown ZIP falls back to city/state", async () => {
  const r = await resolveAddress("1 Nowhere Rd, Burbank, CA 99999", lookups());
  assert.equal(r?.status, "OK");
  assert.equal(r?.precision, "CITY");
  assert.equal(r?.lat, 34.18);
  assert.equal(r?.postalCode, "99999");
});

test("placeholders are skipped without a lookup", async () => {
  const l = lookups();
  const r = await resolveAddress("Dallas, Texas (TBD)", l);
  assert.equal(r?.status, "SKIPPED");
  assert.equal(r?.lat, null);
  assert.deepEqual(l.calls, ["cache:dallas, texas (tbd)"]);
});

test("nothing usable → NOT_FOUND, empty → null", async () => {
  const r = await resolveAddress("El Paso Convention Center", lookups());
  assert.equal(r?.status, "NOT_FOUND");
  assert.equal(await resolveAddress("   ", lookups()), null);
});

test("cache wins; refresh re-resolves GEONAMES rows but never MANUAL ones", async () => {
  const key = "134 w verdugo ave, burbank, ca 91502";
  const manual: GeocodeResult = {
    addressKey: key, addressText: "x", status: "OK", lat: 1, lng: 2, precision: "MANUAL",
    source: "MANUAL", countryCode: "US", region: "CA", city: "Burbank", postalCode: null,
  };
  const stale: GeocodeResult = { ...manual, source: "GEONAMES", precision: "POSTAL" };
  const addr = "134 W Verdugo Ave, Burbank, CA 91502";

  assert.equal((await resolveAddress(addr, lookups({ [key]: manual }), { refresh: true }))?.lat, 1);
  assert.equal((await resolveAddress(addr, lookups({ [key]: stale })))?.lat, 1);
  assert.equal((await resolveAddress(addr, lookups({ [key]: stale }), { refresh: true }))?.lat, 34.17);
});
