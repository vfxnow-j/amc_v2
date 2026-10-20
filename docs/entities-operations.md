# Entities: operating notes

An entity is an owner whose gear VFXnow stores. Each has its own Postgres database named
`vfxnow_ent_<slug>` on the same server, plus a row in the main database's `Entity` table.

## Migrating entity databases

Entity schema changes ship as numbered SQL files in `prisma/entity/migrations/` (one global list, applied
to every entity database in order). To apply new ones to every registered entity:

    npm run entities:migrate

It is safe to re-run; each file is applied once per database and the entity's `schemaVersion` is updated.

**Never** run `prisma db push --schema prisma/entity/schema.prisma` (or `migrate`) against an entity database.
It would bypass the numbered files, and the append-only triggers on the ledger are only created by them.
`prisma generate` for the entity client is fine and is part of `npm run db:generate`.

## An orphaned database after a crash

Creating an entity runs `CREATE DATABASE`, then the migrations, then writes the registry row; if the server
dies between those steps there can be a `vfxnow_ent_*` database with no registry row (or an empty one).
The app removes its own half-made database when a step fails, but not after a hard crash.

1. List databases named `vfxnow_ent_%` and the registered ones (`SELECT "dbName" FROM "Entity"`).
2. For any database not in the registry, check it holds nothing: the `Item`, `Unit`, `Stock`, `Movement` tables
   should have zero rows. If it holds rows, stop: it is real data; register it or ask before touching it.
3. Confirm the database name starts with `vfxnow_ent_` and that no `Entity` row references it before dropping. Only if it is also empty: `DROP DATABASE "vfxnow_ent_<slug>";` from a connection to a different
   database (such as `postgres`). Double-check the name; never drop `vfxnow_amc_v2` or v1's database.
4. Creating the entity again from Settings → Entities then works.

Entities are deactivated, never deleted; do not drop a registered entity's database.

## Removing a location does not move entity records

Entity records point at VFXnow locations by id, with no foreign key (they live in another database). If a
location is removed or merged in the main app, gear recorded there stays recorded there: screens show it as
"Removed location", the Locations page says so, and it can still be moved out or returned (only the
destination of a movement must exist). Move it to a real location before or after removing the old one;
merging locations in the main app does not update entity databases.

## Checks

- `npm run check:entities` fails if main-app code can reach the entity client (runs in `npm run build`).
- `npx tsx --env-file=.env scripts/entities-actions-check.ts` and `entities-provision-check.ts` use throwaway
  databases (`vfxnow_ent_zz_*`) and drop them when they finish.

## Backups

Entity ledger rows are permanent (the `Movement` table is append-only), so a backup is the only way back from
a bad deploy, a mistaken bulk change or a corrupted database.

**What is backed up.** `vfxnow_amc_v2` and every database in the `entities` registry, active or deactivated.
Any `vfxnow_ent_*` database that is not in the registry is also dumped and flagged "unregistered" in the
manifest and in the status card. Throwaway `vfxnow_ent_zz_*` databases are ignored. The live v1 database
shares the same Postgres container and is never dumped, read or restored by these scripts.

**Where.** `$HOME/backups/v2/<YYYYmmdd-HHMMSS>/` (UTC stamp; outside the repo so a re-clone or `git clean -fdx` cannot wipe it; `BACKUP_ROOT` overrides), one `<db>.sql.gz` per database plus
`MANIFEST.json` (sizes, sha256, tables, row counts per table) and `SHA256SUMS`. `STATUS.json` and `VERIFY.json`
sit beside the sets. Directories are mode 700 and files 600. A pre-existing backup folder is never chmod-ed. Never commit dumps.
A set only gets its final name after every dump passed `gzip -t`, a size floor, a `CREATE TABLE` check, the
pg_dump completion footer and a sha256; a failed run leaves earlier sets untouched and writes `ok: false` to
`STATUS.json`. Each dump must contain its anchor tables (main: `entities`, `settings`, `users`; entity:
`_entity_migrations`, `Movement`, `Unit`) and is compared with the previous good set: a lost table, or a row
total that fell by more than half (previous total at least 20), flags the new set "suspect" in its manifest,
sets `ok: false`, skips rotation and exits 2. Run with `BACKUP_ACCEPT_SHRINK=1` after a deliberate purge.
Exit codes: 0 ok, 1 failed (no set written), 2 set written but partial or suspect (a skipped or undumpable
database, a failed rotation, shrunk data), 75 another run holds the lock.

