-- Portal Phase 2: what each unit may be offered as (rental / sale / flow). v2-only.
-- The v1 sync never writes this column. docs/portal-api.md, Phase 2.
DO $$ BEGIN
  CREATE TYPE "UnitOffering" AS ENUM ('RENTAL', 'SALE', 'FLOW', 'RENT_TO_OWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Rent-to-own was added the same day, after the type existed; staff-only, never portal.
ALTER TYPE "UnitOffering" ADD VALUE IF NOT EXISTS 'RENT_TO_OWN';

ALTER TABLE "asset_units"
  ADD COLUMN IF NOT EXISTS "offeredAs" "UnitOffering"[] NOT NULL DEFAULT ARRAY['RENTAL', 'FLOW']::"UnitOffering"[];
