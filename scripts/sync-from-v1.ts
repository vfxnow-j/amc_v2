/**
 * Diff v1 into v2 — v1 wins, v2's schema is never touched.
 *
 *   npx tsx scripts/sync-from-v1.ts                    # dry run: what would change, per table
 *   npx tsx scripts/sync-from-v1.ts --apply            # write it
 *   npx tsx scripts/sync-from-v1.ts --only reservations,checkouts
 *
 * Replaces scripts/refresh-from-v1.sh (owner, 2026-09-16). See
 * src/lib/v1-sync/engine.ts for how rows are matched and what v2 keeps.
 * Also copies any v1 document file v2 does not have yet: the rows travel with
 * the sync, the PDFs they point at do not.
 */
import "dotenv/config";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { SyncRestrictError, syncFromV1, type SyncReport } from "@/lib/v1-sync/engine";

const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.find((arg, i) => process.argv[i - 1] === "--only");
const only = onlyArg ? onlyArg.split(",").map((t) => t.trim()) : undefined;

function print(report: SyncReport) {
  const changed = report.tables.filter(
    (t) => t.inserted || t.updated || t.deleted || t.displaced,
  );
  console.log(`${report.applied ? "APPLIED" : "DRY RUN"} · ${report.tables.length} tables compared in ${report.ms} ms\n`);
  console.log("table".padEnd(32), "new".padStart(6), "changed".padStart(8), "deleted".padStart(8), "displaced".padStart(10), "v2-only kept".padStart(13));
  for (const t of report.tables) {
    if (!changed.includes(t) && !t.keptV2Only) continue;
    console.log(
      t.table.padEnd(32),
      String(t.inserted).padStart(6),
      String(t.updated).padStart(8),
      String(t.deleted).padStart(8),
      String(t.displaced).padStart(10),
      String(t.keptV2Only).padStart(13),
    );
  }
  if (changed.length === 0) console.log("(nothing differs)");
  if (report.unmapped.length) {
    console.log(`\nv1 columns v2 has no field for (not brought across): ${report.unmapped.join(", ")}`);
  }
  for (const o of report.orphans) {
    console.log(`orphans: ${o.rows} ${o.table} via ${o.constraint} → ${o.action}`);
  }
}

function copyDocuments() {
  const from = "/home/docker/projects/vfxnow-amc/documents";
  const to = path.resolve(__dirname, "..", "documents");
  if (!existsSync(from)) return console.log("\nv1 has no documents/ directory");
  // Read from v1, write only into v2; never overwrite a file v2 already has.
  cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
  console.log(`\ndocuments: copied any new files from v1 into ${to}`);
}

syncFromV1({ apply: APPLY, only })
  .then((report) => {
    print(report);
    if (APPLY) copyDocuments();
    process.exit(0);
  })
  .catch((error) => {
    if (error instanceof SyncRestrictError) {
      print(error.report);
      console.error(`\n${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
