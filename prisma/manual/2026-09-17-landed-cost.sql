-- PO landed cost, ported from v1: each unit carries its share of its PO's net
-- extras (freight + fees + tax − discount). Same column as v1's asset_units,
-- so the v1 sync copies it across.
BEGIN;
ALTER TABLE "asset_units" ADD COLUMN IF NOT EXISTS "landedCostAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;
COMMIT;
