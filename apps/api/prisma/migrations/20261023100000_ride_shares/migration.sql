-- Share my ride: a rider in a vehicle that is not on Saarthi shares their
-- journey with family they choose, and with anyone holding the live link.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RIDE_SHARED_WITH_YOU';

-- CreateEnum
CREATE TYPE "RideShareStatus" AS ENUM ('SHARING', 'ENDED');

-- CreateTable
CREATE TABLE "ride_shares" (
    "id" UUID NOT NULL,
    "riderUserId" UUID NOT NULL,
    "registrationNumber" TEXT,
    "status" "RideShareStatus" NOT NULL DEFAULT 'SHARING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastSpeedKph" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_share_viewers" (
    "id" UUID NOT NULL,
    "rideShareId" UUID NOT NULL,
    "viewerUserId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_share_viewers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_shares_riderUserId_status_idx" ON "ride_shares"("riderUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ride_share_viewers_rideShareId_viewerUserId_key" ON "ride_share_viewers"("rideShareId", "viewerUserId");

-- CreateIndex
CREATE INDEX "ride_share_viewers_viewerUserId_idx" ON "ride_share_viewers"("viewerUserId");

-- AddForeignKey
ALTER TABLE "ride_shares" ADD CONSTRAINT "ride_shares_riderUserId_fkey" FOREIGN KEY ("riderUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_share_viewers" ADD CONSTRAINT "ride_share_viewers_rideShareId_fkey" FOREIGN KEY ("rideShareId") REFERENCES "ride_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_share_viewers" ADD CONSTRAINT "ride_share_viewers_viewerUserId_fkey" FOREIGN KEY ("viewerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
