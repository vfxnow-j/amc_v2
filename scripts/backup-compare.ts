/**
 * Compares a new MANIFEST.json with the previous good one and prints one
 * problem per line (nothing when the set looks plausible). Always exits 0; the
 * caller decides what a problem means.
 *
 *   tsx scripts/backup-compare.ts <newManifest> [<previousManifest>|-] [--accept-shrink]
 */
import { readFileSync } from "node:fs";
import { compareManifests, type Manifest } from "../src/lib/backups/compare";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const acceptShrink = process.argv.includes("--accept-shrink");
const read = (p: string): Manifest => JSON.parse(readFileSync(p, "utf8"));
const next = read(args[0]);
const prev = args[1] && args[1] !== "-" ? read(args[1]) : null;
for (const p of compareManifests(prev, next, { acceptShrink })) console.log(p);