**Retention.** The newest set of each of the last 14 days, plus the first set of each of the last 8 ISO weeks.
The newest set is never deleted, and nothing is deleted unless the new set verified. The policy lives in
`src/lib/backups/rotation.ts` (tested); `scripts/backup-v2.sh --rotate-only` applies it, `--dry-run` shows it.

**Run now / check.**

    npm run backups:run       # take a backup set (add -- --dry-run to preview, or --rotate-only)
    npm run backups:verify    # restore the newest set into throwaway databases and compare
    npm run backups:status    # print the last backup and restore-test result

The verify step picks the newest set that is not dated in the future and checks its age (26 h by default), checksums, a restore with zero errors, tables and row
counts against the manifest, the entity migration version (a failure only if it is newer than any file in
`prisma/entity/migrations/`; a mismatch with the registry is a note), and that the append-only triggers survived
and still reject an UPDATE and a TRUNCATE. Unregistered databases in the set are restored and table-checked too.
It also drops stale `zz_verify_*` throwaways (over a day old) left by a crashed run. Throwaway databases (`zz_verify_*`,
`vfxnow_ent_zz_verify_*`) are always dropped afterwards. Settings → Entities shows the result and turns red
when a backup is older than 26 hours, failed, or has never run. Alerts: the hourly reports cron (`/api/cron/reports`) emails the super admins once per distinct problem per
24 hours (stale, failed or never-run backup or restore test) through the normal email path, so the test redirect
applies; the record of what was mailed is the `backup_alert_state` row in `settings`. The Dashboard shows a red strip
to super admins while a problem stands.

Schedule both daily with cron (no secrets in the lines; the scripts find node themselves when cron's PATH has none):

    30 2 * * * cd /home/docker/projects/vfxnow-amc-v2 && scripts/backup-v2.sh >> /home/docker/logs/v2-backup.log 2>&1
    30 3 * * * cd /home/docker/projects/vfxnow-amc-v2 && scripts/verify-backups.sh >> /home/docker/logs/v2-backup.log 2>&1

Keep the log from growing without bound with `/etc/logrotate.d/v2-backup` (not installed by anything here):

    /home/docker/logs/v2-backup.log {
        weekly
        rotate 8
        compress
        copytruncate
        missingok
        notifempty
    }

A stale card means the schedule stopped.

**Restoring one database from a set.** Never restore over a live database, and never touch v1.

1. Pick the set and database: `ls ~/backups/v2/`, then check the file with
   `sha256sum -c SHA256SUMS` from inside the set directory.
2. Create a NEW empty database under a different name, for example
   `docker exec -i vfxnow-amc-db-1 psql -U postgres -d postgres -c 'CREATE DATABASE "vfxnow_ent_gpl_technologies_restore"'`.
3. Restore into it:
   `gzip -dc <set>/vfxnow_ent_gpl_technologies.sql.gz | docker exec -i vfxnow-amc-db-1 psql -U postgres -d vfxnow_ent_gpl_technologies_restore -v ON_ERROR_STOP=1 -q`.
4. Compare it with what you expect: table list and row counts against the set's `MANIFEST.json`
   (`rowsByTable`), the newest `Movement` rows, `SELECT max(version) FROM _entity_migrations`.
5. Only then decide how to swap. Stop the app (or deactivate the entity) first, rename the damaged database
   aside (`ALTER DATABASE ... RENAME TO ...`, never `DROP`), rename the restored one to the registered
   `dbName`, start the app, and run `npm run entities:migrate` if the dump predates a migration. Keep the
   damaged copy until the owner confirms the data.

**Limitation.** Backups live on the same disk and host as the database. They protect against bad deploys,
mistakes and corruption, but not against losing this machine or its disk. Copy `~/backups/v2/` off the box
(another host or object storage) on a schedule; that is not set up yet.
