-- CreateTable
CREATE TABLE "licence_lookups" (
    "id" UUID NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "driverId" UUID,
    "organizationId" UUID,
    "requestedById" UUID,
    "provider" TEXT NOT NULL DEFAULT 'way2api',
    "providerReference" TEXT,
    "responseData" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licence_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "licence_lookups_licenceNumber_expiresAt_idx" ON "licence_lookups"("licenceNumber", "expiresAt");

-- CreateIndex
CREATE INDEX "licence_lookups_organizationId_createdAt_idx" ON "licence_lookups"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "licence_lookups_driverId_idx" ON "licence_lookups"("driverId");

-- CreateIndex
CREATE INDEX "licence_lookups_fetchedAt_idx" ON "licence_lookups"("fetchedAt");
