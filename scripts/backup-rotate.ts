/**
 * Prints the rotation decision for a backup root, one line per entry:
 *   keep <name> <reasons>   |   delete <name>   |   ignore <name>
 * Deletes nothing: backup-v2.sh does that after re-checking each name. Only real
 * directories (never symlinks) holding a MANIFEST.json count as sets; stamps
 * from the future are ignored by the decision itself.
 *
 *   tsx scripts/backup-rotate.ts <backupRoot>
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { decideRotation } from "../src/lib/backups/rotation";

const root = process.argv[2];
if (!root) {
  console.error("usage: backup-rotate.ts <backupRoot>");
  process.exit(2);
}
const entries = readdirSync(root);
const isRealDir = (name: string) => {
  try {
    const st = lstatSync(path.join(root, name));
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};
const complete = entries.filter((n) => isRealDir(n) && existsSync(path.join(root, n, "MANIFEST.json")));
const other = entries.filter((n) => !complete.includes(n));
const decision = decideRotation(complete, new Date());
for (const k of decision.keep) console.log(`keep ${k.name} ${k.reasons.join(",")}`);
for (const d of decision.delete) console.log(`delete ${d}`);
for (const i of [...decision.ignored, ...other]) console.log(`ignore ${i}`);
