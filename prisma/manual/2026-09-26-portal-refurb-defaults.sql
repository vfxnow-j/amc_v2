-- Portal capacity, owner decision applied as data (plan decision 7; others
-- keep the 2-business-day default). Workstations and Laptops get a 3-business-
-- day refurb buffer before a returned unit is promised again. v2 data is
-- expendable — this is a plain UPDATE, not a migration, and the column
-- default (2) is unchanged so every other category is unaffected.
-- Idempotent: setting the same value twice is a no-op. Apply to
-- vfxnow_amc_v2 only.
UPDATE "asset_categories"
SET "refurbBufferDays" = 3
WHERE "name" IN ('Workstations', 'Laptops');
