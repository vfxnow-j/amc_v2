#!/usr/bin/env bash
#
# Refresh v2's database from the live v1 database.
#
# v2 runs on its own copy of v1's data, taken once on 2026-07-28. Screens get
# built against it, and it goes stale: at the time of writing v1 had five weeks
# and twenty-five orders that v2 had never seen. This pulls a fresh copy so what
# is being reviewed is what the business actually looks like today.
#
#   ./scripts/refresh-from-v1.sh            # say what it would do, change nothing
#   ./scripts/refresh-from-v1.sh --apply    # do it
#
# It is NOT a plain restore, because v2's database is not just a copy any more.
# Three things live only in v2 and would be destroyed by one:
#
#   1. The asset grouping — 26 asset families and the models attached to them,
#      including at least one split corrected by hand. The grouping script is
#      re-runnable but would not reproduce a hand correction, so the rows are
#      carried across rather than regenerated.
#   2. v2's own credentials. The dev sign-in's password hash differs from v1's
#      by design; restoring v1's would lock the instance out of itself. Password
#      hashes, MFA secrets and appearance choices stay with v2 for every user
#      that already exists here. New v1 staff arrive with the restore and get
#      v1's hash, which is correct — they have never signed in to v2.
#   3. The Service Center and the asset families themselves: work_orders,
#      qc_test_runs and asset_families are v2-only tables. `prisma db push`
#      puts the schema back after the restore.
#
# It also copies v1's documents/ tree across, which is easy to forget and fails
# quietly: Document rows travel with the database, the PDFs they point at do
# not. Without this, every signed quote and delivery note on the refreshed
# orders resolves to a 410 — the record of the document survives, the document
# does not. The directory is gitignored, so it is only ever moved by this.
#
# The assistant residue v1 still carries (chat_sessions, chat_messages, and two
# llm_knowledge_* settings rows) is dropped again on the way in — v2 is
# deliberately clear of it, and a refresh must not quietly bring it back.
#
# v1 is read-only throughout: this reads its database and never writes to it,
# and never touches its .env — credentials come from the container.
#
# Run it yourself rather than asking an agent to. Two gates sit in the way of
# one: Claude Code's auto-mode classifier refuses the destructive SQL, and
# Prisma 7 refuses `db push` when it detects it was invoked by an agent, wanting
# consent naming the exact command. Both are correct to do so; the effect is
# that an agent gets a third of the way through and stops, which is a worse
# place to be than either end.
set -euo pipefail

CONTAINER=vfxnow-amc-db-1
V1_DB=vfxnow_amc
V2_DB=vfxnow_amc_v2
STAMP=$(date +%Y%m%d-%H%M%S)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V1_ROOT=/home/docker/projects/vfxnow-amc
BACKUP="$ROOT/backups/v2-before-refresh-$STAMP.sql.gz"
DUMP="$ROOT/backups/v1-snapshot-$STAMP.sql.gz"

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

psql1() { docker exec "$CONTAINER" psql -U postgres -d "$V1_DB" -tAc "$1"; }
psql2() { docker exec "$CONTAINER" psql -U postgres -d "$V2_DB" -tAc "$1"; }

say() { printf '%s\n' "$*"; }
rule() { printf -- '---\n'; }

# ---------------------------------------------------------------------------
# What the refresh would bring, before it brings it
# ---------------------------------------------------------------------------
counts() {
  local db=$1
  docker exec "$CONTAINER" psql -U postgres -d "$db" -tAc "
    select 'assets='||(select count(*) from assets)
        ||' units='||(select count(*) from asset_units)
        ||' orders='||(select count(*) from reservations)
        ||' invoices='||(select count(*) from invoices)
        ||' clients='||(select count(*) from clients)
        ||' leads='||(select count(*) from leads)"
}

