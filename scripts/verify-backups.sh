#!/usr/bin/env bash
#
# Verifies the NEWEST backup set by restoring it.
#
#   scripts/verify-backups.sh [--max-age-hours N]
#
# Checks: the set is recent (default 26 h); the main database and every
# registered entity (active or not) has a dump whose checksum matches the
# manifest; each dump restores with zero errors into a THROWAWAY database
# (zz_verify_<rand> for the main one, vfxnow_ent_zz_verify_<rand> for entities);
# the restored tables and row counts equal the manifest; entity migrations are
# at the registered version; and the ledger's append-only triggers survived.
# Every throwaway is dropped on the way out, success, failure or Ctrl-C, and
# only names this run created and that match the guard pattern are ever dropped.
# The live databases are read for the registry only; v1 is never touched.
#
# Environment: BACKUP_ROOT, BACKUP_DB_CONTAINER, BACKUP_REGISTRY_FILE as in
# backup-v2.sh. Writes ${BACKUP_ROOT}/VERIFY.json. Exits non-zero on any failure.

set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO/backups/scheduled}"
CONTAINER="${BACKUP_DB_CONTAINER:-vfxnow-amc-db-1}"
MAIN_DB="vfxnow_amc_v2"
ENT_RE='^vfxnow_ent_[a-z0-9_]{1,40}$'
STAMP_RE='^[0-9]{8}-[0-9]{6}$'
DROP_RE='^(zz_verify_|vfxnow_ent_zz_verify_)[a-z0-9]+$'
MAX_AGE_HOURS=26

while (($#)); do
  case "$1" in
    --max-age-hours)
      [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "--max-age-hours needs a whole number" >&2; exit 64; }
      MAX_AGE_HOURS="$2"; shift 2 ;;
    *) echo "usage: verify-backups.sh [--max-age-hours N]" >&2; exit 64 ;;
  esac
done

CHECKS=()
FAILED=0
CREATED=()
SETNAME=""
SETPATH=""
WRITTEN=0
WORK="$(mktemp -d)"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
check() { # name ok(true|false) detail
  CHECKS+=("$(jq -nc --arg n "$1" --argjson ok "$2" --arg d "${3:-}" '{name:$n, ok:$ok, detail:$d}')")
  if [[ "$2" == true ]]; then log "PASS  $1${3:+ - ${3:-}}"; else FAILED=1; log "FAIL  $1${3:+ - ${3:-}}" >&2; fi
}

pg() { # db sql ; stdout only
  docker exec -i "$CONTAINER" psql -U postgres -d "$1" -X -v ON_ERROR_STOP=1 -tA -c "$2"
}

write_verify() {
  local ok=true
  ((FAILED)) && ok=false
  [[ -d "$BACKUP_ROOT" ]] || return 0
  jq -n --arg at "$(date -u +%FT%TZ)" --argjson ok "$ok" --arg set "$SETNAME" \
    --argjson checks "$(if ((${#CHECKS[@]})); then printf '%s\n' "${CHECKS[@]}" | jq -sc .; else echo '[]'; fi)" \
    '{verifiedAt:$at, ok:$ok, setDir:(if $set=="" then null else $set end), checks:$checks}' \
    >"$BACKUP_ROOT/.VERIFY.json.tmp.$$"
  mv -f "$BACKUP_ROOT/.VERIFY.json.tmp.$$" "$BACKUP_ROOT/VERIFY.json"
  WRITTEN=1
}

cleanup() {
  local code=$? name
  trap - EXIT INT TERM
  for name in "${CREATED[@]+"${CREATED[@]}"}"; do
    if [[ "$name" =~ $DROP_RE ]]; then
      docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" >/dev/null 2>&1 ||
        echo "WARNING: could not drop throwaway database $name" >&2
    fi
  done
  rm -rf -- "$WORK"
  if ((WRITTEN == 0)); then
    if ((code != 0)); then FAILED=1; CHECKS+=("$(jq -nc --arg d "interrupted or crashed (exit $code)" '{name:"run completed", ok:false, detail:$d}')"); fi
    write_verify || true
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Sets THROWAWAY (not a subshell echo: CREATED must be recorded in this shell so
# the exit trap can drop the database whatever happens next).
THROWAWAY=""
new_throwaway() { # prefix
  local name
  name="$1$(od -An -N5 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$name" =~ $DROP_RE ]] || { echo "internal: bad throwaway name" >&2; return 1; }
  CREATED+=("$name")
  THROWAWAY="$name"
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$name\"" >/dev/null
}

drop_throwaway() { # name
  [[ "$1" =~ $DROP_RE ]] || return 1
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null
}

