-- Procurement, Phase 1 (docs/procurement.md). Additive only: ports v1's funding
-- requests and the PO/unit trail column-for-column, so a refresh from v1 keeps
-- those rows instead of dropping them. Generated with prisma migrate diff.
BEGIN;

-- CreateEnum
CREATE TYPE "FundingRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'DECLINED', 'FUNDED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FundingPurchaseType" AS ENUM ('HARDWARE_RENTAL', 'HARDWARE_RESALE', 'HARDWARE_CLOUD');

-- CreateEnum
CREATE TYPE "CustomerCommitment" AS ENUM ('PO_CONTRACT', 'VERBAL', 'GENERAL_INVENTORY');

-- AlterTable
ALTER TABLE "asset_units" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "leaseId" TEXT;

-- CreateTable
CREATE TABLE "funding_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "status" "FundingRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedBy" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "neededByDate" TIMESTAMP(3),
    "amountRequested" DECIMAL(12,2) NOT NULL,
    "businessPurpose" TEXT,
    "purchaseType" "FundingPurchaseType",
    "equipmentSummary" TEXT,
    "totalEquipmentCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "clientId" TEXT,
    "projectName" TEXT,
    "customerCommitment" "CustomerCommitment",
    "customerRentalRate" DECIMAL(12,2),
    "billableUnits" INTEGER,
    "customerRentalCharge" DECIMAL(12,2),
    "expectedInitialRevenue" DECIMAL(12,2),
    "rentalPeriod" TEXT,
    "paymentTerms" TEXT,
    "lender" TEXT,
    "amountBorrowed" DECIMAL(12,2),
    "interestRate" DECIMAL(5,4),
    "termMonths" INTEGER,
    "monthlyPayment" DECIMAL(12,2),
    "financingFees" DECIMAL(12,2),
    "estimatedTotalInterest" DECIMAL(12,2),
    "firstPaymentDate" TIMESTAMP(3),
    "expectedPayoffDate" TIMESTAMP(3),
    "expectedGrossProfit" DECIMAL(12,2),
    "estimatedPaybackMonths" INTEGER,
    "expectedAnnualUtilization" DECIMAL(5,2),
    "expectedHoldMonths" INTEGER,
    "expectedAnnualRevenue" DECIMAL(12,2),
    "estimatedResaleValue" DECIMAL(12,2),
    "exitPlan" TEXT,
    "alternateUsePlan" TEXT,
    "borrowRationale" TEXT,
    "operationsApprovedBy" TEXT,
    "financeApprovedBy" TEXT,
    "executiveApprovedBy" TEXT,
    "approvalDate" TIMESTAMP(3),
    "declineReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "fundedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "notes" TEXT,
    "leaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_request_items" (
    "id" TEXT NOT NULL,
    "fundingRequestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FundingRequestPurchaseOrders" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FundingRequestPurchaseOrders_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_FundingRequestReservations" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FundingRequestReservations_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "funding_requests_requestNumber_key" ON "funding_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "funding_requests_status_idx" ON "funding_requests"("status");

-- CreateIndex
CREATE INDEX "funding_requests_clientId_idx" ON "funding_requests"("clientId");

-- CreateIndex
CREATE INDEX "funding_request_items_fundingRequestId_idx" ON "funding_request_items"("fundingRequestId");

-- CreateIndex
CREATE INDEX "_FundingRequestPurchaseOrders_B_index" ON "_FundingRequestPurchaseOrders"("B");

-- CreateIndex
CREATE INDEX "_FundingRequestReservations_B_index" ON "_FundingRequestReservations"("B");

-- CreateIndex
CREATE INDEX "asset_units_purchaseOrderId_idx" ON "asset_units"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_orders_leaseId_idx" ON "purchase_orders"("leaseId");

-- AddForeignKey
ALTER TABLE "asset_units" ADD CONSTRAINT "asset_units_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_request_items" ADD CONSTRAINT "funding_request_items_fundingRequestId_fkey" FOREIGN KEY ("fundingRequestId") REFERENCES "funding_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FundingRequestPurchaseOrders" ADD CONSTRAINT "_FundingRequestPurchaseOrders_A_fkey" FOREIGN KEY ("A") REFERENCES "funding_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FundingRequestPurchaseOrders" ADD CONSTRAINT "_FundingRequestPurchaseOrders_B_fkey" FOREIGN KEY ("B") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FundingRequestReservations" ADD CONSTRAINT "_FundingRequestReservations_A_fkey" FOREIGN KEY ("A") REFERENCES "funding_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FundingRequestReservations" ADD CONSTRAINT "_FundingRequestReservations_B_fkey" FOREIGN KEY ("B") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
