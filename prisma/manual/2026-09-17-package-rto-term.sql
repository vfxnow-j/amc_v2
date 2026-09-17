-- packages."rtoTermMonths": a per-option financing term on rent-to-own quotes.
-- v1 added the column; this gives v2 the same field so the v1 sync brings the
-- values across. Additive. Generated with prisma migrate diff.
BEGIN;
ALTER TABLE "packages" ADD COLUMN "rtoTermMonths" INTEGER;
COMMIT;
