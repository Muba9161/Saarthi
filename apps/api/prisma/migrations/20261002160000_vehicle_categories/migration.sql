-- Two-wheeler categories become vehicle categories: cars and taxis gain theirs,
-- and two-wheelers gain the electric scooter. A rename, so any two-wheeler
-- already filed keeps its category.

-- AlterEnum
ALTER TYPE "TwoWheelerType" RENAME TO "VehicleCategory";
ALTER TYPE "VehicleCategory" ADD VALUE 'ELECTRIC_SCOOTER' AFTER 'SCOOTER';
ALTER TYPE "VehicleCategory" ADD VALUE 'HATCHBACK';
ALTER TYPE "VehicleCategory" ADD VALUE 'SEDAN';
ALTER TYPE "VehicleCategory" ADD VALUE 'COMPACT_SUV';
ALTER TYPE "VehicleCategory" ADD VALUE 'SUV';
ALTER TYPE "VehicleCategory" ADD VALUE 'MUV';
ALTER TYPE "VehicleCategory" ADD VALUE 'LUXURY';

-- AlterTable
ALTER TABLE "trucks" RENAME COLUMN "twoWheelerType" TO "category";
