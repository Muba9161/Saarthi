-- CreateEnum
CREATE TYPE "CameraPosition" AS ENUM ('FRONT', 'CABIN', 'LEFT', 'RIGHT', 'REAR', 'CARGO', 'OTHER');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE', 'DISABLED', 'FAULT');

-- CreateEnum
CREATE TYPE "StreamSessionStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'ENDED', 'DENIED', 'FAILED');

-- AlterEnum
ALTER TYPE "DeviceProvider" ADD VALUE 'YC06';

-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'MULTI_CAMERA';

-- CreateTable
CREATE TABLE "device_cameras" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channel" INTEGER NOT NULL,
    "position" "CameraPosition" NOT NULL DEFAULT 'OTHER',
    "label" TEXT,
    "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "continuousRecording" BOOLEAN NOT NULL DEFAULT true,
    "resolution" TEXT,
    "frameRate" INTEGER,
    "lastFrameAt" TIMESTAMP(3),
    "lastThumbnailUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_stream_sessions" (
    "id" UUID NOT NULL,
    "cameraId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID,
    "requestedById" UUID NOT NULL,
    "status" "StreamSessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_stream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_cameras_organizationId_status_idx" ON "device_cameras"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "device_cameras_deviceId_channel_key" ON "device_cameras"("deviceId", "channel");

-- CreateIndex
CREATE INDEX "video_stream_sessions_organizationId_createdAt_idx" ON "video_stream_sessions"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "video_stream_sessions_cameraId_createdAt_idx" ON "video_stream_sessions"("cameraId", "createdAt");

-- CreateIndex
CREATE INDEX "video_stream_sessions_requestedById_createdAt_idx" ON "video_stream_sessions"("requestedById", "createdAt");

-- AddForeignKey
ALTER TABLE "device_cameras" ADD CONSTRAINT "device_cameras_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_stream_sessions" ADD CONSTRAINT "video_stream_sessions_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "device_cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
