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
# The restore drops v2's whole public schema and `prisma db push` builds it
# back — so anything that exists only in v2 comes back EMPTY unless it is
# carried. What that covers has grown a long way past the three things this
# script was written for:
#
#   1. The asset grouping — 26 asset families and the models attached to them,
#      including at least one split corrected by hand. The grouping script is
#      re-runnable but would not reproduce a hand correction, so the rows are
#      carried across rather than regenerated.
#   2. v2's own credentials and appearance. The dev sign-in's password hash
#      differs from v1's by design; restoring v1's would lock the instance out
#      of itself. Hashes, MFA secrets, theme, shades and tile style stay with
#      v2 for every user that already exists here. New v1 staff arrive with the
#      restore and get v1's hash, which is correct — they have never signed in
#      to v2.
#   3. **Every v2-only table** (CARRIED_TABLES below): the Service Center, the
#      asset families and components, the saved dashboards, and the whole Client
#      Tracker — conversations, asks and environment profiles. Those last three
#      hold the only record of what a rep was told on a call. There is no v1 to
#      re-import them from, so losing them loses them. The same is true of the
#      approval history (who cleared which purchase order, request or quote, at
#      what amount, and why one was denied) and of who is allowed to approve.
#   4. **v2-only columns on tables v1 also has**: the client tracker's owner,
#      pin and seasonal months; `clients.prospectAt`, without which a quote held
#      against an unverified shell becomes sendable and approvable;
#      `reservation_items.includedInParent`, without which component lines start
#      contributing to order totals; `services.kind`; and
#      `purchase_orders.raisedById`, without which a STAFF member's own draft PO
#      stops being theirs to edit or submit.
#
# A preflight refuses to apply if a v2-only table this script does not carry has
# rows in it, so the next feature to add one stops the refresh rather than being
# silently erased by it.
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
RESUME=false
case "${1:-}" in
  --apply)  APPLY=true ;;
  # Pick the run back up at step 4, for the one way this script actually
  # fails: Prisma refuses `db push` when it detects an agent invoked it, and
  # that refusal lands *after* the restore has replaced v2's public schema.
  # The database is then v1's data with none of v2's own schema on it, and the
  # only route forward is steps 4, 4b and 5.
  #
  # NEVER re-run from the top to recover. Step 2 begins `drop schema if exists
  # carry cascade` and rebuilds carry from `public.asset_families`, which no
  # longer exists once step 3 has run — it would destroy everything set aside
  # and then fail, turning a recoverable stall into real data loss.
  --resume) APPLY=true; RESUME=true ;;
esac

# Every table that exists only in v2, in an order that satisfies its own
# foreign keys on the way back in (qc_test_runs after work_orders, client_asks
# after interactions). The preflight below checks this list against the
# database rather than trusting it, so adding a v2-only table and forgetting
# this line stops the refresh instead of losing the table.
CARRIED_TABLES=(
  asset_families
  asset_components
  dashboard_templates
  dashboard_layouts
  work_orders
  qc_test_runs
  interactions
  client_asks
  client_environment_items
  approval_requests
  user_approval_scopes
)

# ---------------------------------------------------------------------------
# v1 is live. These are the safeguards that keep it that way.
# ---------------------------------------------------------------------------
# Both databases share one container and one superuser, so nothing in Postgres
# itself separates a read of v1 from a write to it — only the name passed to -d.
# Three guards, each independent of the others:
#
#   1. The names are pinned. Every destructive statement below targets $V2_DB;
#      if either variable is ever edited, or the two are ever swapped, the script
#      stops here before it has touched anything.
#   2. Every v1 session is read-only at the server. V1_RO sets
#      default_transaction_read_only, so any write that reaches v1 — through a
#      typo, a copied line, psql1 used where psql2 was meant — is rejected by
#      Postgres ("cannot execute ... in a read-only transaction") rather than
#      executed. It guards against mistakes, not intent: a superuser session can
#      switch it back off, and nothing here does.
#   3. assert_v2_target confirms, against the live connection rather than a
#      variable, that the database about to be dropped really is v2.
if [[ "$V1_DB" != "vfxnow_amc" || "$V2_DB" != "vfxnow_amc_v2" || "$V1_DB" == "$V2_DB" ]]; then
  printf 'refusing to run: expected V1_DB=vfxnow_amc and V2_DB=vfxnow_amc_v2, got V1_DB=%s V2_DB=%s\n' \
    "$V1_DB" "$V2_DB" >&2
  exit 1
