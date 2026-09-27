-- Portal Phase 2: product images per portal offer. v2-only; the v1 sync never writes it.
CREATE TABLE IF NOT EXISTS "portal_offer_images" (
  "id"          TEXT NOT NULL,
  "offerId"     TEXT NOT NULL,
  "version"     TEXT NOT NULL,
  "alt"         TEXT,
  "width"       INTEGER NOT NULL,
  "height"      INTEGER NOT NULL,
  "bytes"       INTEGER NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_offer_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_offer_images_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "portal_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "portal_offer_images_offerId_sortOrder_idx" ON "portal_offer_images"("offerId", "sortOrder");
