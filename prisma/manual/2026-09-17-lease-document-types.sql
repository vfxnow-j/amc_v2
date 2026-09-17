-- Document types for files uploaded to a lease. ADD VALUE cannot run inside a
-- transaction block, so no BEGIN/COMMIT. Additive; v2 superset of v1's enum.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "DocumentType" ADD VALUE 'LEASE_AGREEMENT';
ALTER TYPE "DocumentType" ADD VALUE 'STATEMENT';
ALTER TYPE "DocumentType" ADD VALUE 'PAYOFF_LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'OTHER';
