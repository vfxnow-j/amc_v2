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
