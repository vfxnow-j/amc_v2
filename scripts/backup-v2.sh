#!/usr/bin/env bash
#
# Scheduled backup of VFXnow v2: the main database (vfxnow_amc_v2) and every
# entity database (vfxnow_ent_<slug>) the registry knows about, active or not.
#
#   scripts/backup-v2.sh               # take a backup set now
#   scripts/backup-v2.sh --dry-run     # say what it would do; write nothing
#   scripts/backup-v2.sh --rotate-only # apply the retention policy and stop
#
# Environment (all optional):
#   BACKUP_ROOT          where sets live (default $HOME/backups/v2, outside the repo
#                        so a re-clone or `git clean -fdx` cannot wipe them)
#   BACKUP_ACCEPT_SHRINK=1  accept a deliberate purge: skip the comparison with the
#                        previous set (anchor tables are still required)
# Test-only (ignored unless BACKUP_TEST=1): BACKUP_DB_CONTAINER, BACKUP_REGISTRY_FILE
# (lines "dbName|slug|active"), BACKUP_FAULT=sha|jq|mv|entry|rotate to prove a
# failing step blocks promotion.
#
# The live v1 database shares this Postgres container and is NEVER touched: the
# only databases ever dumped are vfxnow_amc_v2 and names matching
# ^vfxnow_ent_[a-z0-9_]{1,40}$.
#
# A set is built in a hidden .tmp-<stamp> directory and renamed to <stamp> (UTC)
# only when every dump has verified, so a directory named like a stamp is always
# a complete set. Nothing is deleted unless the new set verified. Retention is
# decided by src/lib/backups/rotation.ts through scripts/backup-rotate.ts; this
# script only removes the directories it names, after re-checking each name.
#
# Exit codes: 0 ok, 1 failed (no set written), 2 a set was written but something
# is wrong with it or around it (a skipped or undumpable database, a failed
# rotation, a set flagged "suspect" because data shrank; STATUS.json says which),
# 64 bad usage, 75 another run holds the lock.

set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups/v2}"
TEST_MODE=0
[[ "${BACKUP_TEST:-}" == "1" ]] && TEST_MODE=1
CONTAINER="vfxnow-amc-db-1"
((TEST_MODE)) && CONTAINER="${BACKUP_DB_CONTAINER:-$CONTAINER}"
fault() { ((TEST_MODE)) && [[ "${BACKUP_FAULT:-}" == "$1" ]]; }

# cron's PATH has no node; find the newest nvm install when none is on PATH.
if ! command -v node >/dev/null 2>&1; then
  newest_node="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  [[ -n "$newest_node" ]] && PATH="$newest_node:$PATH"
fi
MAIN_DB="vfxnow_amc_v2"
ENT_RE='^vfxnow_ent_[a-z0-9_]{1,40}$'
STAMP_RE='^[0-9]{8}-[0-9]{6}$'
MIN_BYTES=1024
TSX="$REPO/node_modules/.bin/tsx"

DRY=0
ROTATE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --rotate-only) ROTATE_ONLY=1 ;;
    *) echo "usage: backup-v2.sh [--dry-run] [--rotate-only]" >&2; exit 64 ;;
  esac
done

LOCKED=0
PROMOTED=0
STATUS_WRITTEN=0
OUTCOME=failed
TMPSET=""
FINAL=""
ERRORS=()
DB_RESULTS=()
MANIFEST_DBS=()
UNREGISTERED=()
RAN_AT_START="$(date -u +%FT%TZ)"
ERR_LINE=""
trap 'ERR_LINE="${LINENO}"' ERR

log() { echo "[$(date -u +%FT%TZ)] $*"; }
add_error() { ERRORS+=("$1"); log "ERROR: $1" >&2; }
fail() { add_error "$1"; exit 1; }

