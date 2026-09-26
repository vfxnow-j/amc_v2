-- Flow order type, ported from v1 (2026-09-22..25). Additive only; mirrors v1's
-- column names and types exactly so scripts/sync-from-v1.ts maps them by name.
-- Owner, 2026-09-26: schema changes are v2's own step, never part of a data pull.
ALTER TYPE "ReservationType" ADD VALUE IF NOT EXISTS 'FLOW';

ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "flowTermMonths"          INTEGER,
  ADD COLUMN IF NOT EXISTS "flowMonthlyPayment"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowContractValue"       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowStartDate"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowPeriodsBilled"       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "flowStepPct"             DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowMarginPct"           DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowFinancePct"          DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowPurchaseTaxPct"      DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowTaxExempt"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "flowRecoverByMonth"      INTEGER,
  ADD COLUMN IF NOT EXISTS "flowDeprPct"             DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowLifeMonths"          INTEGER,
  ADD COLUMN IF NOT EXISTS "flowAssumedAprPct"       DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowAssumedLoanBalance"  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowAssumedNoteMonths"   INTEGER,
  ADD COLUMN IF NOT EXISTS "flowExtensionPct"        DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "flowTermsSnapshot"       JSONB,
  ADD COLUMN IF NOT EXISTS "flowTermsVersion"        INTEGER,
  ADD COLUMN IF NOT EXISTS "flowAutopayMethod"       TEXT,
  ADD COLUMN IF NOT EXISTS "flowAutopayAuthorizedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "flowAutopayAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowAutopaySetupAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flowAutopaySetupById"    TEXT;

ALTER TABLE "reservation_items"
  ADD COLUMN IF NOT EXISTS "trueCost"         DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "flowAddedAtMonth" INTEGER;
