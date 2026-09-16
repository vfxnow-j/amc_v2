-- The custom dashboard, and how a prospect quote is held.
--
-- Two unrelated features in one file because they were applied in one pass:
-- both are additive, and batching them means one `prisma generate` and one
-- restart of the owner's long-lived dev server rather than two. Nothing here
-- drops or rewrites anything, which is not a promise `prisma db push` makes on
-- a database holding restored customer data — see the asset-components
-- migration for the fuller argument against push.
--
-- ---------------------------------------------------------------------------
-- 1. clients.prospectAt
--
-- A quote for someone who has not onboarded is held against a thin, flagged
-- Client, not against a nullable Reservation.clientId. That FK is included
-- non-optionally by getQuoteByToken, every PDF builder, sendQuoteLinkEmail and
-- the invoice path, so making it nullable would turn one schema line into
-- hundreds of `?.` and silent nulls in documents that go out to clients. The
-- order builder already materialises a client inline, so this is the existing
-- behaviour given a name.
--
-- Nullable and only ever set forward: every existing client row stays NULL and
-- means "a real client", so there is no backfill and no overnight change to
-- what any screen reports.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "prospectAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 2. users: the dashboard choice and three appearance axes
--
-- Nullable strings, exactly like colorMode and themeName, and validated in
-- lib/theme rather than by an enum — for the reason that model already
-- records: a seventh shade should be two CSS lines, not a migration.
--
-- dashboardView is deliberately NOT a foreign key. A template an admin deletes
-- must degrade to the fallback view, not cascade a delete into user rows.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "dashboardView" TEXT,
  ADD COLUMN IF NOT EXISTS "navShade"      TEXT,
  ADD COLUMN IF NOT EXISTS "groundShade"   TEXT,
  ADD COLUMN IF NOT EXISTS "tileStyle"     TEXT;

-- ---------------------------------------------------------------------------
-- 3. dashboard_templates
--
-- Company-level, admin-defined. A table rather than a Setting row so that two
-- admins editing different templates is not last-write-wins over the whole
-- set, which is what a single JSON blob under one key would give.
--
-- `tiles` is never trusted on read: every read goes through zod, unknown tile
-- ids are dropped and geometry is clamped. `access` empty means every role,
-- and role-gating is enforced again at render — never only here, and never
-- only in the picker.

CREATE TABLE IF NOT EXISTS "dashboard_templates" (
  "id"        TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "tiles"     JSONB NOT NULL,
  -- No NOT NULL here, deliberately. Prisma does not mark scalar list columns
  -- NOT NULL, so adding it would make the database stricter than the model can
  -- express and `migrate diff` would want to undo it on every run — which is the
  -- command this project uses to confirm a hand-applied change landed exactly.
  "access"    "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dashboard_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_templates_key_key"
  ON "dashboard_templates" ("key");

-- ---------------------------------------------------------------------------
-- 4. dashboard_layouts
--
-- One user's reshaped copy of one template. No row means "the template as-is",
-- so nothing is seeded here and a user who has never dragged a tile has no
-- row at all.
--
-- templateKey is a plain string rather than an FK, for the same reason as
-- users.dashboardView above: a deleted template should orphan a layout
-- harmlessly. userId IS a real FK — a layout belonging to no user is garbage,
-- so it cascades.

CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "tiles"       JSONB NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_layouts_userId_templateKey_key"
  ON "dashboard_layouts" ("userId", "templateKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_layouts_userId_fkey'
  ) THEN
    ALTER TABLE "dashboard_layouts"
      ADD CONSTRAINT "dashboard_layouts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
