-- Inventory → Map: offline geocoding cache and postal centroids (2026-09-26). v2-only.
-- The v1 sync never writes these tables. docs/inventory-map.md
DO $$ BEGIN
  CREATE TYPE "GeocodePrecision" AS ENUM ('POSTAL', 'CITY', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "GeocodeSource" AS ENUM ('GEONAMES', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "GeocodeStatus" AS ENUM ('OK', 'NOT_FOUND', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "geocodes" (
  "id"          TEXT NOT NULL,
  "addressKey"  TEXT NOT NULL,
  "addressText" TEXT NOT NULL,
  "lat"         DOUBLE PRECISION,
  "lng"         DOUBLE PRECISION,
  "precision"   "GeocodePrecision",
  "source"      "GeocodeSource" NOT NULL DEFAULT 'GEONAMES',
  "status"      "GeocodeStatus" NOT NULL,
  "countryCode" TEXT,
  "region"      TEXT,
  "city"        TEXT,
  "postalCode"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "geocodes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "geocodes_addressKey_key" ON "geocodes"("addressKey");

CREATE TABLE IF NOT EXISTS "postal_centroids" (
  "countryCode" TEXT NOT NULL,
  "postalCode"  TEXT NOT NULL,
  "place"       TEXT NOT NULL,
  "admin1Code"  TEXT,
  "lat"         DOUBLE PRECISION NOT NULL,
  "lng"         DOUBLE PRECISION NOT NULL,
  CONSTRAINT "postal_centroids_pkey" PRIMARY KEY ("countryCode", "postalCode")
);
CREATE INDEX IF NOT EXISTS "postal_centroids_countryCode_admin1Code_place_idx"
  ON "postal_centroids"("countryCode", "admin1Code", "place");
