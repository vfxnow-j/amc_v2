-- Coverage one unit is enrolled in, with its status (owner, 2026-09-17). v2-only.
--
-- Melrose Mac sells Macs with AppleCare+ on "Auto Enroll": the plan is a line
-- on the purchase order, Apple attaches it to the serial, and nothing on the
-- order says for how long. `service_coverages` (shared with v1) needs a start
-- and an end date on every row, so it cannot hold "bought, not yet confirmed,
-- term unknown" without inventing dates. This table holds exactly that: one row
-- per unit per plan, a status, the PO line that paid for it, and dates only
-- once somebody has seen them. v1 has no such table, so the v1 sync never
-- writes it; a unit, PO or PO line v1 deletes cascades or nulls as below.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "CoverageEnrollmentStatus" AS ENUM ('PURCHASED', 'ENROLLED', 'NOT_ENROLLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "coverage_enrollments" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "CoverageType" NOT NULL DEFAULT 'EXTENDED_WARRANTY',
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "status" "CoverageEnrollmentStatus" NOT NULL DEFAULT 'PURCHASED',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "agreementNumber" TEXT,
    "cost" DECIMAL(12,2),
    "purchaseOrderId" TEXT,
    "poItemId" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coverage_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "coverage_enrollments_unitId_idx" ON "coverage_enrollments"("unitId");
CREATE INDEX IF NOT EXISTS "coverage_enrollments_status_idx" ON "coverage_enrollments"("status");
CREATE INDEX IF NOT EXISTS "coverage_enrollments_purchaseOrderId_idx" ON "coverage_enrollments"("purchaseOrderId");

DO $$ BEGIN
  ALTER TABLE "coverage_enrollments" ADD CONSTRAINT "coverage_enrollments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "asset_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "coverage_enrollments" ADD CONSTRAINT "coverage_enrollments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "coverage_enrollments" ADD CONSTRAINT "coverage_enrollments_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "po_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
