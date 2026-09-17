-- Our packages (v2-only): predefined package templates and their lines, loaded
-- into any quote from Add line. Additive only; v1 has no such tables, so the
-- v1 sync never touches them. Generated with prisma migrate diff.
BEGIN;

-- CreateTable
CREATE TABLE "package_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "assetId" TEXT,
    "serviceId" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(12,2),
    "pricingType" "PricingType",
    "isOneTime" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_template_items_templateId_idx" ON "package_template_items"("templateId");

-- AddForeignKey
ALTER TABLE "package_template_items" ADD CONSTRAINT "package_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "package_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_template_items" ADD CONSTRAINT "package_template_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_template_items" ADD CONSTRAINT "package_template_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
