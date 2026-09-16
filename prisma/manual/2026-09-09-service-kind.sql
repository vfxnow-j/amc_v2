-- What kind of service a service is.
--
-- `Service.unit` says how a service is *charged* — "Flat", "Per Day" — and has
-- always been mistaken for what kind of work it is. It isn't: the six rows in
-- this database split into two managed-service lines and four professional
-- ones, and the only way to tell them apart was to read the names. Logistics
-- has no rows here at all yet; delivery and return costs live on the order.
--
-- Applied by hand rather than through `prisma db push`, for the reasons the
-- asset-components migration records: push refuses to run for an agent without
-- per-command consent, and everything here is additive — a new type and one new
-- column with a default. Nothing is dropped or rewritten, which is not a
-- promise push makes on a database holding restored customer data.
--
-- OTHER is the default rather than PROFESSIONAL, deliberately. A service whose
-- kind nobody has stated is unclassified, and defaulting it to the commonest
-- value would silently assert something about every row added from now on.
--
-- The six existing rows are set from their names below. That is a one-time
-- correction of data this column did not exist to hold, not a rule — nothing in
-- the app infers a kind from a name, and nothing should.

CREATE TYPE "ServiceKind" AS ENUM ('MANAGED', 'PROFESSIONAL', 'LOGISTICS', 'OTHER');

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "kind" "ServiceKind" NOT NULL DEFAULT 'OTHER';

UPDATE "services" SET "kind" = 'MANAGED'      WHERE "name" ILIKE '%managed service%';
UPDATE "services" SET "kind" = 'PROFESSIONAL' WHERE "name" ILIKE '%professional service%';
