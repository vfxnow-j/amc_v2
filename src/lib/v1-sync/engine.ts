import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  deletedPredicate,
  displacedPredicate,
  enumKeepPredicates,
  heldFromEnumsSql,
  heldFromParentSql,
  heldTable,
  keyOf as keyExpr,
  ledgerPrunePredicate,
  q,
  stageWhere,
  unknownEnumValuesSql,
  type EnumColumn,
} from "./sql";

/**
 * Bring v1's data into v2 as a diff — v1 wins, v2's schema is never touched.
 *
 * **Why this replaced the dump/restore refresh (owner, 2026-09-16).** v2 is an
 * independent system that reuses some v1 code, not a copy of v1's database. The
 * old refresh laid v1's whole schema over v2's and rebuilt v2's with `prisma db
 * push`, so every v2-only table and column survived only because a script
 * carried it by hand. This reads v1 through a read-only foreign link
 * (`v1_link`) and writes rows into v2's tables as v2 defines them: new v1 rows
 * are inserted, changed rows updated, and a row v1 deleted is deleted here.
 * v2-only tables and v2-only columns are simply never written.
 *
 * **v1 is read twice-guarded.** The foreign server is `updatable 'false'`, so
 * v2 refuses to send a write, and it opens every session on v1 with
 * `default_transaction_read_only=on`, so v1 would refuse one anyway.
 *
 * **Deletes only what came from v1.** `v1_link.origin` records every row key
 * this sync has seen in v1. A row is deleted here only when that ledger says it
 * came from v1 and v1 no longer has it — a row v2 created itself is never in the
 * ledger, so it is kept (and counted, so it is visible).
 *
 * **Logic decides where data goes.** Same-named columns map across by default.
 * `TABLE_RULES` holds the exceptions: tables not to sync at all, columns v2
 * owns once a row exists, and expressions that turn a v1 value into v2's
 * convention — order dates become calendar days at noon UTC, a sale's end date
 * becomes its order date. The transform is applied on the way *in*, so an
 * unchanged v1 row compares equal to its v2 copy and is not rewritten every run.
 *
 * Foreign keys are enforced as a batch rather than row by row: the load runs
 * with `session_replication_role = replica` (so tables can land in any order),
 * then every foreign key is checked, and a row left pointing at nothing is
 * handled the way its constraint says — cascade deletes, set-null nulls, and
 * restrict is reported and fails the run rather than committing a broken link.
 *
 * **A v1 value v2 cannot hold is skipped, never deleted.** v1's enum columns
 * are read as text and cast into v2's types on the way in. A row holding a
 * value v2's enum lacks (v1's FLOW orders, 2026-09-26) is left out of the stage
 * and reported; so is every row whose foreign key points at a skipped row (the
 * lines, packages and quote links of a skipped order). Their keys go in a
 * per-table held set, and neither the delete nor the ledger pruning touches a
 * held key — a skipped row stays exactly as it is in v2 until v2 can hold it.
 */

type Tx = Prisma.TransactionClient;

/** Never synced. Auth material stays v2's own; the assistant was dropped from v2. */
const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  "chat_messages",
  "chat_sessions",
  // A v1 session, API key or trust token must not open v2.
  "sessions",
  "accounts",
  "verification_tokens",
  "mfa_trust_tokens",
  "email_tokens",
  "api_keys",
]);

/** v1 columns v2 does not carry on purpose — reported as decisions, not surprises. */
const IGNORED_COLUMNS: Record<string, string> = {
  "reservations.billsFromSchedule":
    "v2 derives it: every rental that bills on a cycle recurs, and the term is termMonths (owner, 2026-09-26)",
  "asset_units.reacquiredAt": "owner, 2026-09-17: data only, no v2 column unless asked",
  "asset_units.reacquiredNotes": "owner, 2026-09-17: data only, no v2 column unless asked",
};

/** v2's calendar-day convention (lib/billing/calendar.ts `intendedDay`), in SQL. */
function calendarDay(column: string): string {
  const c = `r."${column}"`;
  return `case
    when ${c} is null then null
    when ${c}::time in ('00:00:00', '12:00:00') then date_trunc('day', ${c}) + interval '12 hours'
    else ((${c} at time zone 'UTC') at time zone 'America/Los_Angeles')::date + interval '12 hours'
  end`;
}