fi

V1_RO=(-e "PGOPTIONS=-c default_transaction_read_only=on")

psql1() { docker exec "${V1_RO[@]}" "$CONTAINER" psql -U postgres -d "$V1_DB" -tAc "$1"; }
psql2() { docker exec "$CONTAINER" psql -U postgres -d "$V2_DB" -tAc "$1"; }

assert_v2_target() {
  local actual
  actual=$(psql2 "select current_database()")
  if [[ "$actual" != "vfxnow_amc_v2" ]]; then
    printf 'refusing to continue: expected to be connected to vfxnow_amc_v2, got "%s"\n' "$actual" >&2
    exit 1
  fi
}

say() { printf '%s\n' "$*"; }
rule() { printf -- '---\n'; }

# ---------------------------------------------------------------------------
# What the refresh would bring, before it brings it
# ---------------------------------------------------------------------------
counts() {
  local db=$1
  docker exec "${V1_RO[@]}" "$CONTAINER" psql -U postgres -d "$db" -tAc "
    select 'assets='||(select count(*) from assets)
        ||' units='||(select count(*) from asset_units)
        ||' orders='||(select count(*) from reservations)
        ||' invoices='||(select count(*) from invoices)
        ||' clients='||(select count(*) from clients)
        ||' leads='||(select count(*) from leads)"
}

STOP=false
if [[ "$RESUME" != true ]]; then
  say "v1 (live, read-only): $(counts "$V1_DB")"
  say "v2 (this instance):   $(counts "$V2_DB")"
  rule
  say "carried across the refresh, because it exists only in v2:"
  for t in "${CARRIED_TABLES[@]}"; do
    printf '  %-26s %s rows\n' "$t" "$(psql2 "select count(*) from $t")"
  done
  say "  models grouped:            $(psql2 'select count(*) from assets where "familyId" is not null')"
  say "  credentials + appearance:  $(psql2 'select count(*) from users') users"
  say "  v2-only columns:           clients owner/pin/season/prospect, services.kind, reservation_items.includedInParent, purchase_orders.raisedById"
  rule

  # The guard that matters. A v2-only table this script does not carry is a table
  # `prisma db push` will rebuild empty — silently, because nothing else in the
  # run mentions it. Comparing against the database rather than a hand-kept list
  # means the next feature to add one stops the refresh instead of being erased by
  # it. Empty uncarried tables are reported and allowed: there is nothing to lose.
  docker exec "${V1_RO[@]}" "$CONTAINER" psql -U postgres -d "$V1_DB" -tAc \
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" \
    | sort > /tmp/refresh-v1-tables.txt
  docker exec "$CONTAINER" psql -U postgres -d "$V2_DB" -tAc \
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" \
    | sort > /tmp/refresh-v2-tables.txt
  printf '%s\n' "${CARRIED_TABLES[@]}" | sort > /tmp/refresh-carried.txt

  UNCARRIED=$(comm -13 /tmp/refresh-v1-tables.txt /tmp/refresh-v2-tables.txt \
            | comm -23 - /tmp/refresh-carried.txt)
  STOP=false
  if [[ -n "$UNCARRIED" ]]; then
    say "v2-only tables this script does NOT carry:"
    while read -r t; do
      [[ -z "$t" ]] && continue
      n=$(psql2 "select count(*) from \"$t\"")
      if [[ "$n" == "0" ]]; then
        say "  $t — empty, nothing to lose"
      else
        say "  $t — $n ROWS, WOULD BE DESTROYED"
        STOP=true
      fi
    done <<< "$UNCARRIED"
    rule
  fi

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
  docker exec "${V1_RO[@]}" "$CONTAINER" psql -U postgres -d "$V1_DB" -tAc "
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
    if [[ "$STOP" == true ]]; then
      say "It would REFUSE to run: a v2-only table above holds rows and is not carried."
    fi
    say "Re-run with --apply to:"
    say "  1. back v2 up to backups/v2-before-refresh-<stamp>.sql.gz"
    say "  2. snapshot v1 to backups/v1-snapshot-<stamp>.sql.gz"
    say "  3. replace v2's public schema with that snapshot"
    say "  4. prisma db push, and copy v1's documents/ tree across"
    say "  5. restore the carried-across rows, and drop the assistant residue"
    exit 0
  fi

  if [[ "$STOP" == true ]]; then
    say "REFUSING: a v2-only table listed above holds rows this script does not carry."
    say "Add it to CARRIED_TABLES (and give it FK guards in step 5) before refreshing."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 1 · A way back