# JSON array of strings from the arguments ([] when there are none).
arr_json() {
  if (($#)); then printf '%s\n' "$@" | jq -R . | jq -sc .; else echo '[]'; fi
}
# JSON array from lines of JSON objects given as arguments.
objs_json() {
  if (($#)); then printf '%s\n' "$@" | jq -sc .; else echo '[]'; fi
}

psql_main() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$MAIN_DB" -X -v ON_ERROR_STOP=1 -tA -c "$1"
}

# Stamp directories (with a MANIFEST) under BACKUP_ROOT, oldest first.
list_sets() {
  local d e now_e
  now_e="$(date +%s)"
  [[ -d "$BACKUP_ROOT" ]] || return 0
  for d in "$BACKUP_ROOT"/*/; do
    d="$(basename "$d")"
    [[ "$d" =~ $STAMP_RE && -f "$BACKUP_ROOT/$d/MANIFEST.json" && ! -L "$BACKUP_ROOT/$d" ]] || continue
    # A stamp more than an hour in the future is not trusted (same rule as rotation and verify).
    e="$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${d:9:2}:${d:11:2}:${d:13:2}" +%s 2>/dev/null)" || continue
    ((e <= now_e + 3600)) && echo "$d"
  done | sort
}

write_status() { # $1 = true|false ; outcome from $OUTCOME
  local ok="$1" sets oldest kept
  mapfile -t sets < <(list_sets)
  kept="${#sets[@]}"
  oldest="${sets[0]:-}"
  jq -n \
    --arg at "$(date -u +%FT%TZ)" --argjson ok "$ok" \
    --arg setDir "$([[ $PROMOTED == 1 ]] && echo "$FINAL" || true)" \
    --argjson databases "$(objs_json "${DB_RESULTS[@]+"${DB_RESULTS[@]}"}")" \
    --argjson errors "$(arr_json "${ERRORS[@]+"${ERRORS[@]}"}")" \
    --argjson unregistered "$(arr_json "${UNREGISTERED[@]+"${UNREGISTERED[@]}"}")" \
    --arg oldest "$oldest" --argjson kept "$kept" --arg outcome "$OUTCOME" \
    '{lastRunAt:$at, ok:$ok, outcome:$outcome, setDir:(if $setDir=="" then null else $setDir end),
      databases:$databases, errors:$errors, unregistered:$unregistered,
      oldestKeptSet:(if $oldest=="" then null else $oldest end), keptSets:$kept}' \
    > "$BACKUP_ROOT/.STATUS.json.tmp.$$"
  mv -f "$BACKUP_ROOT/.STATUS.json.tmp.$$" "$BACKUP_ROOT/STATUS.json"
  STATUS_WRITTEN=1
}

remove_tmpset() {
  # Only ever a hidden .tmp-<stamp> directory directly under BACKUP_ROOT.
  local base
  [[ -n "$TMPSET" && -d "$TMPSET" ]] || return 0
  base="$(basename "$TMPSET")"
  if [[ "$(dirname "$TMPSET")" == "$BACKUP_ROOT" && "$base" =~ ^\.tmp-[0-9]{8}-[0-9]{6}$ && ! -L "$TMPSET" ]]; then
    rm -rf -- "$TMPSET"
  fi
}

on_exit() {
  local code=$?
  trap - EXIT
  if ((LOCKED && !DRY && !ROTATE_ONLY)); then
    if ((code != 0 && PROMOTED == 0)); then remove_tmpset; fi
    if ((code != 0 && STATUS_WRITTEN == 0)); then
      if ((${#ERRORS[@]} == 0)); then ERRORS+=("unexpected failure${ERR_LINE:+ near line $ERR_LINE}, exit $code"); fi
      write_status false || true
    fi
  fi
  exit "$code"
}
trap on_exit EXIT

# ---- retention ---------------------------------------------------------------
rotate() { # applies (or, with DRY, only prints) the retention decision
  local verb name rest kept=0 removed=0 plan
  [[ -d "$BACKUP_ROOT" ]] || { log "rotation: $BACKUP_ROOT does not exist; nothing to do"; return 0; }
  if fault rotate; then log "rotation: injected fault" >&2; return 1; fi
  [[ -x "$TSX" ]] || { log "rotation: $TSX not found" >&2; return 1; }
  plan="$("$TSX" "$REPO/scripts/backup-rotate.ts" "$BACKUP_ROOT")" || { log "rotation: planning failed" >&2; return 1; }
  while read -r verb name rest; do
    case "$verb" in
      keep) kept=$((kept + 1)); log "rotation: keep $name ($rest)" ;;
      ignore) log "rotation: ignore $name" ;;
      delete)
        # Re-check the name here; never trust the planner with an rm -rf.
        if [[ ! "$name" =~ $STAMP_RE || ! -d "$BACKUP_ROOT/$name" || -L "$BACKUP_ROOT/$name" ]]; then
          log "rotation: refusing to delete unexpected entry '$name'" >&2
          continue
        fi
        if ((DRY)); then
          log "rotation: would delete $name"
        else
          rm -rf -- "${BACKUP_ROOT:?}/$name" || { log "rotation: could not delete $name" >&2; return 1; }
          log "rotation: deleted $name"
        fi
        removed=$((removed + 1))
        ;;
    esac
  done <<<"$plan"
  log "rotation: $kept kept, $removed $([[ $DRY == 1 ]] && echo 'would be ' || true)deleted"
}

# ---- target discovery --------------------------------------------------------
# Fills TARGETS with "db|kind|slug|active" lines. Invalid registry names are
# skipped and recorded in SKIPPED.
TARGETS=()
SKIPPED=()
discover() {
  local reg dbn slug active listed known r
  if ((TEST_MODE)) && [[ -n "${BACKUP_REGISTRY_FILE:-}" ]]; then
    reg="$(cat "$BACKUP_REGISTRY_FILE")"
  else
    reg="$(psql_main 'select "dbName", slug, active from entities order by "createdAt"' 2>&1)" ||
      fail "could not read the entity registry from container '$CONTAINER': $(echo "$reg" | head -n 2 | head -c 300)"
  fi
  TARGETS+=("$MAIN_DB|main||t")
  known=" "
  while IFS='|' read -r dbn slug active; do
    [[ -z "${dbn:-}" ]] && continue
    if [[ ! "$dbn" =~ $ENT_RE ]]; then
      SKIPPED+=("registry row with an invalid database name was skipped (slug '${slug:-?}')")
      continue
    fi
    known+="$dbn "
    TARGETS+=("$dbn|entity|${slug:-}|${active:-}")
  done <<<"$reg"

  listed="$(psql_main "select datname from pg_database where datname like 'vfxnow\\_ent\\_%' order by 1" 2>&1)" ||
    fail "could not list databases from container '$CONTAINER': $(echo "$listed" | head -n 2 | head -c 300)"
  while read -r r; do
    [[ -z "$r" ]] && continue
    # Throwaway databases from checks/verification are not data.
    [[ "$r" == vfxnow_ent_zz_* ]] && { log "ignoring throwaway database $r"; continue; }
    [[ "$known" == *" $r "* ]] && continue
    if [[ "$r" =~ $ENT_RE ]]; then
      UNREGISTERED+=("$r")
      TARGETS+=("$r|unregistered||")
    else
      SKIPPED+=("database '$r' is not a valid entity name and was skipped")
    fi
  done <<<"$listed"
}

# ---- dump + verify one database ----------------------------------------------
# These run under `if !`, where `set -e` is off, so EVERY step checks itself.
# On success appends to DB_RESULTS and MANIFEST_DBS; returns 1 on failure.
dump_one() { # db kind slug
  local db="$1" kind="$2" slug="$3"
  local part="$TMPSET/$db.sql.gz.partial" final="$TMPSET/$db.sql.gz" err="$TMPSET/$db.err"
  local bytes sum scan footer creates tables_json copy_rows entry before
  bad() { add_error "$db: $1"; DB_RESULTS+=("$(jq -nc --arg n "$db" --argjson b "${bytes:-0}" '{name:$n, ok:false, bytes:$b}')") || true; return 1; }
  bytes=0
  log "dumping $db ($kind)"
  # `timeout 1200` inside the container ends pg_dump itself; the host timeout is a backstop for a hung docker client.
  if ! timeout 25m docker exec "$CONTAINER" timeout 1200 pg_dump -U postgres --no-password --lock-wait-timeout=300s "$db" 2>"$err" | gzip -c >"$part"; then
    bad "pg_dump failed or timed out: $(head -n 2 "$err" | head -c 300)"; return 1
  fi
  gzip -t "$part" 2>/dev/null || { bad "dump failed gzip integrity test"; return 1; }
  bytes="$(stat -c %s "$part")" || { bad "could not stat dump"; return 1; }
  ((bytes >= MIN_BYTES)) || { bad "dump is only $bytes bytes (minimum $MIN_BYTES)"; return 1; }
  # One pass over the SQL: tables created, rows per COPY block, completion footer.
  scan="$(gzip -dc "$part" | awk '
    incopy && /^\\\.$/ { incopy=0; next }
    incopy { rows[cur]++; next }
    /^CREATE TABLE / { n=$3; gsub(/"/,"",n); sub(/^public\./,"",n); tables[n]=0; creates++ ; next }
    /^COPY / { c=$2; gsub(/"/,"",c); sub(/^public\./,"",c); cur=c; incopy=1; next }
    /^-- PostgreSQL database dump complete/ { footer=1; next }
    footer && ($0=="" || /^--/ || /^\\unrestrict/) { next }
    footer { footer=0 }
    END {
      print "CREATES\t" creates+0; print "FOOTER\t" footer+0;
      for (t in tables) print "TABLE\t" t "\t" rows[t]+0
    }')" || { bad "could not read dump"; return 1; }
  creates="$(awk -F'\t' '$1=="CREATES"{print $2}' <<<"$scan")"
  footer="$(awk -F'\t' '$1=="FOOTER"{print $2}' <<<"$scan")"
  [[ "$creates" =~ ^[0-9]+$ ]] && ((creates >= 1)) || { bad "dump contains no CREATE TABLE"; return 1; }
  [[ "$footer" == "1" ]] || { bad "dump does not end with the pg_dump completion footer (truncated?)"; return 1; }
  if fault jq; then tables_json=""; false; else
    tables_json="$(jq -Rs '[split("\n")[]|select(startswith("TABLE\t"))|split("\t")|{(.[1]):(.[2]|tonumber)}]|add // {}' <<<"$scan")"
  fi || { bad "could not summarise tables"; return 1; }
  copy_rows="$(jq '[.[]]|add // 0' <<<"$tables_json")" || { bad "could not total rows"; return 1; }
  if fault sha; then sum="not-a-checksum"; else sum="$(sha256sum "$part" | cut -d' ' -f1)" || sum=""; fi
  [[ "$sum" =~ ^[0-9a-f]{64}$ ]] || { bad "could not compute a sha256"; return 1; }
  if fault mv; then false; else mv -f "$part" "$final"; fi || { bad "could not move the dump into place"; return 1; }
  rm -f "$err"
  echo "$sum  $db.sql.gz" >>"$TMPSET/SHA256SUMS" || { bad "could not record the checksum"; return 1; }
  entry="$(jq -nc --arg n "$db" --arg k "$kind" --arg s "$slug" --argjson b "$bytes" --arg h "$sum" \
    --argjson rows "$tables_json" --argjson copy "$copy_rows" \
    '{name:$n, kind:$k, slug:(if $s=="" then null else $s end), file:($n+".sql.gz"), bytes:$b, sha256:$h,
      tables:($rows|keys), rowsByTable:$rows, copyRows:$copy}')" || { bad "could not build the manifest entry"; return 1; }
  before="${#MANIFEST_DBS[@]}"
  if ! fault entry; then MANIFEST_DBS+=("$entry"); fi
  ((${#MANIFEST_DBS[@]} == before + 1)) || { bad "manifest entry was not recorded"; return 1; }
  DB_RESULTS+=("$(jq -nc --arg n "$db" --argjson b "$bytes" '{name:$n, ok:true, bytes:$b}')") || { bad "could not record result"; return 1; }
  log "  $db ok: $bytes bytes, $(jq 'length' <<<"$tables_json") tables, $copy_rows rows"
}

# Path of the newest set not flagged suspect, or nothing.
previous_good_manifest() {
  local s m
  while read -r s; do
    m="$BACKUP_ROOT/$s/MANIFEST.json"
    if jq -e '.suspect != true' "$m" >/dev/null 2>&1; then echo "$m"; return 0; fi
  done < <(list_sets | sort -r)
  return 0
}

# ---- main --------------------------------------------------------------------
main() {
  local t db kind slug active stamp s manifest expected=0 prev problems partial=0 suspect=0

  if ((DRY)); then
    log "dry run: nothing will be written"
    if ((ROTATE_ONLY)); then rotate; return 0; fi
    discover
    for t in "${TARGETS[@]}"; do IFS='|' read -r db kind slug active <<<"$t"; log "would dump $db ($kind${slug:+, slug $slug}${active:+, active=$active})"; done
    for s in "${SKIPPED[@]+"${SKIPPED[@]}"}"; do log "would skip: $s"; done
    log "would write ${BACKUP_ROOT}/<stamp>/ and STATUS.json"
    rotate
    return 0
  fi

  if [[ ! -d "$BACKUP_ROOT" ]]; then
    mkdir -p -m 700 "$BACKUP_ROOT"
    chmod 700 "$BACKUP_ROOT"   # only a directory this run created; an existing one is never touched
  fi
  exec 9>"$BACKUP_ROOT/.lock"
  if ! flock -n 9; then
    log "skipped: previous run still running (lock held on $BACKUP_ROOT)"
    exit 75
  fi
  LOCKED=1

  if ((ROTATE_ONLY)); then
    rotate
    return 0
  fi

  # Leftovers of a run that was killed outright (we hold the lock, so none is live).
  for s in "$BACKUP_ROOT"/.tmp-*; do
    [[ -d "$s" && ! -L "$s" && "$(basename "$s")" =~ ^\.tmp-[0-9]{8}-[0-9]{6}$ ]] && rm -rf -- "$s"
  done

  stamp="$(date -u +%Y%m%d-%H%M%S)"
  FINAL="$stamp"
  [[ ! -e "$BACKUP_ROOT/$stamp" ]] || fail "set $stamp already exists"
  TMPSET="$BACKUP_ROOT/.tmp-$stamp"
  mkdir -m 700 "$TMPSET"

  discover
  for s in "${SKIPPED[@]+"${SKIPPED[@]}"}"; do add_error "$s"; partial=1; done

  local failed=0
  for t in "${TARGETS[@]}"; do
    IFS='|' read -r db kind slug active <<<"$t"
    if dump_one "$db" "$kind" "$slug"; then
      expected=$((expected + 1))
    elif [[ "$kind" == "unregistered" ]]; then
      partial=1   # recorded as an error by dump_one; the registered databases still get their set
    else
      failed=1
    fi
  done
  ((failed == 0)) || { log "at least one required dump failed; no set written" >&2; exit 1; }
  ((${#MANIFEST_DBS[@]} == expected)) || fail "manifest bookkeeping does not match the dumps; no set written"

  manifest="$TMPSET/MANIFEST.json"
  jq -n --arg at "$(date -u +%FT%TZ)" --arg host "$(hostname)" --arg set "$stamp" \
    --arg pg "$(docker exec "$CONTAINER" pg_dump --version 2>/dev/null || echo unknown)" \
    --arg server "$(psql_main 'show server_version' 2>/dev/null || echo unknown)" \
    --arg gz "$(gzip --version 2>&1 | head -n 1)" --arg jqv "$(jq --version)" --arg bashv "${BASH_VERSION}" \
    --argjson dbs "$(objs_json "${MANIFEST_DBS[@]}")" --argjson unreg "$(arr_json "${UNREGISTERED[@]+"${UNREGISTERED[@]}"}")" \
    '{timestamp:$at, set:$set, host:$host, tools:{pg_dump:$pg, postgres:$server, gzip:$gz, jq:$jqv, bash:$bashv},
      databases:$dbs, unregistered:$unreg}' >"$manifest" || fail "could not write the manifest"

  # Is this set plausible next to the last good one? (A wiped database dumps cleanly.)
  prev="$(previous_good_manifest)"
  local cmp_args=("$manifest" "${prev:--}")
  [[ "${BACKUP_ACCEPT_SHRINK:-}" == "1" ]] && cmp_args+=(--accept-shrink)
  # stdout only is the verdict; stderr (a Node warning, say) goes to the log, never into the set's flags.
  if ! problems="$("$TSX" "$REPO/scripts/backup-compare.ts" "${cmp_args[@]}" 2>"$TMPSET/compare.err")"; then
    add_error "could not compare with the previous set: $(head -n 2 "$TMPSET/compare.err" | head -c 300)"
    partial=1
  elif [[ -n "$problems" ]]; then
    while read -r s; do [[ -n "$s" ]] && add_error "suspect: $s"; done <<<"$problems"
    suspect=1
    jq --argjson r "$(arr_json "$(head -c 2000 <<<"$problems")")" '. + {suspect:true, suspectReasons:$r}' "$manifest" >"$manifest.new" &&
      mv -f "$manifest.new" "$manifest" || fail "could not flag the set as suspect"
  fi
  [[ -s "$TMPSET/compare.err" ]] && log "compare stderr: $(head -c 300 "$TMPSET/compare.err")"
  rm -f "$TMPSET/compare.err"
  [[ "${BACKUP_ACCEPT_SHRINK:-}" == "1" ]] && log "BACKUP_ACCEPT_SHRINK=1: comparison with the previous set skipped"

  mv "$TMPSET" "$BACKUP_ROOT/$FINAL"
  PROMOTED=1
  TMPSET=""
  log "set $FINAL written"

  if ((suspect)); then
    log "SUSPECT set kept, rotation not run: data shrank since the previous good set" >&2
    OUTCOME=suspect; write_status false; return 2
  fi
  if ((partial)); then
    log "set written, but something was skipped or failed; rotation not run" >&2
    OUTCOME=partial; write_status false; return 2
  fi
  if ! rotate; then
    add_error "rotation failed; old sets were left alone"
    OUTCOME=partial; write_status false; return 2
  fi
  OUTCOME=ok
  write_status true
  log "backup ok"
}

main