type TableRule = {
  /** v1 column → SQL expression over the v1 row `r`, producing v2's value. */
  transform?: Record<string, string>;
  /** Written on insert, never overwritten on update: v2 owns them once the row exists. */
  v2OwnedOnUpdate?: string[];
  /** Only v1 rows matching this SQL predicate over `r` are brought across. */
  where?: string;
};

const TABLE_RULES: Record<string, TableRule> = {
  reservations: {
    transform: {
      startDate: calendarDay("startDate"),
      // A sale has no term: its end date is its order date.
      endDate: `case when r."reservationType" = 'SALE' then ${calendarDay("startDate")} else ${calendarDay("endDate")} end`,
      quoteExpiresAt: calendarDay("quoteExpiresAt"),
      nextBillingDate: calendarDay("nextBillingDate"),
      recurrenceEndDate: calendarDay("recurrenceEndDate"),
      deliveryDate: calendarDay("deliveryDate"),
      returnDate: calendarDay("returnDate"),
      rtoStartDate: calendarDay("rtoStartDate"),
      // v2's rule, not v1's flag (lib/orders/recurring.ts): a sale never
      // recurs, a rent-to-own always does, anything else recurs when it bills
      // on a cycle. v1 has active monthly rentals flagged non-recurring, and
      // each read its first month's end as a missed return.
      isRecurring: `case
        when r."reservationType" = 'SALE' then false
        when r."reservationType" in ('RENT_TO_OWN', 'FLOW') then true
        else r."billingCycleType" <> 'ONE_TIME'
      end`,
    },
  },
  invoices: {
    transform: {
      periodStartDate: calendarDay("periodStartDate"),
      periodEndDate: calendarDay("periodEndDate"),
    },
  },
  // Which lease financed a purchase order or a funding request is linked in v2
  // (the lease record's "Funding & purchase orders"). v1 has the columns but
  // never sets them, so v1-wins would erase every link on the next sync.
  purchase_orders: { v2OwnedOnUpdate: ["leaseId"] },
  // Revenue earned is v2's own figure, derived from the checkouts and orders
  // this sync brings (lib/billing/earned.ts): v1 counts it by its isRecurring
  // switch and books a fixed term's whole charge up front, v2 by the billing
  // period (owner, 2026-09-17). scripts/sync-from-v1.ts re-derives it after
  // every apply, so a new unit's v1 figure does not stand either.
  asset_units: { v2OwnedOnUpdate: ["totalRevenue"] },
  funding_requests: { v2OwnedOnUpdate: ["leaseId"] },
  users: {
    // v2's sign-in is its own: the dev password differs from v1's by design,
    // and v2 keeps its own MFA enrolment. New v1 staff arrive with v1's.
    v2OwnedOnUpdate: ["passwordHash", "mfaEnabled", "mfaSecret", "mfaDefault", "passwordChangedAt"],
  },
  settings: {
    where: `r.key not in ('llm_knowledge_snapshot', 'llm_knowledge_updated_at')`,
    transform: {
      // v1's recipient list wins, but the label and the ticks only v2 has are
      // kept on each address v1 still lists.
      value: `case when r.key = 'notification_recipients' and jsonb_typeof(r.value) = 'array' then (
        select coalesce(jsonb_agg(e || coalesce((
          select x - 'email' - 'leads' - 'reservations' - 'insights' - 'traffic' - 'purchaseOrders' - 'inventory' - 'funding'
            from public.settings p, jsonb_array_elements(p.value) x
           where p.key = 'notification_recipients' and jsonb_typeof(p.value) = 'array'
             and lower(trim(x->>'email')) = lower(trim(e->>'email'))
           limit 1), '{}'::jsonb) order by n), '[]'::jsonb)
          from jsonb_array_elements(r.value) with ordinality as a(e, n))
        else r.value end`,
    },
  },
};

export type TableDiff = {
  table: string;
  inserted: number;
  updated: number;
  deleted: number;
  /** Rows here with no v1 counterpart that this sync did not bring: v2's own. */
  keptV2Only: number;
  /** v2 rows removed because a v1 row claims the same unique value. */
  displaced: number;
};

