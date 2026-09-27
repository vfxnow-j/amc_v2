-- Portal Phase 2: orders placed through the portal (POST /v1/orders). v2-only; the v1 sync never writes it.
CREATE TABLE IF NOT EXISTS "portal_orders" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "reservationId"  TEXT NOT NULL,
  "rateQuoteId"    TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash"    TEXT NOT NULL,
  "siteExternalId" TEXT NOT NULL,
  "poNumber"       TEXT,
  "quotedTotal"    DECIMAL(12,2) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portal_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "portal_orders_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_orders_reservationId_key" ON "portal_orders"("reservationId");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_orders_rateQuoteId_key" ON "portal_orders"("rateQuoteId");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_orders_portalClientId_idempotencyKey_key" ON "portal_orders"("portalClientId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "portal_orders_accountId_idx" ON "portal_orders"("accountId");
