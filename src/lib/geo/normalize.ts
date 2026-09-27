/**
 * Free-text address → the pieces an offline geocoder can use.
 *
 * Every address in v2 is free text (delivery, client, billing, location), often
 * multi-line with an attention line or a company name on top. Nothing here
 * guesses a street: the most the map claims is a ZIP or postal-code centroid, or
 * a city centroid when there is no code. docs/inventory-map.md.
 *
 * Pure — no Prisma — so it is unit-tested and usable anywhere.
 */

/** The cache key: case, whitespace and line breaks folded, trailing punctuation dropped. */
export function addressKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[\s,.;]+$/g, "")
    .trim();
}

/** Lines of an address, trimmed, empty ones dropped. */
export function addressLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * "TBD", "Dallas, Texas (TBD)", "to be determined", "N/A" — a placeholder, not a
 * place. Hardware is only ever pinned at a real address (owner, 2026-09-26), so
 * these are skipped rather than resolved to the city they happen to name.
 */
export function isPlaceholderAddress(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\btbd\b|\btba\b|to be (determined|confirmed|announced)/.test(t)) {
    return true;
  }
  return /^(n\/?a|none|unknown|-+|\?+)$/.test(t);
}

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};

export const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

const STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** The first letter of a Canadian postal code names its province. */
const CA_PROVINCE_BY_LETTER: Record<string, string> = {
  A: "NL", B: "NS", C: "PE", E: "NB", G: "QC", H: "QC", J: "QC", K: "ON",
  L: "ON", M: "ON", N: "ON", P: "ON", R: "MB", S: "SK", T: "AB", V: "BC",
  X: "NT", Y: "YT",
};

export type PostalCode = {
  countryCode: "US" | "CA";
  /** US: the five-digit ZIP. CA: the forward sortation area ("V0E") — GeoNames' CA file is FSA-level. */
  code: string;
  /** CA: the full code as written ("V0E 2S0"); US: the ZIP. */
  full: string;
  /** The state or province the code implies, when it does (CA only). */
  region: string | null;
};

/**
 * The ZIP or Canadian postal code in an address, or null.
 *
 * A US ZIP counts only at the end of a line ("…, CA 91502", "Henderson NV
 * 89052", optionally followed by "USA"). Five-digit street numbers are common
 * ("10202 W. Washington Blvd", "12020 Chandler Blvd., Suite 100"), and taking
 * any five digits would put an address with no ZIP in New York state.
 * The last qualifying match wins — the ZIP sits under the street.
 */
export function extractPostalCode(text: string): PostalCode | null {
  const ca = [...text.matchAll(/\b([A-Z]\d[A-Z])[ -]?(\d[A-Z]\d)\b/gi)];
  if (ca.length > 0) {
    const m = ca[ca.length - 1];
    const fsa = m[1].toUpperCase();
    return {
      countryCode: "CA",
      code: fsa,
      full: `${fsa} ${m[2].toUpperCase()}`,
      region: CA_PROVINCE_BY_LETTER[fsa[0]] ?? null,
    };
  }

  let found: string | null = null;
  for (const line of addressLines(text)) {
    const m = line.match(
      /(?:^|[\s,])(\d{5})(?:-\d{4})?\s*[,.]?\s*(?:u\.?s\.?a?\.?|united states(?: of america)?)?\s*[,.]?$/i,
    );
    // A line that is only a number is a suite or a street number on its own.
    if (m && !/^\d{5}(?:-\d{4})?$/.test(line.trim())) found = m[1];
    else if (m && found === null && /^\d{5}$/.test(line.trim())) found = m[1];
  }
  return found ? { countryCode: "US", code: found, full: found, region: null } : null;
}

export type CityRegion = {
  countryCode: "US" | "CA";
  city: string;
  /** Two-letter state or province code. */
  region: string;
};

/**
 * "Burbank, CA", "Culver City CA 90232", "Dallas, Texas" — the city and state at
 * the end of a line. Used when there is no postal code. Null unless the state is
 * a real US state or Canadian province.
 */
export function extractCityRegion(text: string): CityRegion | null {
  const lines = addressLines(text).reverse();
  for (const raw of lines) {
    const line = raw
      .replace(/\(.*?\)/g, " ")
      .replace(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi, " ")
      .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
      .replace(/\b(u\.?s\.?a?\.?|united states|canada)\s*$/i, " ")
      .replace(/[\s,.]+$/g, "")
      .trim();

    const hit = splitCityRegion(line);
    if (hit) return hit;
  }
  return null;
}

/** Two-letter code for a state/province written as a code or a name. */
function regionCode(raw: string): { region: string; countryCode: "US" | "CA" } | null {
  const t = raw.trim().replace(/\.$/, "");
  const upper = t.toUpperCase();
  if (upper.length === 2 && US_STATES[upper]) return { region: upper, countryCode: "US" };
  if (upper.length === 2 && CA_PROVINCES[upper]) return { region: upper, countryCode: "CA" };
  const byName = STATE_BY_NAME[t.toLowerCase()];
  if (byName) return { region: byName, countryCode: "US" };
  return null;
}

/**
 * The end of one line → city + region. "…, Burbank, CA", "Culver City CA",
 * "Montclair New Jersey", "Dallas, Texas". The city is the words before the
 * region back to the previous comma; a city containing a digit is a street.
 */
function splitCityRegion(line: string): CityRegion | null {
  const words = line.split(/[\s,]+/).filter(Boolean);
  if (words.length < 2) return null;
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const reg = regionCode(words.slice(-take).join(" "));
    if (!reg) continue;
    // Walk back from the region to the previous comma.
    const head = line.slice(0, line.length).replace(/[\s,.]+$/, "");
    const regionText = words.slice(-take).join(" ");
    const idx = head.toLowerCase().lastIndexOf(regionText.toLowerCase());
    const before = head.slice(0, idx).replace(/[\s,]+$/, "");
    const city = before.split(",").pop()!.trim();
    if (!city || /\d/.test(city) || city.length > 40) return null;
    return { countryCode: reg.countryCode, city: titleCase(city), region: reg.region };
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ");
}
