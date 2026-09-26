# Orders pull from v1 (data only, mapped right) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring v1's current orders (and everything else that changed) into v2 as data only. The pull must never change v2's schema, never abort on a value v2 can't hold yet, and must bring the three v1 Flow orders over once v2 has Flow.

**Architecture:** `scripts/sync-from-v1.ts` / `src/lib/v1-sync/engine.ts` already diffs v1 into v2 through a read-only foreign link. This plan hardens the mapping in two ways:
- **Enum columns are read from v1 as text** and cast into v2's enums. Rows carrying a value v2 doesn't have are **reported and skipped, never deleted**.
- **v1 columns v2 deliberately doesn't carry are listed with their reason**, so the report separates decisions from surprises.

Then the pull runs as a dry run, is reviewed with the owner, and is applied only on the owner's word.

**Tech Stack:** Postgres 16 postgres_fdw (`v1_link` server, `v1_remote` schema), Prisma 7 raw SQL, `npx tsx`.

## Global Constraints

- **No schema change in a pull** (owner, 2026-09-26: "last time the migration broke the schema in v2, so avoid that, we just focus the data in these pulls and you add the logic of mapping right"). Never run `prisma db push` or `migrate`, and never restore a dump.
- v1 is read-only. The foreign server is `updatable 'false'` and opens every session with `default_transaction_read_only=on`. Never test either guard with a write against v1.
- **v1 wins on data**, and a row v1 deleted is deleted in v2, but only rows the `v1_link.origin` ledger says came from v1.
- **Run only when the owner asks.** There's no cron. A dry run is fine at any time; `--apply` needs the owner's explicit go in this conversation.
- The three v1 Flow orders (`FLW-2026-00001..3`, all DRAFT) are **legitimate orders**: they come over once v2's Flow plan (`2026-09-26-flow-order-type.md`, Task 1) is applied.
- Commits: prose, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, explicit paths under `flock /tmp/vfxnow-v2-git.lock`.

---

### Task 1: The engine reads v1 enums as text and skips what v2 can't hold

**Why it fails today (2026-09-26 dry run):** `import foreign schema` declares v1's enum columns with v2's enum *type*, so fetching v1's `reservationType = 'FLOW'` fails the cast inside Postgres and aborts the whole transaction (`invalid input value for enum "ReservationType": "FLOW"`). It rolled back, so nothing was written.

There's a second trap in simply filtering those rows out: the delete step treats "in the ledger but missing from the stage" as "v1 deleted it". A skipped row that already exists in v2 would be **deleted**. Skipped keys must be excluded from delete and from ledger pruning.

**Files:**
- Modify: `src/lib/v1-sync/engine.ts` (`relink`, the stage build, the delete/ledger statements, `SyncReport`, `TABLE_RULES.reservations.isRecurring`)
- Modify: `scripts/sync-from-v1.ts` (`print`)

**Interfaces:**
- Produces:
  - `SyncReport.skipped: { table: string; column: string; value: string; rows: number }[]`
  - `SyncReport.ignored: { column: string; reason: string }[]`
  - `const IGNORED_COLUMNS: Record<string, string>` (key `table.column`, value the reason)

- [ ] **Step 1: Read enums as text.** At the end of `relink(tx)`, add:

```ts
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
  )
  for (const e of enumCols) {
    await tx.$executeRawUnsafe(
      `alter foreign table v1_remote.${q(e.table)} alter column ${q(e.column)} type ${e.isArray ? 'text[]' : 'text'}`,
    )
  }
```

- [ ] **Step 2: Find unknown values and skip those rows.** In `syncFromV1`, after `columns` is loaded, load v2's enum types and labels for `public` columns:

```ts
    const v2Enums = await rows<{ table: string; column: string; type: string; isArray: boolean; labels: string[] }>(
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
    )
```

Inside the per-table loop, before `create temp table ${stage}`:

```ts
      const enumsHere = v2Enums.filter((e) => e.table === table && shared.includes(e.column))
      const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
      const known = (e: (typeof enumsHere)[number]) => `array[${e.labels.map(lit).join(', ')}]::text[]`
      // A row is kept only when every enum value it holds exists in v2.
      const enumOk = enumsHere.map((e) =>
        e.isArray
          ? `(r.${q(e.column)} is null or r.${q(e.column)} <@ ${known(e)})`
          : `(r.${q(e.column)} is null or r.${q(e.column)} = any(${known(e)}))`,
      )
      for (const e of enumsHere) {
        const bad = await rows<{ value: string; n: bigint }>(
          tx,
          e.isArray
            ? `select v as value, count(*) as n from v1_remote.${q(table)} r, unnest(r.${q(e.column)}) v
                where not (v = any(${known(e)})) group by v`
            : `select r.${q(e.column)} as value, count(*) as n from v1_remote.${q(table)} r
                where r.${q(e.column)} is not null and not (r.${q(e.column)} = any(${known(e)})) group by 1`,
        )
        for (const b of bad) report.skipped.push({ table, column: e.column, value: b.value, rows: Number(b.n) })
      }
      const castOf = (c: string) => {
        const e = enumsHere.find((x) => x.column === c)
        return e ? `::${q(e.type)}${e.isArray ? '[]' : ''}` : ''
      }
```

Change the `select` builder so each enum column is cast into v2's type **after** the transform:

```ts
      const select = shared
        .map((c) => `(${rule.transform?.[c] ?? `r.${q(c)}`})${castOf(c)} as ${q(c)}`)
        .join(", ");
```

The stage's `where` combines the rule's filter and the enum filter:

```ts
      const filters = [rule.where, ...enumOk].filter(Boolean)
      // … `select ${select} from v1_remote.${q(table)} r ${filters.length ? `where ${filters.join(' and ')}` : ''}`
```

Transforms that compare an enum column with a literal (`r."reservationType" = 'SALE'`) still work on text.

- [ ] **Step 3: A skipped row is never deleted.** Right after the stage is created, record the keys that were skipped:

```ts
      const held = q(`h_${table}`)
      await tx.$executeRawUnsafe(`drop table if exists ${held}`)
      await tx.$executeRawUnsafe(
        `create temp table ${held} on commit drop as
           select ${keyOf("r")} as key from v1_remote.${q(table)} r
            where ${enumOk.length ? `not (${enumOk.join(' and ')})` : 'false'}`,
      )
```

Add `and not exists (select 1 from ${held} h where h.key = ${keyOf("p")})` to **both** the `del` count and the `delete … where` statement. In the ledger pruning (`delete from v1_link.origin …`), add `and not exists (select 1 from ${held} h where h.key = o.key)`. A skipped row then stays exactly as it is in v2 until v2 can hold its value.

`keyOf("r")` works because the key columns (ids) are never enums. Assert that: `if (pk.some((c) => enumsHere.some((e) => e.column === c))) throw new Error(...)`.

- [ ] **Step 4: Deliberate non-mappings.** Add under `EXCLUDED_TABLES`:

```ts
/** v1 columns v2 does not carry on purpose — reported as decisions, not surprises. */
const IGNORED_COLUMNS: Record<string, string> = {
  "reservations.billsFromSchedule": "v2 derives it: every rental that bills on a cycle recurs, and the term is termMonths (owner, 2026-09-26)",
  "asset_units.reacquiredAt": "owner, 2026-09-17: data only, no v2 column unless asked",
  "asset_units.reacquiredNotes": "owner, 2026-09-17: data only, no v2 column unless asked",
};
```

In the unmapped loop, push to `report.ignored` (with its reason) when the key is in `IGNORED_COLUMNS`, otherwise to `report.unmapped`. Initialise `skipped: [], ignored: []` in the report.

- [ ] **Step 5: FLOW recurs.** Add a FLOW arm to `TABLE_RULES.reservations.transform.isRecurring`, matching `recurringFor` once the Flow plan's Task 6 lands:

```sql
        when r."reservationType" in ('RENT_TO_OWN', 'FLOW') then true
```

- [ ] **Step 6: Print it.** In `scripts/sync-from-v1.ts` `print`, after the unmapped line:

```ts
  for (const s of report.skipped) {
    console.log(`skipped (v2 has no ${s.column} "${s.value}" yet — kept as-is here, not deleted): ${s.rows} ${s.table}`)
  }
  for (const i of report.ignored) console.log(`not brought, by decision: ${i.column} — ${i.reason}`)
```

