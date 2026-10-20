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

**Where.** `backups/scheduled/<YYYYmmdd-HHMMSS>/` (UTC stamp), one `<db>.sql.gz` per database plus
`MANIFEST.json` (sizes, sha256, tables, row counts per table) and `SHA256SUMS`. `STATUS.json` and `VERIFY.json`
sit beside the sets. The folder is gitignored, directories are mode 700 and files 600. Never commit dumps.
A set only gets its final name after every dump passed `gzip -t`, a size floor, a `CREATE TABLE` check and the
pg_dump completion footer; a failed run leaves earlier sets untouched and writes `ok: false` to `STATUS.json`.

**Retention.** The newest set of each of the last 14 days, plus the first set of each of the last 8 ISO weeks.
The newest set is never deleted, and nothing is deleted unless the new set verified. The policy lives in
`src/lib/backups/rotation.ts` (tested); `scripts/backup-v2.sh --rotate-only` applies it, `--dry-run` shows it.

**Run now / check.**

    npm run backups:run       # take a backup set (add -- --dry-run to preview)
    npm run backups:verify    # restore the newest set into throwaway databases and compare
    npm run backups:status    # print the last backup and restore-test result

The verify step checks the set's age (26 h by default), checksums, a restore with zero errors, tables and row
counts against the manifest, the entity migration version against the registry, and that the append-only
triggers survived and still reject an UPDATE and a TRUNCATE. Throwaway databases (`zz_verify_*`,
`vfxnow_ent_zz_verify_*`) are always dropped afterwards. Settings → Entities shows the result and turns red
when a backup is older than 26 hours, failed, or has never run. Schedule both with cron
(cron's PATH is minimal, so the lines set it; no secrets are involved):

    30 2 * * * cd /home/docker/projects/vfxnow-amc-v2 && PATH=/home/docker/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin scripts/backup-v2.sh >> /home/docker/logs/v2-backup.log 2>&1
    30 3 * * 0 cd /home/docker/projects/vfxnow-amc-v2 && PATH=/home/docker/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin scripts/verify-backups.sh >> /home/docker/logs/v2-backup.log 2>&1

A stale card means the schedule stopped.

**Restoring one database from a set.** Never restore over a live database, and never touch v1.

1. Pick the set and database: `ls backups/scheduled/`, then check the file with
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
mistakes and corruption, but not against losing this machine or its disk. Copy `backups/scheduled/` off the box
(another host or object storage) on a schedule; that is not set up yet.