# ---------------------------------------------------------------------------
if [[ "$RESUME" == true ]]; then
  say "resuming at step 4 - steps 1-3 already ran, carry schema left intact"
else
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
SQL

# Whole tables, copied as they stand. Column order is not preserved by
# `db push` — see step 5 — so the copy is read back by name, never by position.
for t in "${CARRIED_TABLES[@]}"; do
  docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 \
    -c "create table carry.\"$t\" as select * from public.\"$t\""  > /dev/null
done

# Columns that live on tables v1 also has. The restore brings v1's version of
# the table, `db push` re-adds these as null or default, and step 5 puts the
# values back by id.
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
create table carry.asset_family_map as
  select id, "familyId" from public.assets where "familyId" is not null;

create table carry.user_state as
  select id, email, "passwordHash", "mfaEnabled", "mfaSecret", "mfaDefault",
         "passwordChangedAt", "colorMode", "themeName", "tileStyle", "navShade",
         "groundShade", "dashboardView"
  from public.users;

-- The Client Tracker's inputs, plus the flag that holds an unonboarded
-- prospect's quote shut. Only rows that actually carry something, so the
-- update in step 5 touches as little as possible.
create table carry.client_state as
  select id, "ownerId", "seasonalMonths", "tempPin", "tempPinReason",
         "tempPinUntil", "tempPinById", "prospectAt", "agreementSource",
         "agreementReservationId"
  from public.clients
 where "ownerId" is not null or "tempPin" is not null or "prospectAt" is not null
    or "agreementSource" is not null or coalesce(array_length("seasonalMonths", 1), 0) > 0;

-- Without this a component line stops being part of its parent's price and
-- starts adding to the order total.
create table carry.item_state as
  select id, "includedInParent" from public.reservation_items where "includedInParent";

create table carry.service_state as
  select id, kind from public.services where kind is not null;

-- Who raised a PO in v2. Only v2-raised POs carry one, and those are exactly
-- the rows a restore from v1 deletes — so today this usually restores nothing.
-- It is carried anyway so the day v2 is the system of record, this is not the
-- column somebody forgets.
create table carry.po_state as
  select id, "raisedById" from public.purchase_orders where "raisedById" is not null;
SQL

# ---------------------------------------------------------------------------
# 3 · Snapshot v1 and lay it down over v2's public schema
# ---------------------------------------------------------------------------
say "snapshotting v1 to $DUMP"
docker exec "${V1_RO[@]}" "$CONTAINER" pg_dump -U postgres "$V1_DB" | gzip > "$DUMP"
say "  $(du -h "$DUMP" | cut -f1)"

