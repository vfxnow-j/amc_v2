-- Package lines keep category and cost, and say whether their rate is a sale price.
-- Applied with `prisma db push`; recorded here for any other database.
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "costBasis" DECIMAL(12,2);
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "salePriced" BOOLEAN NOT NULL DEFAULT false;

-- A custom build keeps its parts: the build is a line, its parts hang off it.
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "package_template_items" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "package_template_items" DROP CONSTRAINT IF EXISTS "package_template_items_parentId_fkey";
ALTER TABLE "package_template_items" ADD CONSTRAINT "package_template_items_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "package_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
