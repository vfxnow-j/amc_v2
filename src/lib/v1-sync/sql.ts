/**
 * The SQL fragments the v1 sync builds, kept pure so they can be tested
 * without a database. engine.ts runs them.
 */

export const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A v2 column whose type is an enum (or an array of one), with the labels v2 knows. */
export type EnumColumn = { table: string; column: string; type: string; isArray: boolean; labels: string[] };

/** A row's key as text: the primary key, or its columns joined by ':'. */
export function keyOf(pk: string[], alias: string): string {
  return pk.length === 1
    ? `${alias}.${q(pk[0])}::text`
    : `concat_ws(':', ${pk.map((c) => `${alias}.${q(c)}::text`).join(", ")})`;
}

/** v2's labels for one enum column, as a text array literal. */
export function knownLabels(e: EnumColumn): string {
  return `array[${e.labels.map(lit).join(", ")}]::text[]`;
}

/**
 * A v1 enum column, read as text, in a form that is compared here and not in
 * v1. postgres_fdw ships a where clause built from plain operators to v1 to run
 * there, and in v1 the column is still its enum type, so `col = any(text[])`
 * fails remotely. A scalar subquery is never shipped.
 */
export const localText = (alias: string, column: string) => `(select ${alias}.${q(column)})`;

/**
 * One predicate per enum column over the v1 row `r` (read as text): true when
 * the value is null or one v2 has. A row is brought only when all hold.
 */
export function enumKeepPredicates(enums: EnumColumn[]): string[] {
  return enums.map((e) =>
    e.isArray
      ? `(r.${q(e.column)} is null or ${localText("r", e.column)} <@ ${knownLabels(e)})`
      : `(r.${q(e.column)} is null or ${localText("r", e.column)} = any(${knownLabels(e)}))`,
  );
}

/** The values of one enum column v2 does not have, with how many v1 rows hold each. */
export function unknownEnumValuesSql(table: string, e: EnumColumn): string {
  return e.isArray
    ? `select v as value, count(*) as n from v1_remote.${q(table)} r, unnest(r.${q(e.column)}) v
        where not (v = any(${knownLabels(e)})) group by v`
    : `select r.${q(e.column)} as value, count(*) as n from v1_remote.${q(table)} r
        where r.${q(e.column)} is not null and not (${localText("r", e.column)} = any(${knownLabels(e)})) group by 1`;
}

/** The held table: keys of v1 rows this run skips, which are therefore never deleted here. */
export const heldTable = (table: string) => q(`h_${table}`);

/** Fill the held table with the v1 rows holding an enum value v2 lacks. */
export function heldFromEnumsSql(table: string, pk: string[], keep: string[]): string {
  return `insert into ${heldTable(table)} (key)
    select ${keyOf(pk, "r")} from v1_remote.${q(table)} r
     where ${keep.length ? `not (${keep.join(" and ")})` : "false"}`;
}

/**
 * Add to the child's held table every v1 child row whose foreign key points at
 * a held parent row: a line of a skipped order is skipped with it.
 */
export function heldFromParentSql(fk: {
  child: string;
  parent: string;
  childCols: string[];
  parentCols: string[];
  childPk: string[];
  parentPk: string[];
}): string {
  const direct =
    fk.parentCols.length === fk.parentPk.length && fk.parentCols.every((c, i) => c === fk.parentPk[i]);
  // The held table keys the parent by its primary key; when the foreign key
  // names those columns the child's own values make the key, otherwise the
  // parent row is looked up in v1 to find it.
  const pointsAtHeld = direct
    ? `exists (select 1 from ${heldTable(fk.parent)} h where h.key = ${keyOf(fk.childCols, "c")})`
    : `exists (select 1 from v1_remote.${q(fk.parent)} p join ${heldTable(fk.parent)} h on h.key = ${keyOf(fk.parentPk, "p")}
                where ${fk.childCols.map((c, i) => `p.${q(fk.parentCols[i])} = c.${q(c)}`).join(" and ")})`;
  return `insert into ${heldTable(fk.child)} (key)
    select ${keyOf(fk.childPk, "c")} from v1_remote.${q(fk.child)} c
     where ${fk.childCols.map((c) => `c.${q(c)} is not null`).join(" and ")}
       and ${pointsAtHeld}
    on conflict do nothing`;
}

/** The stage's filter over the v1 row `r`: the table rule, known enum values, and not held. */
export function stageWhere(opts: { ruleWhere?: string; keep: string[]; table: string; pk: string[] }): string {
  const filters = [
    opts.ruleWhere,
    ...opts.keep,
    `not exists (select 1 from ${heldTable(opts.table)} h where h.key = ${keyOf(opts.pk, "r")})`,
  ].filter(Boolean);
  return `where ${filters.join(" and ")}`;
}

/**
 * The rows of v2 table `p` that v1 deleted: came from v1 (the ledger says so),
 * are gone from the stage, and were not merely skipped this run. Without the
 * held clause a row skipped for an enum value v2 lacks would read as deleted.
 */
export function deletedPredicate(opts: { table: string; stage: string; join: string; pk: string[] }): string {
  return `not exists (select 1 from ${opts.stage} s where ${opts.join})
      and exists (select 1 from v1_link.origin o where o.tbl = ${lit(opts.table)} and o.key = ${keyOf(opts.pk, "p")})
      and not exists (select 1 from ${heldTable(opts.table)} h where h.key = ${keyOf(opts.pk, "p")})`;
}

/** Ledger keys to forget: v1 no longer has them. A held key is kept, since v1 still does. */
export function ledgerPrunePredicate(opts: { table: string; stage: string; pk: string[] }): string {
  return `o.tbl = ${lit(opts.table)}
      and not exists (select 1 from ${opts.stage} s where ${keyOf(opts.pk, "s")} = o.key)
      and not exists (select 1 from ${heldTable(opts.table)} h where h.key = o.key)`;
}
