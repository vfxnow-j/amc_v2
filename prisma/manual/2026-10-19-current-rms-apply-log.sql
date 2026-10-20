-- Old values saved before scripts/current-rms/apply-high-confidence.ts writes anything (2026-10-19).
-- v2-only, additive. One row per unit column changed; `runId` groups one apply run so
-- `--undo <runId>` can put every old value back. The v1 sync never touches this table.
CREATE TABLE IF NOT EXISTS "current_rms_apply_log" (
  "id"        TEXT NOT NULL,
  "runId"     TEXT NOT NULL,
  "pullRunId" INTEGER,
  "unitId"    TEXT NOT NULL,
  "barcode"   TEXT NOT NULL,
  "column"    TEXT NOT NULL,
  "oldValue"  TEXT,
  "newValue"  TEXT,
  "matchPct"  INTEGER,
  "reason"    TEXT,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt"  TIMESTAMP(3),
  CONSTRAINT "current_rms_apply_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "current_rms_apply_log_runId_idx" ON "current_rms_apply_log"("runId");
CREATE INDEX IF NOT EXISTS "current_rms_apply_log_unitId_idx" ON "current_rms_apply_log"("unitId");