export type SyncReport = {
  applied: boolean;
  startedAt: Date;
  ms: number;
  tables: TableDiff[];
  /** v1 columns v2 has no field for yet — a decision, not an error. */
  unmapped: string[];
  /** v1 columns v2 leaves out on purpose, with the decision behind each. */
  ignored: { column: string; reason: string }[];
  /**
   * v1 rows not brought this run and kept as they are in v2 (never deleted):
   * the row holds an enum `value` in `column` that v2 lacks, or — when `parent`
   * is set — its foreign key `column` points at a row of `parent` that was skipped.
   */
  skipped: { table: string; column: string; value: string; rows: number; parent?: string }[];
  /** Rows left pointing at a deleted parent, and what was done about them. */
  orphans: { constraint: string; table: string; rows: number; action: string }[];
};

async function rows<T>(tx: Tx, sql: string): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql);
}

/** Re-link v1's tables, so a column v1 added since the last run is visible. */
async function relink(tx: Tx) {
  await tx.$executeRawUnsafe(`drop schema if exists v1_remote cascade`);
  await tx.$executeRawUnsafe(`create schema v1_remote`);
  await tx.$executeRawUnsafe(`import foreign schema public from server v1 into v1_remote`);

  // v1's enum columns come across declared as v2's enum types, so one v1 value
  // v2 doesn't have (FLOW, 2026-09-26) fails the fetch and aborts everything.
  // Read them as text; the stage casts each into v2's type, and rows holding a
  // value v2 lacks are skipped and reported instead.
  const enumCols = await rows<{ table: string; column: string; isArray: boolean }>(
    tx,
    `select c.relname as table, a.attname as column, (t.typcategory = 'A') as "isArray"
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_type t on t.oid = a.atttypid
       left join pg_type el on el.oid = t.typelem
      where c.relnamespace = 'v1_remote'::regnamespace and a.attnum > 0 and not a.attisdropped
        and (t.typtype = 'e' or el.typtype = 'e')`,
  );
  for (const e of enumCols) {
    await tx.$executeRawUnsafe(
      `alter foreign table v1_remote.${q(e.table)} alter column ${q(e.column)} type ${e.isArray ? "text[]" : "text"}`,
    );
  }
}

type ForeignKey = {
  name: string;
  child: string;
  parent: string;
  childCols: string[];
  parentCols: string[];
  onDelete: string;
};

/** v2's foreign keys, with their columns in order and their on-delete action. */
async function foreignKeys(tx: Tx): Promise<ForeignKey[]> {
  return rows<ForeignKey>(
    tx,
    `select con.conname as name, ch.relname as child, pa.relname as parent,
            array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as "childCols",
            array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as "parentCols",
            con.confdeltype::text as "onDelete"
       from pg_constraint con
       join pg_class ch on ch.oid = con.conrelid
       join pg_class pa on pa.oid = con.confrelid
      where con.contype = 'f' and con.connamespace = 'public'::regnamespace`,
  );
}

