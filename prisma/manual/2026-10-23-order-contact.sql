-- The person an order is for (2026-10-23): optional, at the order's own account.
-- Cleared (not the order deleted) if the contact is removed.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
DO $$ BEGIN
  ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "reservations_contactId_idx" ON "reservations"("contactId");
