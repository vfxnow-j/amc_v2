-- A user who cannot sign in, without losing their history (2026-10-19). v2-only;
-- the v1 sync never writes it. Sign-in refuses them and a live session is
-- ended on its next check. Clear it to let them back in.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);

-- Launch is J, Marvin and Donald; the other six are switched off (owner, 2026-10-19).
UPDATE "users" SET "disabledAt" = CURRENT_TIMESTAMP
WHERE "disabledAt" IS NULL
  AND "email" IN ('admin@vfxnow.com', 'julian.blum@vfxnow.com', 'jim.krzyzak@gpltech.com',
                  'brian@gpltech.com', 'jtylerroen@gmail.com', 'nick.allevato@gpltech.com');