say "v1 (live, read-only): $(counts "$V1_DB")"
say "v2 (this instance):   $(counts "$V2_DB")"
rule
say "carried across the refresh, because it exists only in v2:"
say "  asset families:      $(psql2 'select count(*) from asset_families')"
say "  models grouped:      $(psql2 'select count(*) from assets where "familyId" is not null')"
say "  credentials kept:    $(psql2 'select count(*) from users')"
say "  work orders:         $(psql2 'select count(*) from work_orders') (schema restored empty if none)"
rule

# Columns v1 has grown since the fork that v2's schema does not model. These are
# dropped by `prisma db push` and the data in them is lost — which is correct,
# v2 does not have the feature — but it should be a decision, not a surprise in
# a push warning. On 2026-09-01 this was `packages.rtoTermMonths`: v1 lets one
# RTO order quote several terms as package options, across 5 orders and 21
# packages at 12 and 24 months. All five still carry an order-level term, so the
# record shows a term; what is lost is the per-option alternatives.
say "documents: $(find "$V1_ROOT/documents" -type f 2>/dev/null | wc -l | tr -d ' ') files in v1, $(find "$ROOT/documents" -type f 2>/dev/null | wc -l | tr -d ' ') here — the rows travel with the database, the files do not"
rule
say "columns v1 has that v2 does not model (dropped by db push):"
docker exec "$CONTAINER" psql -U postgres -d "$V1_DB" -tAc "
  select '  '||table_name||'.'||column_name
    from information_schema.columns
   where table_schema='public'" > /tmp/refresh-v1-cols.txt
docker exec "$CONTAINER" psql -U postgres -d "$V2_DB" -tAc "
  select '  '||table_name||'.'||column_name
    from information_schema.columns
   where table_schema='public'" > /tmp/refresh-v2-cols.txt
comm -23 <(sort /tmp/refresh-v1-cols.txt) <(sort /tmp/refresh-v2-cols.txt) \
  | grep -v '\(chat_messages\|chat_sessions\)\.' || say "  none"
rule

if [[ "$APPLY" != true ]]; then
  say "Dry run. Nothing was changed."
  say "Re-run with --apply to:"
  say "  1. back v2 up to backups/v2-before-refresh-<stamp>.sql.gz"
  say "  2. snapshot v1 to backups/v1-snapshot-<stamp>.sql.gz"
  say "  3. replace v2's public schema with that snapshot"
  say "  4. prisma db push, and copy v1's documents/ tree across"
  say "  5. restore the carried-across rows, and drop the assistant residue"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1 · A way back
# ---------------------------------------------------------------------------
say "backing v2 up to $BACKUP"
docker exec "$CONTAINER" pg_dump -U postgres "$V2_DB" | gzip > "$BACKUP"
say "  $(du -h "$BACKUP" | cut -f1)"

# ---------------------------------------------------------------------------
# 2 · Set the v2-only rows aside, in a schema the restore does not touch
# ---------------------------------------------------------------------------
say "setting aside what is v2's own"
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists carry cascade;
create schema carry;

create table carry.asset_families as select * from public.asset_families;
create table carry.asset_family_map as
  select id, "familyId" from public.assets where "familyId" is not null;
create table carry.user_state as
  select id, email, "passwordHash", "mfaEnabled", "mfaSecret", "mfaDefault",
         "passwordChangedAt", "colorMode", "themeName"
  from public.users;
SQL

# ---------------------------------------------------------------------------
# 3 · Snapshot v1 and lay it down over v2's public schema
# ---------------------------------------------------------------------------
say "snapshotting v1 to $DUMP"
docker exec "$CONTAINER" pg_dump -U postgres "$V1_DB" | gzip > "$DUMP"
say "  $(du -h "$DUMP" | cut -f1)"

say "replacing v2's public schema"
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
drop schema public cascade;
create schema public;
grant all on schema public to postgres;
SQL
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" --quiet -v ON_ERROR_STOP=1 > /dev/null

