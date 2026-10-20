-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('SERIALIZED', 'QUANTITY');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('IN_STORAGE', 'DEPLOYED', 'RETURNED_TO_OWNER');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE', 'MOVE', 'RELEASE', 'RETURN');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "categoryId" TEXT,
    "trackingMode" "TrackingMode" NOT NULL DEFAULT 'SERIALIZED',
    "specs" JSONB,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "serial" TEXT,
    "ownerTag" TEXT,
    "scanTag" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'IN_STORAGE',
    "currentLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deployed" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movement" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "recipient" TEXT,
    "destination" TEXT,
    "reference" TEXT,
    "carrier" TEXT,
    "tracking" TEXT,
    "finalToOwner" BOOLEAN NOT NULL DEFAULT false,
    "correctsId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_scanTag_key" ON "Unit"("scanTag");

-- CreateIndex
CREATE INDEX "Unit_itemId_idx" ON "Unit"("itemId");

-- CreateIndex
CREATE INDEX "Unit_status_idx" ON "Unit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_itemId_locationId_deployed_key" ON "Stock"("itemId", "locationId", "deployed");

-- CreateIndex
CREATE INDEX "Movement_itemId_idx" ON "Movement"("itemId");

-- CreateIndex
CREATE INDEX "Movement_unitId_idx" ON "Movement"("unitId");

-- CreateIndex
CREATE INDEX "Movement_occurredAt_idx" ON "Movement"("occurredAt");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Movements are a ledger: never edited, never deleted. A correction is a new row.
CREATE OR REPLACE FUNCTION movement_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Movement rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Movement_append_only"
  BEFORE UPDATE OR DELETE ON "Movement"
  FOR EACH ROW EXECUTE FUNCTION movement_is_append_only();