export async function syncFromV1(options: {
  apply: boolean;
  /** Limit to these tables (and nothing else). */
  only?: string[];
}): Promise<SyncReport> {
  const startedAt = new Date();
  const report: SyncReport = {
    applied: options.apply,
    startedAt,
    ms: 0,
    tables: [],
    unmapped: [],
    ignored: [],
    skipped: [],
    orphans: [],
  };

  const run = async (tx: Tx) => {
    const [{ db }] = await rows<{ db: string }>(tx, `select current_database() as db`);
    if (db !== "vfxnow_amc_v2") throw new Error(`Refusing to sync into "${db}"`);

    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `create table if not exists v1_link.origin (tbl text not null, key text not null, primary key (tbl, key))`,
    );
    await relink(tx);

    const columns = await rows<{ schema: string; table: string; column: string }>(
      tx,
      `select table_schema as schema, table_name as table, column_name as column
         from information_schema.columns
        where table_schema in ('public', 'v1_remote')
        order by ordinal_position`,
    );
    const colsOf = (schema: string, table: string) =>
      columns.filter((c) => c.schema === schema && c.table === table).map((c) => c.column);

    const v2Enums = await rows<EnumColumn>(
      tx,
      `select c.relname as table, a.attname as column,
              coalesce(el.typname, t.typname) as type, (t.typcategory = 'A') as "isArray",
              array(select e.enumlabel from pg_enum e where e.enumtypid = coalesce(el.oid, t.oid) order by e.enumsortorder)::text[] as labels
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_type t on t.oid = a.atttypid
         left join pg_type el on el.oid = t.typelem
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
          and (t.typtype = 'e' or el.typtype = 'e')`,
    );

    const v1Tables = [...new Set(columns.filter((c) => c.schema === "v1_remote").map((c) => c.table))];
    const v2Tables = new Set(columns.filter((c) => c.schema === "public").map((c) => c.table));

    const primaryKeys = await rows<{ table: string; column: string }>(
      tx,
      `select tc.table_name as table, kcu.column_name as column
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
        order by kcu.ordinal_position`,
    );
    const uniques = await rows<{ table: string; cols: string[] }>(
      tx,
      `select c.relname as table,
              array(select a.attname from unnest(i.indkey) with ordinality k(n, o)
                      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n order by k.o)::text[] as cols
         from pg_index i join pg_class c on c.oid = i.indrelid
        where c.relnamespace = 'public'::regnamespace and i.indisunique and not i.indisprimary`,
    );

    const syncable = v1Tables.filter((t) => v2Tables.has(t) && !EXCLUDED_TABLES.has(t)).sort();
    const tables = syncable.filter((t) => !options.only || options.only.includes(t));

    for (const table of v1Tables) {
      if (!v2Tables.has(table) || EXCLUDED_TABLES.has(table)) continue;
      const v2Cols = new Set(colsOf("public", table));
      for (const column of colsOf("v1_remote", table)) {
        if (v2Cols.has(column)) continue;
        const reason = IGNORED_COLUMNS[`${table}.${column}`];
        if (reason) report.ignored.push({ column: `${table}.${column}`, reason });
        else report.unmapped.push(`${table}.${column}`);
      }
    }

    const pkOf = (table: string) => primaryKeys.filter((p) => p.table === table).map((p) => p.column);
    const sharedOf = (table: string) => {
      const v2Cols = new Set(colsOf("public", table));
      return colsOf("v1_remote", table).filter((c) => v2Cols.has(c));
    };
    const enumsOf = (table: string) => {
      const shared = sharedOf(table);
      return v2Enums.filter((e) => e.table === table && shared.includes(e.column));
    };

    // Pre-pass, before any table is staged: which v1 rows this run skips. A row
    // holding an enum value v2 lacks is held, and so is any row whose foreign
    // key points at a held row, down every chain — otherwise the lines of a
    // skipped order would be inserted pointing at nothing, then cascade away.
    // Every syncable table gets a held set (even under --only), so a child
    // staged alone still sees its parent's.
    let grew = new Set<string>();
    for (const table of syncable) {
      const pk = pkOf(table);
      const enumsHere = enumsOf(table);
      if (pk.some((c) => enumsHere.some((e) => e.column === c))) {
        throw new Error(`${table}: a primary key column is an enum, so a skipped row has no key to hold`);
      }
      await tx.$executeRawUnsafe(`drop table if exists ${heldTable(table)}`);
      await tx.$executeRawUnsafe(`create temp table ${heldTable(table)} (key text primary key) on commit drop`);
      if (pk.length === 0 || enumsHere.length === 0) continue;
      for (const e of enumsHere) {
        const bad = await rows<{ value: string; n: bigint }>(tx, unknownEnumValuesSql(table, e));
        for (const b of bad) report.skipped.push({ table, column: e.column, value: b.value, rows: Number(b.n) });
      }
      if (await tx.$executeRawUnsafe(heldFromEnumsSql(table, pk, enumKeepPredicates(enumsHere)))) grew.add(table);
    }
    const fks = (await foreignKeys(tx)).filter((fk) => {
      const v1Child = colsOf("v1_remote", fk.child);
      const v1Parent = colsOf("v1_remote", fk.parent);
      return (
        syncable.includes(fk.child) &&
        syncable.includes(fk.parent) &&
        pkOf(fk.child).length > 0 &&
        pkOf(fk.parent).length > 0 &&
        fk.childCols.every((c) => v1Child.includes(c)) &&
        fk.parentCols.every((c) => v1Parent.includes(c))
      );
    });
    for (let pass = 0; grew.size && pass < 20; pass++) {
      const next = new Set<string>();
      for (const fk of fks.filter((k) => grew.has(k.parent))) {
        const added = await tx.$executeRawUnsafe(
          heldFromParentSql({ ...fk, childPk: pkOf(fk.child), parentPk: pkOf(fk.parent) }),
        );
        if (added) {
          report.skipped.push({ table: fk.child, column: fk.childCols.join(", "), value: "", rows: added, parent: fk.parent });
          next.add(fk.child);
        }
      }
      grew = next;
    }
    if (grew.size) throw new Error(`skipped rows still reaching further after 20 passes: ${[...grew].join(", ")}`);

    for (const table of tables) {
      const rule = TABLE_RULES[table] ?? {};
      const shared = sharedOf(table);
      const pk = pkOf(table);
      if (pk.length === 0) throw new Error(`${table} has no primary key to diff on`);

      const stage = q(`s_${table}`);
      const held = heldTable(table);
      const keyOf = (alias: string) => keyExpr(pk, alias);
      const enumsHere = enumsOf(table);
      // Enum columns arrive as text; each is cast into v2's type after its transform.
      const castOf = (c: string) => {
        const e = enumsHere.find((x) => x.column === c);
        return e ? `::${q(e.type)}${e.isArray ? "[]" : ""}` : "";
      };
      const select = shared
        .map((c) => `(${rule.transform?.[c] ?? `r.${q(c)}`})${castOf(c)} as ${q(c)}`)
        .join(", ");

      await tx.$executeRawUnsafe(`drop table if exists ${stage}`);
      await tx.$executeRawUnsafe(
        `create temp table ${stage} on commit drop as
           select ${select} from v1_remote.${q(table)} r
           ${stageWhere({ ruleWhere: rule.where, keep: enumKeepPredicates(enumsHere), table, pk })}`,
      );

      const join = pk.map((c) => `p.${q(c)} = s.${q(c)}`).join(" and ");
      const deleted = deletedPredicate({ table, stage, join, pk });
      const tableUniques = uniques.filter((u) => u.table === table && u.cols.every((c) => shared.includes(c)));
      const updatable = shared.filter((c) => !pk.includes(c) && !rule.v2OwnedOnUpdate?.includes(c));
      const differs = updatable.length
        ? `(${updatable.map((c) => `p.${q(c)}`).join(", ")}) is distinct from (${updatable.map((c) => `s.${q(c)}`).join(", ")})`
        : "false";

      const [counts] = await rows<{ ins: bigint; upd: bigint; del: bigint; kept: bigint; displaced: bigint }>(
        tx,
        `select
           (select count(*) from ${stage} s where not exists (select 1 from public.${q(table)} p where ${join})) as ins,
           (select count(*) from ${stage} s join public.${q(table)} p on ${join} where ${differs}) as upd,
           (select count(*) from public.${q(table)} p where ${deleted}) as del,
           (select count(*) from public.${q(table)} p
             where not exists (select 1 from ${stage} s where ${join})
               and not exists (select 1 from v1_link.origin o where o.tbl = '${table}' and o.key = ${keyOf("p")})
               and not exists (select 1 from ${held} h where h.key = ${keyOf("p")})) as kept,
           ${
             tableUniques.length
               ? `(select count(distinct ${keyOf("p")}) from public.${q(table)} p
                   where ${tableUniques
                     .map((u) => `(${displacedPredicate({ table, stage, join, pk, uniqueCols: u.cols })})`)
                     .join(" or ")})`
               : "0"
           } as displaced`,
      );

      const diff: TableDiff = {
        table,
        inserted: Number(counts.ins),
        updated: Number(counts.upd),
        deleted: Number(counts.del),
        keptV2Only: Number(counts.kept),
        displaced: Number(counts.displaced),
      };
      report.tables.push(diff);
      if (!options.apply) continue;

      // v1 deleted it: it goes here too. A held (skipped) row is not deleted.
      if (diff.deleted) {
        await tx.$executeRawUnsafe(`delete from public.${q(table)} p where ${deleted}`);
      }
      // A v2-only row holding a unique value v1 now uses: v1 wins. A held
      // (skipped) row is never evicted this way, matching the count above.
      for (const unique of tableUniques) {
        await tx.$executeRawUnsafe(
          `delete from public.${q(table)} p
            where ${displacedPredicate({ table, stage, join, pk, uniqueCols: unique.cols })}`,
        );
      }
      if (diff.updated && updatable.length) {
        await tx.$executeRawUnsafe(
          `update public.${q(table)} p set ${updatable.map((c) => `${q(c)} = s.${q(c)}`).join(", ")}
             from ${stage} s where ${join} and ${differs}`,
        );
      }
      if (diff.inserted) {
        await tx.$executeRawUnsafe(
          `insert into public.${q(table)} (${shared.map(q).join(", ")})
             select ${shared.map((c) => `s.${q(c)}`).join(", ")} from ${stage} s
              where not exists (select 1 from public.${q(table)} p where ${join})`,
        );
      }
      await tx.$executeRawUnsafe(`delete from v1_link.origin o where ${ledgerPrunePredicate({ table, stage, pk })}`);
      await tx.$executeRawUnsafe(
        `insert into v1_link.origin (tbl, key) select '${table}', ${keyOf("s")} from ${stage} s
            on conflict do nothing`,
      );
    }

    if (options.apply) {
      await resolveOrphans(tx, report);
      await recordRun(tx, report, Date.now() - startedAt.getTime());
    }
  };

  await prisma.$transaction(run, { timeout: 10 * 60_000, maxWait: 30_000 });
  report.ms = Date.now() - startedAt.getTime();
  return report;
}

