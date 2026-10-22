-- Package lines keep category and cost, and say whether their rate is a sale price.
-- Applied with `prisma db push`; recorded here for any other database.
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "costBasis" DECIMAL(12,2);
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "salePriced" BOOLEAN NOT NULL DEFAULT false;
