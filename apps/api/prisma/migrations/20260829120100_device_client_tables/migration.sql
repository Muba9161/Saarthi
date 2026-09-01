-- AlterTable
ALTER TABLE "hardware_devices" ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "batteryCharging" BOOLEAN,
ADD COLUMN     "batteryPercent" INTEGER,
ADD COLUMN     "bufferedEvents" INTEGER,
ADD COLUMN     "cameraStatus" "DeviceSubsystemStatus",
ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "gpsStatus" "DeviceSubsystemStatus",
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "networkType" "DeviceNetworkType",
ADD COLUMN     "osVersion" TEXT,
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "reportingIntervalSeconds" INTEGER,
ADD COLUMN     "role" "DeviceRole" NOT NULL DEFAULT 'TELEMETRY',
ADD COLUMN     "selfEnrolled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sos_incidents" ADD COLUMN     "triggeredByDeviceId" UUID,
ALTER COLUMN "triggeredByUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "telemetry_readings" ADD COLUMN     "clientEventId" TEXT;

-- CreateTable
CREATE TABLE "device_enrolments" (
    "id" UUID NOT NULL,
    "installationId" TEXT NOT NULL,
    "deviceIdentifier" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'MOBILE_TEST_DEVICE',
    "platform" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "status" "DeviceEnrolmentStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "deviceId" UUID,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_pairing_tokens" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'MOBILE_TEST_DEVICE',
    "createdById" UUID NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByDeviceId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairing_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "DeviceCommandType" NOT NULL,
    "payload" JSONB,
    "status" "DeviceCommandStatus" NOT NULL DEFAULT 'PENDING',
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_enrolments_installationId_key" ON "device_enrolments"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "device_enrolments_deviceIdentifier_key" ON "device_enrolments"("deviceIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "device_enrolments_deviceId_key" ON "device_enrolments"("deviceId");

-- CreateIndex
CREATE INDEX "device_enrolments_status_expiresAt_idx" ON "device_enrolments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_tokens_tokenHash_key" ON "device_pairing_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "device_pairing_tokens_vehicleId_expiresAt_idx" ON "device_pairing_tokens"("vehicleId", "expiresAt");

-- CreateIndex
CREATE INDEX "device_pairing_tokens_organizationId_createdAt_idx" ON "device_pairing_tokens"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "device_commands_deviceId_status_issuedAt_idx" ON "device_commands"("deviceId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "device_commands_organizationId_issuedAt_idx" ON "device_commands"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "device_commands_status_expiresAt_idx" ON "device_commands"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "sos_incidents_triggeredByDeviceId_idx" ON "sos_incidents"("triggeredByDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_readings_deviceId_clientEventId_key" ON "telemetry_readings"("deviceId", "clientEventId");

-- AddForeignKey
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_triggeredByDeviceId_fkey" FOREIGN KEY ("triggeredByDeviceId") REFERENCES "hardware_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrolments" ADD CONSTRAINT "device_enrolments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_pairing_tokens" ADD CONSTRAINT "device_pairing_tokens_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_pairing_tokens" ADD CONSTRAINT "device_pairing_tokens_consumedByDeviceId_fkey" FOREIGN KEY ("consumedByDeviceId") REFERENCES "hardware_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