/**
 * Keep a log of applied runs, so v2 can say how fresh its copy of v1 is and
 * what the last few syncs actually brought. The sync runs only when asked for
 * (owner, 2026-09-16: no cron). Only the tables a run changed are recorded; the
 * log is trimmed to a week.
 */
async function recordRun(tx: Tx, report: SyncReport, ms: number) {
  await tx.$executeRawUnsafe(
    `create table if not exists v1_link.sync_runs (
       id bigserial primary key,
       ran_at timestamptz not null default now(),
       ms integer not null,
       changed integer not null,
       tables jsonb not null
     )`,
  );
  const touched = report.tables.filter((t) => t.inserted || t.updated || t.deleted || t.displaced);
  const changed = touched.reduce((n, t) => n + t.inserted + t.updated + t.deleted + t.displaced, 0);
  await tx.$executeRawUnsafe(
    `insert into v1_link.sync_runs (ms, changed, tables) values ($1, $2, $3::jsonb)`,
    ms,
    changed,
    JSON.stringify(touched),
  );
  await tx.$executeRawUnsafe(
    `delete from v1_link.sync_runs where ran_at < now() - interval '7 days'`,
  );
}

/**
 * The load ran without foreign-key triggers, so check every key now and do what
 * each constraint would have done. Repeated until nothing changes, because one
 * cascade can orphan the next table down.
 */
