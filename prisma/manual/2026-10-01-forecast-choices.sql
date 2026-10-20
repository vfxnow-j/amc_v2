-- Accounting → Forecast: the owner's call on an open order when the automatic
-- grouping of versions gets it wrong (2026-10-01). v2-only; the v1 sync never
-- writes it. mode: COUNT (count this version), SKIP (leave it out),
-- SEPARATE (its own deal, not a version of another order).
CREATE TABLE IF NOT EXISTS "forecast_choices" (
  "reservationId" TEXT PRIMARY KEY REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('COUNT', 'SKIP', 'SEPARATE')),
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