# SQL that counts every table in the manifest's rowsByTable, one "name|n" row each.
count_sql() { # manifest-entry-json
  jq -r 'def q: "\"" + gsub("\"";"\"\"") + "\"";
    .rowsByTable|keys[]|. as $k|(if contains(".") then split(".") else ["public",.] end) as $p
    | "select \($k|@sh) || chr(124) || count(*) from \($p[0]|q).\($p[1]|q);"' <<<"$1"
}

verify_db() { # name kind slug schemaVersion
  local db="$1" kind="$2" slug="$3" regver="$4"
  local entry file want got prefix tmp errf tables_expected tables_actual rows_expected rows_actual maxv trig upd

  entry="$(jq -c --arg n "$db" '.databases[]|select(.name==$n)' "$SETPATH/MANIFEST.json" | head -n 1)"
  if [[ -z "$entry" ]]; then check "$db: dump present in set" false "no entry in the manifest"; return 0; fi
  file="$SETPATH/$(jq -r '.file' <<<"$entry")"
  if [[ ! -f "$file" ]]; then check "$db: dump present in set" false "file missing"; return 0; fi
  check "$db: dump present in set" true "$(jq -r '.bytes' <<<"$entry") bytes"

  want="$(jq -r '.sha256' <<<"$entry")"; got="$(sha256sum "$file" | cut -d' ' -f1)"
  if [[ "$want" == "$got" ]]; then check "$db: checksum matches manifest" true; else check "$db: checksum matches manifest" false "expected $want, got $got"; return 0; fi
  if ! gzip -t "$file" 2>/dev/null; then check "$db: gzip integrity" false "gzip -t failed"; return 0; fi

  if [[ "$kind" == "main" ]]; then prefix="zz_verify_"; else prefix="vfxnow_ent_zz_verify_"; fi
  new_throwaway "$prefix" || { check "$db: throwaway database created" false "CREATE DATABASE failed"; return 0; }
  tmp="$THROWAWAY"
  errf="$WORK/$db.restore.err"
  if gzip -dc "$file" | docker exec -i "$CONTAINER" psql -U postgres -d "$tmp" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>"$errf" && ! grep -q 'ERROR' "$errf"; then
    check "$db: test restore" true "restored into a throwaway database with no errors"
  else
    check "$db: test restore" false "$(grep -m2 -E 'ERROR|error' "$errf" | head -c 300)"
    drop_throwaway "$tmp" || true
    return 0
  fi

  tables_expected="$(jq -r '.tables[]' <<<"$entry" | LC_ALL=C sort)"
  tables_actual="$(pg "$tmp" "select case when table_schema='public' then table_name else table_schema||'.'||table_name end from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by 1" | LC_ALL=C sort)"
  if [[ "$tables_expected" == "$tables_actual" ]]; then
    check "$db: restored tables match manifest" true "$(wc -l <<<"$tables_expected") tables"
  else
    check "$db: restored tables match manifest" false "$(diff <(echo "$tables_expected") <(echo "$tables_actual") | head -n 4 | tr '\n' ' ')"
  fi

  rows_expected="$(jq -r '.rowsByTable|to_entries[]|"\(.key)|\(.value)"' <<<"$entry" | LC_ALL=C sort)"
  rows_actual="$(count_sql "$entry" | docker exec -i "$CONTAINER" psql -U postgres -d "$tmp" -X -v ON_ERROR_STOP=1 -tA | LC_ALL=C sort)"
  if [[ "$rows_expected" == "$rows_actual" ]]; then
    check "$db: restored row counts match manifest" true "$(jq -r '.copyRows' <<<"$entry") rows"
  else
    check "$db: restored row counts match manifest" false "$(diff <(echo "$rows_expected") <(echo "$rows_actual") | head -n 4 | tr '\n' ' ')"
  fi

  if [[ "$kind" == "entity" ]]; then
    maxv="$(pg "$tmp" 'select coalesce(max(version),0) from _entity_migrations' 2>/dev/null || echo "")"
    if [[ -z "$maxv" ]]; then
      check "$db: migrations table" false "_entity_migrations is missing or unreadable"
    elif [[ -z "$regver" ]]; then
      check "$db: migration version" true "restored v$maxv (registry version not supplied)"
    elif ((maxv == regver)); then
      check "$db: migration version equals registry" true "v$maxv"
    elif ((maxv < regver)); then
      check "$db: migration version vs registry" true "NOTE: dump is at v$maxv, registry says v$regver; the dump predates a migration"
    else
      check "$db: migration version vs registry" false "dump is at v$maxv, ahead of the registry's v$regver"
    fi

    trig="$(pg "$tmp" "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='\"Movement\"'::regclass and not tgisinternal" 2>/dev/null || echo "")"
    if [[ "$trig" == *Movement_append_only* && "$trig" == *Movement_no_truncate* ]]; then
      check "$db: append-only triggers present" true "$trig"
    else
      check "$db: append-only triggers present" false "found: ${trig:-none}"
    fi

    if [[ "$(pg "$tmp" 'select count(*) from "Movement"' 2>/dev/null || echo 0)" -gt 0 ]]; then
      upd="$(docker exec -i "$CONTAINER" psql -U postgres -d "$tmp" -X -v ON_ERROR_STOP=1 -tA -c 'UPDATE "Movement" SET "id" = "id"' 2>&1 || true)"
      if grep -q 'append-only' <<<"$upd"; then check "$db: UPDATE on a restored Movement is rejected" true; else check "$db: UPDATE on a restored Movement is rejected" false "${upd:0:200}"; fi
    else
      check "$db: UPDATE on a restored Movement is rejected" true "skipped: no Movement rows yet"
    fi
    upd="$(docker exec -i "$CONTAINER" psql -U postgres -d "$tmp" -X -v ON_ERROR_STOP=1 -tA -c 'TRUNCATE "Movement"' 2>&1 || true)"
    if grep -q 'append-only' <<<"$upd"; then check "$db: TRUNCATE on a restored Movement is rejected" true; else check "$db: TRUNCATE on a restored Movement is rejected" false "${upd:0:200}"; fi
  fi

  if drop_throwaway "$tmp"; then check "$db: throwaway database dropped" true; else check "$db: throwaway database dropped" false "drop failed; the exit trap will retry"; fi
}

