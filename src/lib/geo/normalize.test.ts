import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressKey,
  extractCityRegion,
  extractPostalCode,
  isPlaceholderAddress,
} from "./normalize";

test("addressKey folds case, whitespace, line breaks and trailing punctuation", () => {
  assert.equal(
    addressKey("134 W Verdugo Ave ,  Burbank,CA 91502.\n"),
    "134 w verdugo ave, burbank, ca 91502",
  );
  assert.equal(
    addressKey("27342 East Euclid Drive\nAurora, CO 80016"),
    addressKey("27342 east euclid drive aurora, co 80016 "),
  );
});

test("placeholders are detected, real addresses are not", () => {
  assert.equal(isPlaceholderAddress("TBD"), true);
  assert.equal(isPlaceholderAddress("Dallas, Texas (TBD)"), true);
  assert.equal(isPlaceholderAddress("to be determined"), true);
  assert.equal(isPlaceholderAddress("N/A"), true);
  assert.equal(isPlaceholderAddress("1669 19th St, Santa Monica, CA 90404"), false);
  assert.equal(isPlaceholderAddress(""), false);
  assert.equal(isPlaceholderAddress(null), false);
});

test("a US ZIP counts only at the end of a line, last one wins", () => {
  assert.equal(extractPostalCode("1669 19th St, Santa Monica, CA 90404")?.code, "90404");
  assert.equal(extractPostalCode("1387 Raiders Way, Henderson NV 89052 ")?.code, "89052");
  assert.equal(
    extractPostalCode("SONY PICTURES STUDIOS INC., 10202 W. Washington Blvd., Culver City, CA 90232")?.code,
    "90232",
  );
  assert.equal(
    extractPostalCode("13031 RITZ CARLTON HIGHLANDS CT\nThe Ritz-Carlton, Lake Tahoe\nMississauga, CA 96161")?.code,
    "96161",
  );
  assert.equal(extractPostalCode("Abby Collida\nP.O. Box 1825\nMontclair, NJ 07042")?.code, "07042");
  assert.equal(extractPostalCode("123 Main St, Austin, TX 78701-1234, USA")?.code, "78701");
  // Five-digit street numbers are not ZIPs.
  assert.equal(extractPostalCode("12020 Chandler Blvd., Suite 100"), null);
  assert.equal(extractPostalCode("4603 N. Stahl Park Suite #105"), null);
});

test("a Canadian postal code yields its FSA and province", () => {
  const pc = extractPostalCode("96 Cartier St (890)\nRevelstoke BC  V0E 2S0 ");
  assert.deepEqual(pc, { countryCode: "CA", code: "V0E", full: "V0E 2S0", region: "BC" });
  assert.equal(extractPostalCode("Toronto ON M5V3L9")?.code, "M5V");
});

test("city and region come from the end of a line", () => {
  assert.deepEqual(extractCityRegion("134 W Verdugo Ave, Burbank, CA 91502"), {
    countryCode: "US", city: "Burbank", region: "CA",
  });
  assert.deepEqual(extractCityRegion("6110 Washington Blvd, Culver City CA 90232 "), {
    countryCode: "US", city: "Culver City", region: "CA",
  });
  assert.deepEqual(extractCityRegion("1819 Dana Street, Suite D\nGlendale, CA. 91201"), {
    countryCode: "US", city: "Glendale", region: "CA",
  });
  assert.deepEqual(extractCityRegion("Dallas, Texas"), {
    countryCode: "US", city: "Dallas", region: "TX",
  });
  assert.deepEqual(extractCityRegion("Montclair New Jersey"), {
    countryCode: "US", city: "Montclair", region: "NJ",
  });
  assert.equal(extractCityRegion("El Paso Convention Center"), null);
  assert.equal(extractCityRegion("12020 Chandler Blvd., Suite 100"), null);
});
