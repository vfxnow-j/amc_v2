/**
 * Is a freshly verified dump plausible next to the previous good one?
 *
 * A database that was wiped, or a registry/restore accident that emptied it,
 * still dumps cleanly: the dump is valid, just empty. Comparing the new manifest
 * with the previous good set's catches that before it is trusted and before old
 * sets are rotated out. Pure: manifests in, problems out.
 */

export type ManifestDb = {
  name: string;
  kind: string;
  tables?: string[];
  rowsByTable?: Record<string, number>;
  copyRows?: number;
};
export type Manifest = { databases?: ManifestDb[] };

/** Tables that must exist in every dump of that kind. */
export const ANCHOR_TABLES: Record<string, string[]> = {
  main: ["entities", "settings", "users"],
  entity: ["_entity_migrations", "Movement", "Unit"],
};

/** Row drop that counts as suspect, and the previous size below which it is ignored. */
export const SHRINK_RATIO = 0.5;
export const SHRINK_MIN_PREVIOUS_ROWS = 20;

/**
 * Tables whose rows legitimately come and go, so emptying them is not a sign of
 * a wipe: sessions and every kind of token expire, notifications are dismissed
 * and swept, the portal request log and Current RMS apply log are operational
 * logs. Built from the live manifest (2026-10-20). `audit_logs` (2,085 rows,
 * growing since February) is business history, so it is deliberately NOT here;
 * nor are the reference tables postal_centroids and v1_link.origin, which
 * hold 82% of the rows and are exactly what a wipe must not hide behind.
 */
export const CHURN_TABLES: ReadonlySet<string> = new Set([
  "sessions",
  "verification_tokens",
  "notifications",
  "portal_request_log",
  "current_rms_apply_log",
]);
export function isChurn(table: string): boolean {
  return CHURN_TABLES.has(table) || /_tokens$/.test(table);
}

/** A table smaller than this before is too small to judge by a ratio. */
export const TABLE_MIN_PREVIOUS_ROWS = 50;

/** Entity tables that are append-only or never shrink: any decrease is an error. */
export const NEVER_SHRINK_ENTITY_TABLES = ["Movement", "Unit"];

export function anchorProblems(next: Manifest): string[] {
  const problems: string[] = [];
  for (const db of next.databases ?? []) {
    const have = new Set(db.tables ?? []);
    for (const t of ANCHOR_TABLES[db.kind] ?? []) {
      if (!have.has(t)) problems.push(`${db.name}: expected table ${t} is missing from the dump`);
    }
  }
  return problems;
}

/**
 * `prev` null means there is no earlier good set; only the anchor tables are
 * checked then. With `acceptShrink` (a deliberate purge) the comparison with
 * the previous set is skipped but the anchors are still required.
 */
export function compareManifests(
  prev: Manifest | null,
  next: Manifest,
  opts: { acceptShrink?: boolean } = {},
): string[] {
  const problems = anchorProblems(next);
  if (!prev || opts.acceptShrink) return problems;

  const nextByName = new Map((next.databases ?? []).map((d) => [d.name, d]));
  for (const before of prev.databases ?? []) {
    if (before.kind === "unregistered") continue;
    const after = nextByName.get(before.name);
    if (!after) {
      problems.push(`${before.name}: was in the previous set but is not in this one`);
      continue;
    }
    const have = new Set(after.tables ?? []);
    const lost = (before.tables ?? []).filter((t) => !have.has(t));
    if (lost.length) {
      problems.push(`${before.name}: ${lost.length} table(s) lost since the previous set (${lost.slice(0, 5).join(", ")})`);
    }
    for (const [table, was] of Object.entries(before.rowsByTable ?? {})) {
      const now = after.rowsByTable?.[table];
      if (now === undefined) continue; // a lost table is reported above
      if (before.kind === "entity" && NEVER_SHRINK_ENTITY_TABLES.includes(table) && now < was) {
        problems.push(`${before.name}: ${table} fell from ${was} to ${now} rows (it must never shrink)`);
      } else if (was >= TABLE_MIN_PREVIOUS_ROWS && now < was * SHRINK_RATIO && !isChurn(table)) {
        problems.push(`${before.name}: table ${table} fell from ${was} to ${now} rows (more than 50%)`);
      }
    }
    const was = before.copyRows ?? 0;
    const now = after.copyRows ?? 0;
    if (was >= SHRINK_MIN_PREVIOUS_ROWS && now < was * SHRINK_RATIO) {
      problems.push(`${before.name}: row count fell from ${was} to ${now} (more than 50%)`);
    }
  }
  return problems;
}