say "replacing v2's public schema"
assert_v2_target
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
drop schema public cascade;
create schema public;
grant all on schema public to postgres;
SQL
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" --quiet -v ON_ERROR_STOP=1 > /dev/null
fi

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
-- Copy a carried table back by NAME, never by position. `prisma db push`
-- recreates a table in the Prisma model's column order, which is not the order
-- the set-aside copy was made in. That mismatch happened on the 2026-09-01 run
-- and was caught only because two of the columns had incompatible types; two
-- text columns in the wrong order would have been written silently.
--
-- Columns the carried copy has and the rebuilt table does not are dropped, and
-- vice versa — which is what should happen when v2's own schema has moved on.
create or replace function carry.restore(tbl text) returns void
language plpgsql as $fn$
declare cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = tbl
     and exists (
       select 1 from information_schema.columns k
        where k.table_schema = 'carry' and k.table_name = tbl
          and k.column_name = c.column_name);
  if cols is null then return; end if;
  execute format(
    'insert into public.%I (%s) select %s from carry.%I on conflict (id) do nothing',
    tbl, cols, cols, tbl);
end $fn$;

-- ── Foreign keys, before anything is inserted ─────────────────────────────
-- v1 is five weeks further on than the copy these rows were made against, and
-- it may have deleted something they point at. A required reference that no
-- longer resolves means the row cannot come back; a NULLABLE one means only
-- that the link is gone, and dropping the link keeps the row — a conversation
-- whose client was deleted is still the only record of that conversation.

delete from carry.asset_components c
 where not exists (select 1 from public.assets a where a.id = c."assetId")
    or not exists (select 1 from public.assets a where a.id = c."componentAssetId");

delete from carry.dashboard_layouts c
 where not exists (select 1 from public.users u where u.id = c."userId");

delete from carry.work_orders c
 where not exists (select 1 from public.asset_units u where u.id = c."assetUnitId");

delete from carry.qc_test_runs c
 where not exists (select 1 from carry.work_orders w where w.id = c."workOrderId");

delete from carry.client_environment_items c
 where not exists (select 1 from public.clients x where x.id = c."clientId");

update carry.work_orders c set "assignedTechId" = null
 where "assignedTechId" is not null
   and not exists (select 1 from public.users u where u.id = c."assignedTechId");
update carry.work_orders c set "openedById" = null
 where "openedById" is not null
   and not exists (select 1 from public.users u where u.id = c."openedById");
update carry.work_orders c set "openedFromReservationId" = null
 where "openedFromReservationId" is not null
   and not exists (select 1 from public.reservations r where r.id = c."openedFromReservationId");

update carry.interactions c set "clientId" = null
 where "clientId" is not null
   and not exists (select 1 from public.clients x where x.id = c."clientId");
update carry.interactions c set "leadId" = null
 where "leadId" is not null
   and not exists (select 1 from public.leads l where l.id = c."leadId");
update carry.interactions c set "contactId" = null
 where "contactId" is not null
   and not exists (select 1 from public.client_contacts k where k.id = c."contactId");
update carry.interactions c set "createdById" = null
 where "createdById" is not null
   and not exists (select 1 from public.users u where u.id = c."createdById");
update carry.interactions c set "reservationId" = null
 where "reservationId" is not null
   and not exists (select 1 from public.reservations r where r.id = c."reservationId");

update carry.client_asks c set "clientId" = null
 where "clientId" is not null
   and not exists (select 1 from public.clients x where x.id = c."clientId");
update carry.client_asks c set "leadId" = null
 where "leadId" is not null
   and not exists (select 1 from public.leads l where l.id = c."leadId");
update carry.client_asks c set "reservationId" = null
 where "reservationId" is not null
   and not exists (select 1 from public.reservations r where r.id = c."reservationId");
update carry.client_asks c set "interactionId" = null
 where "interactionId" is not null
   and not exists (select 1 from carry.interactions i where i.id = c."interactionId");

update carry.client_environment_items c set "createdById" = null
 where "createdById" is not null
   and not exists (select 1 from public.users u where u.id = c."createdById");

update carry.client_state c set "ownerId" = null
 where "ownerId" is not null
   and not exists (select 1 from public.users u where u.id = c."ownerId");
update carry.client_state c set "tempPinById" = null
 where "tempPinById" is not null
   and not exists (select 1 from public.users u where u.id = c."tempPinById");
update carry.client_state c set "agreementReservationId" = null
 where "agreementReservationId" is not null
   and not exists (select 1 from public.reservations r where r.id = c."agreementReservationId");

