-- What was chosen when Send quote was pressed on a quote that needed approval
-- (2026-10-23): kept so the approver's yes can send it without a second press.
CREATE TABLE IF NOT EXISTS "quote_send_intents" (
  "id" TEXT PRIMARY KEY,
  "reservationId" TEXT NOT NULL UNIQUE,
  "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "message" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_send_intents_reservationId_fkey" FOREIGN KEY ("reservationId")
    REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
