-- CreateEnum
CREATE TYPE "TerminalReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "terminal_releases" (
    "id" UUID NOT NULL,
    "versionCode" INTEGER NOT NULL,
    "versionName" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "minSdk" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "signingSha256" TEXT,
    "status" "TerminalReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terminal_releases_versionCode_key" ON "terminal_releases"("versionCode");

-- CreateIndex
CREATE INDEX "terminal_releases_status_versionCode_idx" ON "terminal_releases"("status", "versionCode");

-- CreateIndex
CREATE INDEX "terminal_releases_uploadedById_idx" ON "terminal_releases"("uploadedById");

-- AddForeignKey
ALTER TABLE "terminal_releases" ADD CONSTRAINT "terminal_releases_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_releases" ADD CONSTRAINT "terminal_releases_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