-- Approval history is kept whole even when the record it was about is gone: a
-- v2-raised PO or order does not survive the restore, but that somebody
-- approved it at a given amount is still a fact, and recordId is not a foreign
-- key for exactly that reason. The people are nullable links with their names
-- snapshotted beside them, so a departed user loses the link, not the row.
update carry.approval_requests c set "requestedById" = null
 where "requestedById" is not null
   and not exists (select 1 from public.users u where u.id = c."requestedById");
update carry.approval_requests c set "decidedById" = null
 where "decidedById" is not null
   and not exists (select 1 from public.users u where u.id = c."decidedById");

-- A scope belongs to a person; without them it means nothing.
delete from carry.user_approval_scopes c
 where not exists (select 1 from public.users u where u.id = c."userId");
update carry.user_approval_scopes c set "grantedById" = null
 where "grantedById" is not null
   and not exists (select 1 from public.users u where u.id = c."grantedById");
SQL

# The tables themselves, in an order that satisfies their own foreign keys.
for t in "${CARRIED_TABLES[@]}"; do
  n=$(docker exec "$CONTAINER" psql -U postgres -d "$V2_DB" -tAc \
        "select carry.restore('$t'); select count(*) from public.\"$t\"" | tail -1)
  say "  $t: $n"
done

say "  putting v2-only columns back"
docker exec -i "$CONTAINER" psql -U postgres -d "$V2_DB" -v ON_ERROR_STOP=1 <<'SQL'
-- The grouping, exactly as it was. A model v1 has since retired simply fails to
-- match and stays ungrouped, which is the right outcome.
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
       "themeName"         = c."themeName",
       "tileStyle"         = c."tileStyle",
       "navShade"          = c."navShade",
       "groundShade"       = c."groundShade",
       "dashboardView"     = c."dashboardView"
  from carry.user_state c
 where u.id = c.id;

update public.clients x
   set "ownerId"                = c."ownerId",
       "seasonalMonths"         = c."seasonalMonths",
       "tempPin"                = c."tempPin",
       "tempPinReason"          = c."tempPinReason",
       "tempPinUntil"           = c."tempPinUntil",
       "tempPinById"            = c."tempPinById",
       "prospectAt"             = c."prospectAt",
       "agreementSource"        = c."agreementSource",
       "agreementReservationId" = c."agreementReservationId"
  from carry.client_state c
 where x.id = c.id;

update public.reservation_items i
   set "includedInParent" = c."includedInParent"
  from carry.item_state c
 where i.id = c.id;

update public.services s
   set kind = c.kind
  from carry.service_state c
 where s.id = c.id;

update public.purchase_orders p
   set "raisedById" = c."raisedById"
  from carry.po_state c
 where p.id = c.id
   and exists (select 1 from public.users u where u.id = c."raisedById");

-- Dropped from v2 on 2026-08-24 and not to be reintroduced by a refresh.
drop table if exists public.chat_messages;
drop table if exists public.chat_sessions;
delete from public.settings where key in ('llm_knowledge_snapshot', 'llm_knowledge_updated_at');

drop schema carry cascade;
SQL

rule
say "v2 now: $(counts "$V2_DB")"
for t in "${CARRIED_TABLES[@]}"; do
  printf '  %-26s %s rows\n' "$t" "$(psql2 "select count(*) from $t")"
done
say "  models grouped:   $(psql2 'select count(*) from assets where "familyId" is not null')"
say "  ungrouped models: $(psql2 'select count(*) from assets where "familyId" is null')"
say "  owned accounts:   $(psql2 'select count(*) from clients where "ownerId" is not null')"
say "  prospect shells:  $(psql2 'select count(*) from clients where "prospectAt" is not null')"
rule
say "next:"
say "  npx tsx scripts/group-assets.ts           # what the new models would group into"
say "  npx tsx scripts/group-assets.ts --apply   # group them"
say "  npx tsx scripts/smoke-routes.ts           # walk every screen against the new data"
say "  rollback: gunzip -c $BACKUP | docker exec -i $CONTAINER psql -U postgres -d $V2_DB"
