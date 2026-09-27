-- Portal API, Phase 1 (docs/portal-api.md, docs/portal-api-plan.md §1–§2).
-- v2-only and additive: v1 has none of these tables, so the v1 sync never
-- touches them. Idempotent — every statement is IF NOT EXISTS or guarded, so
-- the file can be re-applied safely. Apply to vfxnow_amc_v2 only; never
-- `prisma db push` or `migrate`.
BEGIN;

-- A portal server that calls /v1 with a scoped service token. Deliberately not
-- ApiKey: an ApiKey carries a staff role, and a portal token must have no path
-- to staff access.
CREATE TABLE IF NOT EXISTS "portal_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "webhookUrl" TEXT,
    "webhookSecretEnc" TEXT,
    "allowedCidrs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 300,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_clients_tokenHash_key" ON "portal_clients"("tokenHash");
CREATE INDEX IF NOT EXISTS "portal_clients_tokenPrefix_idx" ON "portal_clients"("tokenPrefix");

-- A portal account, linked to exactly one AMC client. A new portalAccountId
-- creates a new Client; staff re-link, PUT never auto-merges (owner, 2026-09-26).
CREATE TABLE IF NOT EXISTS "portal_accounts" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "portalAccountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "verificationLevel" TEXT NOT NULL DEFAULT 'none',
    "creditTier" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_accounts_clientId_key" ON "portal_accounts"("clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_accounts_portalClientId_portalAccountId_key" ON "portal_accounts"("portalClientId", "portalAccountId");

-- An account's delivery sites, keyed by the portal's own site id.
CREATE TABLE IF NOT EXISTS "portal_account_sites" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalSiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_account_sites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_account_sites_accountId_externalSiteId_key" ON "portal_account_sites"("accountId", "externalSiteId");

-- A named set of server/GPU-node assets whose capacity is reported together.
CREATE TABLE IF NOT EXISTS "portal_capacity_pools" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT,
    "unitLabel" TEXT NOT NULL DEFAULT 'node',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_capacity_pools_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_capacity_pools_slug_key" ON "portal_capacity_pools"("slug");

-- A curated, opt-in catalog entry: nothing shows on the portal until staff
-- publish it (owner, 2026-09-26).
CREATE TABLE IF NOT EXISTS "portal_offers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "assetId" TEXT,
    "packageTemplateId" TEXT,
    "poolId" TEXT,
    "title" TEXT NOT NULL,
    "blurb" TEXT,
    "solutions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "termsBySolution" JSONB,
    "software" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "specs" JSONB,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portal_offers_kind_check" CHECK ("kind" IN ('ASSET', 'PACKAGE', 'POOL'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_offers_slug_key" ON "portal_offers"("slug");
CREATE INDEX IF NOT EXISTS "portal_offers_assetId_idx" ON "portal_offers"("assetId");
CREATE INDEX IF NOT EXISTS "portal_offers_packageTemplateId_idx" ON "portal_offers"("packageTemplateId");
CREATE INDEX IF NOT EXISTS "portal_offers_poolId_idx" ON "portal_offers"("poolId");

-- A priced quote snapshot; its id is the contract's rate_id. `lines` keeps the
-- internal basis and knobs so an order can reproduce the figures — it is never
-- returned as-is.
CREATE TABLE IF NOT EXISTS "portal_rate_quotes" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "consumedByReservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_rate_quotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portal_rate_quotes_accountId_idx" ON "portal_rate_quotes"("accountId");
CREATE INDEX IF NOT EXISTS "portal_rate_quotes_requestHash_idx" ON "portal_rate_quotes"("requestHash");

-- One row per /v1 request. Never bodies. Kept 30 days. No foreign keys, so a
-- deleted client or account never takes its request history with it.
CREATE TABLE IF NOT EXISTS "portal_request_log" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "ms" INTEGER NOT NULL,
    "portalClientId" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_request_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portal_request_log_createdAt_idx" ON "portal_request_log"("createdAt");
CREATE INDEX IF NOT EXISTS "portal_request_log_portalClientId_createdAt_idx" ON "portal_request_log"("portalClientId", "createdAt");

-- next_available = return date + transit + this buffer (plan §3; owner
-- default 2 business days, workstations and laptops 3 — set per category).
ALTER TABLE "asset_categories" ADD COLUMN IF NOT EXISTS "refurbBufferDays" INTEGER NOT NULL DEFAULT 2;

-- Foreign keys, guarded so a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_accounts_portalClientId_fkey') THEN
    ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_portalClientId_fkey"
      FOREIGN KEY ("portalClientId") REFERENCES "portal_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- RESTRICT: deleting a client a portal account points at must be a deliberate
  -- re-link, never a silent cascade.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_accounts_clientId_fkey') THEN
    ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_account_sites_accountId_fkey') THEN
    ALTER TABLE "portal_account_sites" ADD CONSTRAINT "portal_account_sites_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_capacity_pools_categoryId_fkey') THEN
    ALTER TABLE "portal_capacity_pools" ADD CONSTRAINT "portal_capacity_pools_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_offers_assetId_fkey') THEN
    ALTER TABLE "portal_offers" ADD CONSTRAINT "portal_offers_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_offers_packageTemplateId_fkey') THEN
    ALTER TABLE "portal_offers" ADD CONSTRAINT "portal_offers_packageTemplateId_fkey"
      FOREIGN KEY ("packageTemplateId") REFERENCES "package_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_offers_poolId_fkey') THEN
    ALTER TABLE "portal_offers" ADD CONSTRAINT "portal_offers_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "portal_capacity_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_rate_quotes_accountId_fkey') THEN
    ALTER TABLE "portal_rate_quotes" ADD CONSTRAINT "portal_rate_quotes_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