# ---------------------------------------------------------------------------
# 4 · v2's own schema back on top
# ---------------------------------------------------------------------------
# Prisma 7 dropped --skip-generate; the datasource URL comes from
# prisma.config.ts, so this must run from the project root.
say "putting v2's schema back (prisma db push)"
( cd "$ROOT" && npx prisma db push --accept-data-loss )

# ---------------------------------------------------------------------------
# 4b · The files the Document rows point at
# ---------------------------------------------------------------------------
# rsync rather than cp: re-running a refresh should not recopy 14MB, and a file
# generated in v2 that v1 has never seen is v2's own and is left alone (no
# --delete). v1 is the source and is never written to.
say "copying v1's documents/ across"
if [[ -d "$V1_ROOT/documents" ]]; then
  mkdir -p "$ROOT/documents"
  rsync -a "$V1_ROOT/documents/" "$ROOT/documents/"
  say "  $(find "$ROOT/documents" -type f | wc -l | tr -d ' ') files, $(du -sh "$ROOT/documents" | cut -f1)"
else
  say "  v1 has no documents/ directory — nothing to copy"
fi

# ---------------------------------------------------------------------------
# 5 · The carried rows, and the residue that must not come back
# ---------------------------------------------------------------------------
say "restoring what was set aside, and dropping the assistant residue"
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
-- The grouping, exactly as it was. A model that v1 has since retired simply
-- fails to match and stays ungrouped, which is the right outcome.
-- Named columns, generated from what both tables actually have.
-- `insert ... select *` is wrong here: `prisma db push` recreates the table with
-- the column order of the Prisma model, which is not the order the set-aside
-- copy was made in. That mismatch happened on the 2026-09-01 run and was caught
-- only because two of the columns had incompatible types. Two text columns in
-- the wrong order would have been written silently.
do $$
declare cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'asset_families'
     and exists (
       select 1 from information_schema.columns k
        where k.table_schema = 'carry' and k.table_name = 'asset_families'
          and k.column_name = c.column_name);
  execute format(
    'insert into public.asset_families (%s) select %s from carry.asset_families
       on conflict (id) do nothing', cols, cols);
end $$;
update public.assets a
   set "familyId" = m."familyId"
  from carry.asset_family_map m
 where a.id = m.id
   and exists (select 1 from public.asset_families f where f.id = m."familyId");

-- v2 keeps its own credentials and appearance for anyone who already had them
-- here. Staff new since the last refresh arrive with v1's, which is correct.
update public.users u
   set "passwordHash"      = c."passwordHash",
       "mfaEnabled"        = c."mfaEnabled",
       "mfaSecret"         = c."mfaSecret",
       "mfaDefault"        = c."mfaDefault",
       "passwordChangedAt" = c."passwordChangedAt",
       "colorMode"         = c."colorMode",
       "themeName"         = c."themeName"
  from carry.user_state c
 where u.id = c.id;

-- Dropped from v2 on 2026-08-24 and not to be reintroduced by a refresh.
drop table if exists public.chat_messages;
drop table if exists public.chat_sessions;
delete from public.settings where key in ('llm_knowledge_snapshot', 'llm_knowledge_updated_at');

drop schema carry cascade;
SQL

rule
say "v2 now: $(counts "$V2_DB")"
say "  asset families:  $(psql2 'select count(*) from asset_families')"
say "  models grouped:  $(psql2 'select count(*) from assets where "familyId" is not null')"
say "  ungrouped models: $(psql2 'select count(*) from assets where "familyId" is null')"
rule
say "next:"
say "  npx tsx scripts/group-assets.ts           # what the new models would group into"
say "  npx tsx scripts/group-assets.ts --apply   # group them"
say "  npx tsx scripts/smoke-routes.ts           # walk every screen against the new data"
say "  rollback: gunzip -c $BACKUP | docker exec -i $CONTAINER psql -U postgres -d $V2_DB"
