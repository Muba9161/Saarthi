-- CreateEnum
CREATE TYPE "OwnershipReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "vehicle_ownership_reviews" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "truckId" UUID,
    "message" TEXT NOT NULL,
    "attachmentKey" TEXT,
    "attachmentName" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentSize" INTEGER,
    "status" "OwnershipReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_ownership_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_ownership_reviews_status_createdAt_idx" ON "vehicle_ownership_reviews"("status", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_ownership_reviews_organizationId_registrationNumber_idx" ON "vehicle_ownership_reviews"("organizationId", "registrationNumber");
