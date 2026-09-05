-- AlterTable
ALTER TABLE "travel_bookings" ADD COLUMN     "distanceKm" DOUBLE PRECISION,
ADD COLUMN     "dropoffAddress" TEXT,
ADD COLUMN     "dropoffLatitude" DOUBLE PRECISION,
ADD COLUMN     "dropoffLongitude" DOUBLE PRECISION;
