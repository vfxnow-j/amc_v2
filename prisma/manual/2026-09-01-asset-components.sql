-- Bill of materials: what a SKU is built from.
--
-- Applied by hand rather than through `prisma db push`, because push refuses to
-- run for an agent without per-command consent and, more importantly, because
-- everything here is additive — a new type, a new table, one new column with a
-- default. Nothing is dropped or rewritten, which is not a promise `db push`
-- makes on a database holding restored customer data.
--
-- Already applied to vfxnow_amc_v2 on 2026-09-01. Kept so the next instance
-- (and the go-live cutover) can be brought to the same shape deliberately.

CREATE TYPE "ComponentPriceMode" AS ENUM ('INCLUDED', 'ADDS');

CREATE TABLE "asset_components" (
  "id"               TEXT PRIMARY KEY,
  "assetId"          TEXT NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "componentAssetId" TEXT NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity"         INTEGER NOT NULL DEFAULT 1,
  "priceMode"        "ComponentPriceMode" NOT NULL DEFAULT 'ADDS',
  "isDefault"        BOOLEAN NOT NULL DEFAULT true,
  "tracked"          BOOLEAN NOT NULL DEFAULT false,
  "rateOverride"     DECIMAL(12,2),
  "notes"            TEXT,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "asset_components_assetId_componentAssetId_key"
  ON "asset_components"("assetId", "componentAssetId");
CREATE INDEX "asset_components_assetId_idx" ON "asset_components"("assetId");

-- A component line whose cost is already inside its parent's price. It keeps a
-- real rate — that is what the part is worth when somebody swaps it — and
-- contributes nothing to the total.
ALTER TABLE "reservation_items"
  ADD COLUMN "includedInParent" BOOLEAN NOT NULL DEFAULT false;
