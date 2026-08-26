-- CreateTable
CREATE TABLE "qr_privacy_policies" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "allowPublicScans" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_privacy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_privacy_policies_organizationId_key" ON "qr_privacy_policies"("organizationId");
