-- The road a rider has covered while sharing, for the live trail. Deleted when the share ends.

-- CreateTable
CREATE TABLE "ride_share_points" (
    "id" UUID NOT NULL,
    "rideShareId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_share_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ride_share_points_rideShareId_recordedAt_key" ON "ride_share_points"("rideShareId", "recordedAt");

-- AddForeignKey
ALTER TABLE "ride_share_points" ADD CONSTRAINT "ride_share_points_rideShareId_fkey" FOREIGN KEY ("rideShareId") REFERENCES "ride_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

