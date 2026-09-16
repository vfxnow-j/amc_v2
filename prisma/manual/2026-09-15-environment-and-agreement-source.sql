-- The environment profile (Phase 3) and how an agreement got signed.
--
-- Additive only, applied by hand in one transaction, like every migration in
-- this directory. Two enums, one table, two nullable columns on clients.
-- Nothing is dropped, rewritten or backfilled.
--
-- `client_environment_items` stores only what an account owns **elsewhere**.
-- The other two columns of the profile — what we supply, what they have asked
-- for — are derived at read time from order lines and `client_asks`. Storing
-- either would be a second copy of a fact this database already holds.
--
-- `clients.agreementSource` is null on every existing row and stays null: it
-- records how an agreement arrived, and for the agreements already on file
-- nobody wrote that down. A null reads as "unrecorded", not as "by quote".
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script`.

BEGIN;

-- CreateEnum
CREATE TYPE "EnvSection" AS ENUM ('WORKSTATION', 'STORAGE', 'NETWORK', 'SOFTWARE', 'SERVICES');

-- CreateEnum
CREATE TYPE "AgreementSource" AS ENUM ('RENTAL_AGREEMENT', 'QUOTE_SIGNATURE');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "agreementReservationId" TEXT,
ADD COLUMN     "agreementSource" "AgreementSource";

-- CreateTable
CREATE TABLE "client_environment_items" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "section" "EnvSection" NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "quantity" INTEGER,
    "os" TEXT,
    "gpu" TEXT,
    "capacityTb" DECIMAL(10,2),
    "percentUsed" INTEGER,
    "protocol" TEXT,
    "backup" TEXT,
    "speed" TEXT,
    "refreshAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_environment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_environment_items_clientId_section_idx" ON "client_environment_items"("clientId", "section");

-- AddForeignKey
ALTER TABLE "client_environment_items" ADD CONSTRAINT "client_environment_items_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_environment_items" ADD CONSTRAINT "client_environment_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