- [ ] **Step 7: Prove it with a dry run, before Flow exists in v2.** Run `npx tsx scripts/sync-from-v1.ts`.

  Expected:
  - The run completes. There's no enum error.
  - `skipped … reservationType "FLOW" … 3 reservations`.
  - `reservation_items` rows for those orders show up either as orphans (cascade) in the dry-run arithmetic or as inserts that point at missing parents. **Note which.** If the child lines of a skipped order would be inserted and then cascade-deleted, also skip them: add a `where` to child tables that excludes rows whose `reservationId` is in the reservations `held` table (build it before the children's stage, since tables run in sorted order: compute the reservations held keys first, in a pre-pass).
  - The `ignored` lines list the three decisions above.
  - `unmapped` lists the Flow columns. That's expected until the Flow plan's Task 1 lands.

- [ ] **Step 8: Prove "skipped is never deleted"** without touching v1 and without keeping any change in v2. In one `psql` session on v2:
  1. `begin`;
  2. copy one existing v1-origin reservation to a scratch row with a new id;
  3. add that id to `v1_link.origin`;
  4. confirm by `select` that the engine's delete predicate for `reservations`, with the new `held` exclusion applied, doesn't select a row whose key is in `held`;
  5. `rollback`.

  Paste the session into the commit message. (The simpler proof, a unit test on the SQL-string builder, is acceptable instead if the builder is pulled into a pure function.)

- [ ] **Step 9: Commit**: "fix(sync): read v1 enums as text; skip what v2 can't hold instead of aborting". Prose: the 09-26 failure; why a naïve filter would have deleted rows; the deliberate non-mappings.

---

### Task 2: The orders pull (after Flow Task 1, on the owner's go)

- [ ] **Step 1: Preconditions.**
  - The Flow plan's Task 1 is applied: `select 'FLOW' = any(enum_range(null::"ReservationType")::text[])` → `t`.
  - The Flow columns exist.
  - Task 1 above is committed.
  - Take a v2 backup first: `docker exec vfxnow-amc-db-1 pg_dump -U postgres vfxnow_amc_v2 | gzip > backups/v2-before-pull-$(date +%Y%m%d-%H%M%S).sql.gz`.

- [ ] **Step 2: Dry run** — `npx tsx scripts/sync-from-v1.ts`. Expected: no `skipped` lines, and no Flow columns under `unmapped`. Summarise the diff for the owner:
  - per table: new, changed, deleted, displaced;
  - **every deletion by name** (orders, lines, packages);
  - every displaced row (v1 and v2 both issued the same number; a v2 test order loses);
  - the v2-only rows kept.

  **Stop and ask the owner to go ahead.**

- [ ] **Step 3: Apply** on the owner's word — `npx tsx scripts/sync-from-v1.ts --apply`. The script re-derives `asset_units.totalRevenue` afterwards. Then re-run the dry run → `(nothing differs)`.

- [ ] **Step 4: The Flow orders reproduce.** Write `scripts/check-flow-orders.ts` (read-only). For each FLOW order in v2 it runs v2's `flowOrder()` on the synced lines and config **with funding switched off** (`funding: []`, which is how v1 priced it), and compares it with the synced v1-stored `flowContractValue`, `flowMonthlyPayment`, and each line's `rate`/`subtotal`. Expected: equal to the cent for all three. A mismatch means the engine port or the inputs differ. Stop and find which before going on. Then print the same orders **with** lease funding. The contract and payment are unchanged (the client price never reads funding); only the economics move. List those economics for the owner.

- [ ] **Step 5: Record-by-record check,** as on 2026-09-17. A read-only DO block compares every shared table, column and row (raw `::text`, joined on the primary key) between `v1_remote` and `public`. Expected differences only:
  - reservation dates (calendar-day convention);
  - `isRecurring` (v2's rule);
  - the recipient-merged setting;
  - v2-owned columns (`passwordHash` and MFA, `totalRevenue`, `leaseId` on POs and funding requests);
  - v2-only rows on v1 records (the 8 configurator lines and 2 packages on RES-2026-00062, which stay until the owner deletes them).

  Report anything else.

- [ ] **Step 6: Screens.** `npx tsx scripts/smoke-routes.ts` → no broken routes. Open one of the Flow orders and one changed rental on :3001.

- [ ] **Step 7: Memory.** Update `vfxnow-v2-refresh-from-v1.md` with:
  - the enum-as-text change;
  - the skip-never-delete rule;
  - the `IGNORED_COLUMNS` list;
  - this run's diff.

  Also update `vfxnow-v2-port-2026-09-26.md`.
