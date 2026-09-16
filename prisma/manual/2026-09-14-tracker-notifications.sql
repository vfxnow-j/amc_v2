-- Client Tracker, Phase 2: four notification types for the follow-up queue.
--
-- Additive only. ADD VALUE cannot be undone without recreating the type, which
-- is why these are the four the spec names and no speculative extras: a
-- next step that is due, a quote nobody has chased, a Hot or newly-Warm
-- account going quiet, and a rental about to come back. Nothing is backfilled;
-- the daily sweep raises them from derived state on its next run.
--
-- Not wrapped in a transaction: a value added inside one cannot be used until
-- it commits, and there is nothing here to roll back together.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUOTE_UNANSWERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_QUIET';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RENTAL_ENDING';
