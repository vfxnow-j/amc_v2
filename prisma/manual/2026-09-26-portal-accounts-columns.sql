-- Portal accounts: real columns for two facts chunk D had to keep in stand-ins
-- (owner approved, 2026-09-26). Additive, idempotent, v2 only.
--   portal_account_sites."isDefault"  — the account's default site (was: region = 'portal_default')
--   portal_accounts."createdClientId" — the client the portal itself created; PUT mirrors the
--       company/contact onto the linked client only while clientId = createdClientId
--       (was: a marker in clients.notes, which a staff edit could erase)
ALTER TABLE "portal_account_sites" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
-- At most one default site per account.
CREATE UNIQUE INDEX IF NOT EXISTS "portal_account_sites_one_default"
  ON "portal_account_sites" ("accountId") WHERE "isDefault";

ALTER TABLE "portal_accounts" ADD COLUMN IF NOT EXISTS "createdClientId" TEXT;
