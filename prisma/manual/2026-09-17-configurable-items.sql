-- Configurable items (v2-only table asset_components): a build part can be a
-- priced spec option with no asset (RAM, most storage), carries the slot it
-- configures, and a sale price for machines sold rather than rented.
-- Additive; the table holds no rows yet. Generated with prisma migrate diff.
BEGIN;
CREATE TYPE "ConfigSlot" AS ENUM ('GPU', 'MEMORY', 'STORAGE', 'ADDON', 'OTHER');
ALTER TABLE "asset_components" ADD COLUMN "label" TEXT,
ADD COLUMN "salePrice" DECIMAL(12,2),
ADD COLUMN "slot" "ConfigSlot" NOT NULL DEFAULT 'OTHER',
ALTER COLUMN "componentAssetId" DROP NOT NULL;
COMMIT;