async function resolveOrphans(tx: Tx, report: SyncReport) {
  const keys = await foreignKeys(tx);

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const key of keys) {
      const orphan = `${key.childCols.map((c) => `c.${q(c)} is not null`).join(" and ")}
        and not exists (select 1 from public.${q(key.parent)} p
                         where ${key.childCols.map((c, i) => `p.${q(key.parentCols[i])} = c.${q(c)}`).join(" and ")})`;
      const [{ n }] = await rows<{ n: bigint }>(
        tx,
        `select count(*) as n from public.${q(key.child)} c where ${orphan}`,
      );
      const count = Number(n);
      if (count === 0) continue;

      if (key.onDelete === "c") {
        await tx.$executeRawUnsafe(`delete from public.${q(key.child)} c where ${orphan}`);
        report.orphans.push({ constraint: key.name, table: key.child, rows: count, action: "deleted (cascade)" });
        changed = true;
      } else if (key.onDelete === "n") {
        await tx.$executeRawUnsafe(
          `update public.${q(key.child)} c set ${key.childCols.map((col) => `${q(col)} = null`).join(", ")} where ${orphan}`,
        );
        report.orphans.push({ constraint: key.name, table: key.child, rows: count, action: "set null" });
        changed = true;
      } else {
        report.orphans.push({ constraint: key.name, table: key.child, rows: count, action: "RESTRICT — sync rolled back" });
        throw new SyncRestrictError(report);
      }
    }
    if (!changed) return;
  }
}

export class SyncRestrictError extends Error {
  constructor(public report: SyncReport) {
    const last = report.orphans[report.orphans.length - 1];
    super(
      `${last.rows} ${last.table} rows would point at a deleted parent (${last.constraint}, restrict). Nothing was written.`,
    );
  }
}
