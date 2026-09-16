-- The Client Tracker, Phase 1 (docs/client-tracker.md).
--
-- Additive only, applied by hand for the reasons the asset-components migration
-- records: two new tables, eight new enums, and six nullable (or defaulted)
-- columns on clients. Nothing is dropped, rewritten or backfilled, so no screen
-- reports anything different the moment this lands.
--
-- What is deliberately NOT here: a band, a tier, a "last contacted" date, or
-- anything else that classifies an account. Those are derived at read time by
-- lib/tracker/temperature.ts from these rows, the account's orders and today's
-- date. A stored classification goes stale — Reservation.subtotal is the
-- standing example on this database — and a follow-up queue that drifts is
-- worse than none.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` and applied in one transaction.

BEGIN;

-- CreateEnum
CREATE TYPE "TemperatureBand" AS ENUM ('HOT', 'WARM', 'COLD', 'SEASONAL', 'DEAD');

-- CreateEnum
CREATE TYPE "Business" AS ENUM ('VFXNOW', 'GPL');

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('CALL', 'EMAIL', 'TEXT', 'VIDEO', 'MEETING', 'IN_PERSON', 'EVENT');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "InteractionReach" AS ENUM ('CONNECTED', 'NO_ANSWER', 'VOICEMAIL', 'NO_REPLY');

-- CreateEnum
CREATE TYPE "InteractionIntent" AS ENUM ('NO_GO', 'NOT_NOW', 'CURIOUS', 'PROSPECTING', 'READY_TO_BUY');

-- CreateEnum
CREATE TYPE "NextStepKind" AS ENUM ('FOLLOW_UP', 'SEND_QUOTE', 'DEMO', 'SITE_VISIT', 'NONE');

-- CreateEnum
CREATE TYPE "AskCategory" AS ENUM ('WORKSTATION', 'GPU', 'STORAGE', 'NETWORK', 'REMOTE_ACCESS', 'SOFTWARE', 'CLOUD', 'PRO_SERVICES', 'MANAGED_SERVICES', 'LOGISTICS', 'OTHER');

-- CreateEnum
CREATE TYPE "AskStatus" AS ENUM ('OPEN', 'QUOTED', 'WON', 'LOST', 'CANT_SUPPLY');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "seasonalMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "tempPin" "TemperatureBand",
ADD COLUMN     "tempPinById" TEXT,
ADD COLUMN     "tempPinReason" TEXT,
ADD COLUMN     "tempPinUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "business" "Business" NOT NULL DEFAULT 'VFXNOW',
    "channel" "InteractionChannel" NOT NULL,
    "direction" "InteractionDirection" NOT NULL DEFAULT 'OUTBOUND',
    "reach" "InteractionReach" NOT NULL,
    "intent" "InteractionIntent",
    "nextStep" "NextStepKind" NOT NULL DEFAULT 'NONE',
    "nextStepAt" TIMESTAMP(3),
    "nextStepDoneAt" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "notes" TEXT,
    "reservationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_asks" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "interactionId" TEXT,
    "business" "Business" NOT NULL DEFAULT 'VFXNOW',
    "category" "AskCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER,
    "status" "AskStatus" NOT NULL DEFAULT 'OPEN',
    "reservationId" TEXT,
    "lostReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_asks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interactions_clientId_occurredAt_idx" ON "interactions"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "interactions_leadId_occurredAt_idx" ON "interactions"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "interactions_nextStepAt_idx" ON "interactions"("nextStepAt");

-- CreateIndex
CREATE INDEX "client_asks_clientId_status_idx" ON "client_asks"("clientId", "status");

-- CreateIndex
CREATE INDEX "client_asks_leadId_status_idx" ON "client_asks"("leadId", "status");

-- CreateIndex
CREATE INDEX "clients_ownerId_idx" ON "clients"("ownerId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tempPinById_fkey" FOREIGN KEY ("tempPinById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_asks" ADD CONSTRAINT "client_asks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_asks" ADD CONSTRAINT "client_asks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_asks" ADD CONSTRAINT "client_asks_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_asks" ADD CONSTRAINT "client_asks_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
