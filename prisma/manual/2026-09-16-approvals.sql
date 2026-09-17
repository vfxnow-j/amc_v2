-- Approvals, Phase 6 (docs/procurement.md). Additive only, and v2-only: two new
-- tables (approval_requests, user_approval_scopes), their two enums, and
-- purchase_orders."raisedById". Nothing here adds a value to an enum v1 also
-- has, so a refresh's `prisma db push` has nothing to drop or refuse. All three
-- are carried by scripts/refresh-from-v1.sh. Generated with prisma migrate diff.
BEGIN;
-- CreateEnum
CREATE TYPE "ApprovalRecordType" AS ENUM ('PURCHASE_ORDER', 'FUNDING_REQUEST', 'QUOTE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "raisedById" TEXT;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "recordType" "ApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "recordLabel" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountAtRequest" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "amountAtDecision" DECIMAL(12,2),
    "reason" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_approval_scopes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordType" "ApprovalRecordType" NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_approval_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_recordType_recordId_idx" ON "approval_requests"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_approval_scopes_userId_recordType_key" ON "user_approval_scopes"("userId", "recordType");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_approval_scopes" ADD CONSTRAINT "user_approval_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_approval_scopes" ADD CONSTRAINT "user_approval_scopes_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
