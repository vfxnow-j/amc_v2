-- Deal associations (2026-10-20): the owner links orders that are the same job
-- (competing bids, versions across clients). Orders in one group count as one
-- deal in the Forecast and the BT Report; which of them count is chosen with
-- the existing forecast_choices (COUNT / SKIP). temperature is a manual
-- Hot/Warm/Cold weight for the group's quotes. v2-only; the v1 sync never writes it.
CREATE TABLE IF NOT EXISTS "deal_groups" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "temperature" TEXT CHECK ("temperature" IN ('HOT', 'WARM', 'COLD')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "deal_group_members" (
  "reservationId" TEXT PRIMARY KEY REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "dealGroupId" TEXT NOT NULL REFERENCES "deal_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "deal_group_members_group_idx" ON "deal_group_members" ("dealGroupId");
