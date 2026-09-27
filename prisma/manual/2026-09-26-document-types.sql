-- Vendor quotes on purchase orders, and coverage paperwork on units (owner, 2026-09-26).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'VENDOR_QUOTE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'COVERAGE_AGREEMENT';
