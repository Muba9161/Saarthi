-- AlterTable
ALTER TABLE "device_pairing_tokens" ADD COLUMN     "driverId" UUID;

-- AlterTable
ALTER TABLE "device_assignments" ADD COLUMN     "driverId" UUID;

-- CreateIndex
CREATE INDEX "device_assignments_driverId_status_idx" ON "device_assignments"("driverId", "status");
