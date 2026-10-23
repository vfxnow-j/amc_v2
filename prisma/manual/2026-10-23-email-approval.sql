-- Client email approval (2026-10-23). Mail to a client or contact address is
-- refused until an admin approves it; every existing row starts unapproved.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "emailApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "emailApprovedAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "emailApprovedById" TEXT;
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "emailApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "emailApprovedAt" TIMESTAMP(3);
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "emailApprovedById" TEXT;
