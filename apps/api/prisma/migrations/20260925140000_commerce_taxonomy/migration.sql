-- Smart commerce taxonomy.
--
-- One Seller account type classifies what it sells against a shared tree of
-- categories, each with an attribute schema; customer requirements use the
-- same tree so fleet owners can match demand to listings on structured data.
-- Purely additive: existing listings and requirements keep their free-text
-- category and simply have no taxonomy node until one is confirmed.

-- CreateEnum
CREATE TYPE "CommerceCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommerceAttributeType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "CommerceAttributeScope" AS ENUM ('BOTH', 'PRODUCT', 'REQUIREMENT');

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "categoryId" UUID;

-- AlterTable
ALTER TABLE "requirements" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "categoryId" UUID;

-- CreateTable
CREATE TABLE "commerce_categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "CommerceCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "defaultUnit" "MaterialUnit",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_category_attributes" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CommerceAttributeType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT,
    "options" TEXT[],
    "validation" JSONB,
    "scope" "CommerceAttributeScope" NOT NULL DEFAULT 'BOTH',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_category_aliases" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_category_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materials_categoryId_status_idx" ON "materials"("categoryId", "status");

-- CreateIndex
CREATE INDEX "requirements_categoryId_status_idx" ON "requirements"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_categories_slug_key" ON "commerce_categories"("slug");

-- CreateIndex
CREATE INDEX "commerce_categories_parentId_sortOrder_idx" ON "commerce_categories"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "commerce_categories_status_idx" ON "commerce_categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_category_attributes_categoryId_key_key" ON "commerce_category_attributes"("categoryId", "key");

-- CreateIndex
CREATE INDEX "commerce_category_aliases_alias_idx" ON "commerce_category_aliases"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_category_aliases_categoryId_alias_key" ON "commerce_category_aliases"("categoryId", "alias");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_categories" ADD CONSTRAINT "commerce_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "commerce_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_category_attributes" ADD CONSTRAINT "commerce_category_attributes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_category_aliases" ADD CONSTRAINT "commerce_category_aliases_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
