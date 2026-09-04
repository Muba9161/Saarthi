-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "fuelEconomyKmpl" DOUBLE PRECISION,
ADD COLUMN     "fuelLitres" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "trucks" ADD COLUMN     "vin" TEXT;
