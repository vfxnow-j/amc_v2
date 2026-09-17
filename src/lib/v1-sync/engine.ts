import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

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
        when r."reservationType" = 'RENT_TO_OWN' then true
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
  /** Rows left pointing at a deleted parent, and what was done about them. */
  orphans: { constraint: string; table: string; rows: number; action: string }[];
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function rows<T>(tx: Tx, sql: string): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql);
}

/** Re-link v1's tables, so a column v1 added since the last run is visible. */
async function relink(tx: Tx) {
  await tx.$executeRawUnsafe(`drop schema if exists v1_remote cascade`);
  await tx.$executeRawUnsafe(`create schema v1_remote`);
  await tx.$executeRawUnsafe(`import foreign schema public from server v1 into v1_remote`);
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

    const tables = v1Tables
      .filter((t) => v2Tables.has(t) && !EXCLUDED_TABLES.has(t))
      .filter((t) => !options.only || options.only.includes(t))
      .sort();

    for (const table of v1Tables) {
      if (!v2Tables.has(table) || EXCLUDED_TABLES.has(table)) continue;
      const v2Cols = new Set(colsOf("public", table));
      for (const column of colsOf("v1_remote", table)) {
        if (!v2Cols.has(column)) report.unmapped.push(`${table}.${column}`);
      }
    }

    for (const table of tables) {
      const rule = TABLE_RULES[table] ?? {};
      const v2Cols = new Set(colsOf("public", table));
      const shared = colsOf("v1_remote", table).filter((c) => v2Cols.has(c));
      const pk = primaryKeys.filter((p) => p.table === table).map((p) => p.column);
      if (pk.length === 0) throw new Error(`${table} has no primary key to diff on`);

      const stage = q(`s_${table}`);
      const keyOf = (alias: string) =>
        pk.length === 1 ? `${alias}.${q(pk[0])}::text` : `concat_ws(':', ${pk.map((c) => `${alias}.${q(c)}::text`).join(", ")})`;
      const select = shared
        .map((c) => `${rule.transform?.[c] ?? `r.${q(c)}`} as ${q(c)}`)
        .join(", ");

      await tx.$executeRawUnsafe(`drop table if exists ${stage}`);
      await tx.$executeRawUnsafe(
        `create temp table ${stage} on commit drop as
           select ${select} from v1_remote.${q(table)} r ${rule.where ? `where ${rule.where}` : ""}`,
      );

      const join = pk.map((c) => `p.${q(c)} = s.${q(c)}`).join(" and ");
      const updatable = shared.filter((c) => !pk.includes(c) && !rule.v2OwnedOnUpdate?.includes(c));
      const differs = updatable.length
        ? `(${updatable.map((c) => `p.${q(c)}`).join(", ")}) is distinct from (${updatable.map((c) => `s.${q(c)}`).join(", ")})`
        : "false";

      const [counts] = await rows<{ ins: bigint; upd: bigint; del: bigint; kept: bigint; displaced: bigint }>(
        tx,
        `select
           (select count(*) from ${stage} s where not exists (select 1 from public.${q(table)} p where ${join})) as ins,
           (select count(*) from ${stage} s join public.${q(table)} p on ${join} where ${differs}) as upd,
           (select count(*) from public.${q(table)} p
             where not exists (select 1 from ${stage} s where ${join})
               and exists (select 1 from v1_link.origin o where o.tbl = '${table}' and o.key = ${keyOf("p")})) as del,
           (select count(*) from public.${q(table)} p
             where not exists (select 1 from ${stage} s where ${join})
               and not exists (select 1 from v1_link.origin o where o.tbl = '${table}' and o.key = ${keyOf("p")})) as kept,
           ${
             uniques.filter((u) => u.table === table && u.cols.every((c) => shared.includes(c))).length
               ? `(select count(distinct ${keyOf("p")}) from public.${q(table)} p join ${stage} s on (${uniques
                   .filter((u) => u.table === table && u.cols.every((c) => shared.includes(c)))
                   .map((u) => `(${u.cols.map((c) => `p.${q(c)} = s.${q(c)}`).join(" and ")})`)
                   .join(" or ")}) where not (${join})
                   and not exists (select 1 from ${stage} s2 where ${pk.map((c) => `s2.${q(c)} = p.${q(c)}`).join(" and ")}))`
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

      // v1 deleted it: it goes here too.
      if (diff.deleted) {
        await tx.$executeRawUnsafe(
          `delete from public.${q(table)} p
            where not exists (select 1 from ${stage} s where ${join})
              and exists (select 1 from v1_link.origin o where o.tbl = '${table}' and o.key = ${keyOf("p")})`,
        );
      }
      // A v2-only row holding a unique value v1 now uses: v1 wins.
      for (const unique of uniques.filter((u) => u.table === table && u.cols.every((c) => shared.includes(c)))) {
        await tx.$executeRawUnsafe(
          `delete from public.${q(table)} p using ${stage} s
            where ${unique.cols.map((c) => `p.${q(c)} = s.${q(c)}`).join(" and ")}
              and not (${join})
              and not exists (select 1 from ${stage} s2 where ${pk.map((c) => `s2.${q(c)} = p.${q(c)}`).join(" and ")})`,
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
      await tx.$executeRawUnsafe(
        `delete from v1_link.origin o where o.tbl = '${table}'
            and not exists (select 1 from ${stage} s where ${keyOf("s")} = o.key)`,
      );
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
  const keys = await rows<{
    name: string;
    child: string;
    parent: string;
    childCols: string[];
    parentCols: string[];
    onDelete: string;
  }>(
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
