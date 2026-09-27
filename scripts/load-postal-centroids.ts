import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

/**
 * Load GeoNames postal-code centroids (US ZIPs, Canadian FSAs) into v2's
 * `postal_centroids`, for offline geocoding on Inventory → Map.
 *
 * Data: GeoNames, https://download.geonames.org/export/zip/ — CC-BY 4.0
 * (attribution: GeoNames, geonames.org). Downloaded to the gitignored
 * .superpowers/geonames/ scratch; never committed.
 *
 *   npx tsx scripts/load-postal-centroids.ts             # download if missing, count
 *   npx tsx scripts/load-postal-centroids.ts --apply     # and load (replaces the table)
 *
 * Canada's small file is FSA-level ("V0E"), which is all a map needs; the full
 * CA file is ~900k rows for street-level precision the map never shows.
 */

const DIR = join(process.cwd(), ".superpowers", "geonames");
const FILES = ["US", "CA"] as const;

function fetchFile(country: string): string {
  const txt = join(DIR, `${country}.txt`);
  if (existsSync(txt)) return txt;
  mkdirSync(DIR, { recursive: true });
  const zip = join(DIR, `${country}.zip`);
  if (!existsSync(zip)) {
    execFileSync("curl", ["-sfSL", "-o", zip, `https://download.geonames.org/export/zip/${country}.zip`]);
  }
  execFileSync("unzip", ["-o", "-q", zip, `${country}.txt`, "-d", DIR]);
  return txt;
}

type Row = {
  countryCode: string;
  postalCode: string;
  place: string;
  admin1Code: string | null;
  lat: number;
  lng: number;
};

function parse(path: string): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("\t");
    const lat = Number(f[9]);
    const lng = Number(f[10]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // CA place names read "Central Okanagan and High Country (Revelstoke)";
    // the town in brackets is what a person would call it.
    const place = f[0] === "CA" ? (f[2].match(/\(([^)]+)\)\s*$/)?.[1] ?? f[2]) : f[2];
    rows.push({
      countryCode: f[0],
      postalCode: f[1].trim().toUpperCase(),
      place,
      admin1Code: f[4] || null,
      lat,
      lng,
    });
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const all: Row[] = [];
  for (const c of FILES) {
    const rows = parse(fetchFile(c));
    console.log(`${c}: ${rows.length} centroids`);
    all.push(...rows);
  }
  if (!apply) {
    console.log(`Dry run — ${all.length} rows would be loaded. Re-run with --apply.`);
    return;
  }
  await prisma.postalCentroid.deleteMany({ where: { countryCode: { in: [...FILES] } } });
  for (let i = 0; i < all.length; i += 5000) {
    await prisma.postalCentroid.createMany({ data: all.slice(i, i + 5000), skipDuplicates: true });
  }
  console.log(`Loaded ${await prisma.postalCentroid.count()} centroids.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
