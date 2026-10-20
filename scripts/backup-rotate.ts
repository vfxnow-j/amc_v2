/**
 * Prints the rotation decision for a backup root, one line per set:
 *   keep <name> <reasons>   |   delete <name>   |   ignore <name>
 * Deletes nothing: backup-v2.sh does that after re-checking each name. Only
 * directories holding a MANIFEST.json count as sets; others are ignored.
 *
 *   tsx scripts/backup-rotate.ts <backupRoot>
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { decideRotation } from "../src/lib/backups/rotation";

const root = process.argv[2];
if (!root) {
  console.error("usage: backup-rotate.ts <backupRoot>");
  process.exit(2);
}
const entries = readdirSync(root).filter((name) => {
  try {
    return statSync(path.join(root, name)).isDirectory();
  } catch {
    return false;
  }
});
const complete = entries.filter((n) => existsSync(path.join(root, n, "MANIFEST.json")));
const incomplete = entries.filter((n) => !complete.includes(n));
const decision = decideRotation(complete, new Date());
for (const k of decision.keep) console.log(`keep ${k.name} ${k.reasons.join(",")}`);
for (const d of decision.delete) console.log(`delete ${d}`);
for (const i of [...decision.ignored, ...incomplete]) console.log(`ignore ${i}`);
