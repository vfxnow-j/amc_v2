# Entities — design

Status: approved in conversation 2026-10-20, awaiting written-spec review. Nothing built.

## Why

VFXnow sometimes stores gear that belongs to someone else and releases it at their request. That gear
must be tracked in and out with the same accuracy as our own, but it must never reach VFXnow's numbers
(depreciation, utilization, the inventory map, reports). VFXnow is always master.

An **entity** is an owner whose gear we hold. Each entity gets its own database on the same Postgres
server and a modular workspace. Only the **Inventory** module is built now.

## Decisions

| Question | Decision |
|---|---|
| Data separation | One database per entity, same server, named `vfxnow_ent_<slug>`. |
| Schema | A small dedicated entity schema and Prisma client. Not the 84-model main schema. |
| Movements | Custody plus release and return slips. No rentals, pricing or invoicing: entity gear is only stored and dispersed at the owner's request. |
| Locations | Entity units reference VFXnow's real locations and sites by plain ID. A release moves the unit to its destination site, and it stays tracked there. |
| Permissions | A user's VFXnow role carries over. STAFF and above can receive, move and release; VIEWER is read-only; FLOW_USER never gets entity access. Only SUPER_ADMIN creates entities and grants access. |
| Modules | Per-entity module list. "Complete" is every module enabled, not a separate mode. Only Inventory exists now; the rest are shown greyed out as "coming soon". |

## Architecture and isolation

- **Registry (main database).** New `Entity` model: `id`, `name`, `slug` (immutable), `dbName`, `modules`
  (list of module keys), `active`, `schemaVersion`, and optional `contactName`, `email`, `phone`, `address`,
  `notes`. Holds no gear.
- **Entity schema.** `prisma/entity/schema.prisma`, generating a separate client. The main schema is not touched.
- **No cross-reach.** Main code never imports the entity client. Entity code reaches the main database only
  through one small module, read-only apart from creating a destination site on the spot, that resolves location and user names from plain IDs. No cross-database joins.
- **Routes.** Entity screens live under `/entity/[slug]/...`, with a reduced nav built from the enabled modules.
  Initial nav: Dashboard, Inventory, Receive, Release/Return, Movement log, Locations.
- **Guard.** `db-guard.ts` stays strict for the main client. The entity client accepts only database names matching
  `vfxnow_ent_[a-z0-9_]+` and still refuses v1's database.
- **Provisioning.** Creating an entity runs `CREATE DATABASE`, then applies the entity schema as SQL. `db push` is
  never run against an entity database. A script applies pending entity migrations to every entity database and
  records `schemaVersion`. Migrations are per module, so enabling a module later applies only that module's
  migration to that database.
- **Failure handling.** If provisioning fails, anything it created is dropped and the registry row is not saved.
  An unreachable entity database breaks only that entity's screens.

## Inventory module data model

- `Category` — simple per-entity list.
- `Item` — the catalog entry, mirroring `Asset` without anything financial: name, description, manufacturer,
  model, category, optional specs and image, notes, and a tracking mode of `SERIALIZED` or `QUANTITY`.
  No rates, depreciation, vendor, PO or market-price fields.
- `Unit` — a physical item under a `SERIALIZED` item, mirroring `AssetUnit`: serial, owner's tag, optional scan
  tag, condition, notes, status (`IN_STORAGE`, `DEPLOYED`, `RETURNED_TO_OWNER`), and `currentLocationId`
  (a plain reference to a VFXnow location).
- `Stock` — for `QUANTITY` items only: a quantity at a location. Moves and releases split and merge rows.
- `Movement` — append-only; never edited or deleted. Fields: type (`RECEIVE`, `MOVE`, `RELEASE`, `RETURN`), `RELEASE` carries a `finalToOwner` flag; when true the unit becomes `RETURNED_TO_OWNER` and leaves custody.
  unit or item with quantity, from and to location IDs, recipient, destination text, reference, carrier,
  tracking, date and time, acting user ID (plain reference to a VFXnow user), notes. A correction is a new
  movement that references the one it fixes.
- A unit's state is the result of its latest movement. A movement and the state change it causes are written
  in one transaction.
- **Release** moves the unit to the destination site and sets it `DEPLOYED`. **Return** brings it back.
- Screens follow the main inventory module: item list, item page with its units, add and edit, CSV import
  for the initial load.

## Settings, access and the switch

**Settings → Entities (SUPER_ADMIN only).**
- List of entities with modules and status.
- Create and edit form: name (required), generated slug (locked after creation), optional contact name, email,
  phone, address and notes; module checkboxes (Inventory on and locked, others greyed "coming soon", greyed
  "Complete: all modules" shortcut).
- Entities are deactivated, never deleted. A deactivated entity leaves the switch; its data is kept. Dropping a
  database is a manual, deliberate act.

**User access (SUPER_ADMIN only).**
- `User.entityAccess` (boolean), `User.entityScope` (`ALL` or `SELECTED`), and a `UserEntity` join table of grants.
- Per-user **Allow entity access** checkbox; when on, a selector offers **All entities** or specific ones.
- SUPER_ADMIN always has every entity. FLOW_USER cannot be granted access.

**Switch Entity.**
- In the sprocket menu under Appearance, shown only to users with access. Lists VFXnow plus the user's entities.
- Selecting one goes to `/entity/<slug>`. The entity shell has a distinct banner with the entity name and a
  "Back to VFXnow" link.
- The active entity comes from the URL and is re-checked against the user's grants on every request.
  Cookies and client state are never trusted.

## Testing

- Unit tests: access resolution (role, scope, grants); entity database name guard; movement state transitions
  (receive, move, release, return, and rejected invalid moves).
- Provisioning check against a throwaway database, including the rollback on failure.
- Isolation check that fails if any main-app file imports the entity client.

## Out of scope

- Any module beyond Inventory (Operate, Service Center, etc.) and the "Complete" shortcut working.
- Financials of any kind for entity gear.
- Showing entity gear on VFXnow's inventory map (possible later as an explicit layer).
- Initial data: loaded after the two entities are created, via the CSV import.

## Open items

- None blocking. The two entities' names and contact details come from the owner at creation time.