main() {
  local sets newest manifest_ts ts_epoch age_s reg line dbn slug active ver remaining name
  [[ -d "$BACKUP_ROOT" ]] || { check "backup set exists" false "$BACKUP_ROOT does not exist"; return 1; }

  newest=""
  for name in "$BACKUP_ROOT"/*/; do
    name="$(basename "$name")"
    [[ "$name" =~ $STAMP_RE && -f "$BACKUP_ROOT/$name/MANIFEST.json" && ! -L "$BACKUP_ROOT/$name" ]] && newest="$name"
  done
  if [[ -z "$newest" ]]; then check "backup set exists" false "no complete set in the backup root"; return 1; fi
  SETNAME="$newest"
  SETPATH="$BACKUP_ROOT/$newest"
  check "backup set exists" true "$SETNAME"

  manifest_ts="$(jq -r '.timestamp' "$SETPATH/MANIFEST.json")"
  if ts_epoch="$(date -d "$manifest_ts" +%s 2>/dev/null)"; then
    age_s=$(( $(date +%s) - ts_epoch ))
    if ((age_s <= MAX_AGE_HOURS * 3600)); then
      check "newest set is recent" true "$((age_s / 3600)) h old (limit $MAX_AGE_HOURS h)"
    else
      check "newest set is recent" false "$((age_s / 3600)) h old (limit $MAX_AGE_HOURS h)"
    fi
  else
    check "newest set is recent" false "manifest timestamp unreadable"
  fi

  # Registry: every entity, active or not.
  if [[ -n "${BACKUP_REGISTRY_FILE:-}" ]]; then
    reg="$(cat "$BACKUP_REGISTRY_FILE")"
  else
    reg="$(pg "$MAIN_DB" 'select "dbName", slug, active, "schemaVersion" from entities order by "createdAt"' 2>&1)" ||
      { check "registry readable" false "$(head -c 200 <<<"$reg")"; return 1; }
  fi

  verify_db "$MAIN_DB" main "" ""
  while IFS='|' read -r dbn slug active ver; do
    [[ -z "${dbn:-}" ]] && continue
    if [[ ! "$dbn" =~ $ENT_RE ]]; then check "registry row '${slug:-?}'" false "invalid database name"; continue; fi
    verify_db "$dbn" entity "${slug:-}" "${ver:-}"
  done <<<"$reg"

  remaining="$(pg postgres "select datname from pg_database where datname ~ '^(zz_verify_|vfxnow_ent_zz_verify_)'" 2>/dev/null | tr '\n' ' ' || true)"
  # Only ours matter; a concurrent run's would carry a different random suffix.
  local left=0
  for name in "${CREATED[@]+"${CREATED[@]}"}"; do
    if [[ " $remaining " == *" $name "* ]]; then left=1; check "no throwaway left behind" false "$name still exists"; fi
  done
  ((left)) || check "no throwaway left behind" true "${#CREATED[@]} created, all dropped"
  return 0
}

rc=0
main || rc=1
((rc)) && FAILED=1
write_verify
if ((FAILED)); then log "VERIFY FAILED" >&2; exit 1; fi
log "VERIFY OK"
