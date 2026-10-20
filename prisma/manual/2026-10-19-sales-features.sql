-- Sales features ported from v1 (2026-10-19). Additive only; same names and types as v1
-- so the sync maps them. Build groups, hide-part-prices, sale channel and fees, quote views.
DO $$ BEGIN
  CREATE TYPE "SaleChannel" AS ENUM ('CUSTOMER', 'EBAY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "asset_units" ADD COLUMN IF NOT EXISTS "saleChannel" "SaleChannel";
ALTER TABLE "asset_units" ADD COLUMN IF NOT EXISTS "saleFees" DECIMAL(12,2);
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "hideBuildPartPrices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reservation_items" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "quote_tokens" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "quote_tokens" ADD COLUMN IF NOT EXISTS "sentTo" TEXT;
ALTER TABLE "quote_tokens" ADD COLUMN IF NOT EXISTS "firstViewedAt" TIMESTAMP(3);
ALTER TABLE "quote_tokens" ADD COLUMN IF NOT EXISTS "lastViewedAt" TIMESTAMP(3);
ALTER TABLE "quote_tokens" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;
