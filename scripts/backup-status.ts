/**
 * Prints the latest backup and restore-test status from ${BACKUP_ROOT}
 * (default ~/backups/v2). Read-only. Exits 1 unless both are ok.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assessBackup, assessVerify, formatBytes, summariseDatabases } from "../src/lib/backups/status";

const root = process.env.BACKUP_ROOT || path.join(os.homedir(), "backups", "v2");
function read(name: string): Record<string, unknown> | null | "unreadable" {
  let raw: string;
  try {
    raw = readFileSync(path.join(root, name), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  try {
    return JSON.parse(raw);
  } catch {
    return "unreadable";
  }
}
const status = read("STATUS.json");
const verify = read("VERIFY.json");
const b = assessBackup(status);
const v = assessVerify(verify);
const sum = summariseDatabases(status);
console.log(`Backup:  ${b.state.toUpperCase()}${b.reason ? " - " + b.reason : ""}`);
if (status && status !== "unreadable") {
  console.log(`  last run ${String(status.lastRunAt)}, ${sum.count} database(s), ${formatBytes(sum.bytes)}, set ${String(status.setDir)}`);
  console.log(`  kept sets: ${String(status.keptSets)} (oldest ${String(status.oldestKeptSet)})`);
  for (const e of Array.isArray(status.errors) ? status.errors : []) console.log(`  error: ${String(e)}`);
  for (const e of Array.isArray(status.warnings) ? status.warnings : []) console.log(`  warning: ${String(e)}`);
}
console.log(`Restore test: ${v.state.toUpperCase()}${v.reason ? " - " + v.reason : ""}`);
if (verify && verify !== "unreadable") {
  console.log(`  verified ${String(verify.verifiedAt)}, set ${String(verify.setDir)}`);
  for (const c of Array.isArray(verify.checks) ? (verify.checks as { ok: boolean; name: string; detail: string }[]) : []) {
    if (!c.ok) console.log(`  FAILED: ${c.name} - ${c.detail}`);
  }
}
process.exit(b.state === "ok" && v.state === "ok" ? 0 : 1);
