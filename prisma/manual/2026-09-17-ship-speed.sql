-- Outbound shipping speed and ship date (owner, 2026-09-17). v2-only.
DO $$ BEGIN
  CREATE TYPE "ShippingSpeed" AS ENUM ('SAME_DAY', 'OVERNIGHT', 'TWO_DAY', 'THREE_DAY', 'GROUND', 'FREIGHT_EXPEDITED', 'FREIGHT_STANDARD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "shipDate" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "shipSpeed" "ShippingSpeed";
