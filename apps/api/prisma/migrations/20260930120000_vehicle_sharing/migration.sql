-- Vehicle sharing: one account's vehicle, tracked and used from another's.
-- The plan feature that gates it is reference data, synced by `npm run db:seed`.

-- CreateEnum
CREATE TYPE "VehicleShareStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'REVOKED');

-- CreateTable
CREATE TABLE "vehicle_shares" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "ownerOrganizationId" UUID NOT NULL,
    "sharedWithUserId" UUID NOT NULL,
    "invitedById" UUID NOT NULL,
    "status" "VehicleShareStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_shares_sharedWithUserId_status_idx" ON "vehicle_shares"("sharedWithUserId", "status");

-- CreateIndex
CREATE INDEX "vehicle_shares_vehicleId_status_idx" ON "vehicle_shares"("vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_shares_vehicleId_sharedWithUserId_key" ON "vehicle_shares"("vehicleId", "sharedWithUserId");

-- AddForeignKey
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
