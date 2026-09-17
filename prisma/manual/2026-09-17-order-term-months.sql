-- Committed term of a recurring rental/cloud deal, in months (owner, 2026-09-17).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "termMonths" INTEGER;
