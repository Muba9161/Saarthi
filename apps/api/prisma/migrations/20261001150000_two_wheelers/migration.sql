-- Two-wheelers — a vehicle type of their own, with the kind recorded beside it.

-- AlterEnum
ALTER TYPE "VehicleType" ADD VALUE 'TWO_WHEELER';

-- CreateEnum
CREATE TYPE "TwoWheelerType" AS ENUM ('SCOOTER', 'MOTORCYCLE', 'SPORTS_BIKE', 'CRUISER', 'ADVENTURE', 'MOPED');

-- AlterTable
ALTER TABLE "trucks" ADD COLUMN     "twoWheelerType" "TwoWheelerType";
