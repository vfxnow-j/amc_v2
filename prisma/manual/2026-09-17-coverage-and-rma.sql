-- Coverage per model (asset_coverages, v2-only) and RMA tracking on work orders
-- (v2-only table). Additive. Generated with prisma migrate diff.
BEGIN;
-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "rmaNumber" TEXT,
ADD COLUMN     "rmaProvider" TEXT,
ADD COLUMN     "rmaReturnedAt" TIMESTAMP(3),
ADD COLUMN     "rmaSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "asset_coverages" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "termMonths" INTEGER NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_coverages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_coverages_assetId_idx" ON "asset_coverages"("assetId");

-- AddForeignKey
ALTER TABLE "asset_coverages" ADD CONSTRAINT "asset_coverages_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
