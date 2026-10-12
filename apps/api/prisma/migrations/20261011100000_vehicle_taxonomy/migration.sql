-- Vehicle taxonomy: kinds for three-wheelers, vans and buses, and the electric
-- motorcycle. Additive only — no existing value changes meaning.

-- AlterEnum
ALTER TYPE "VehicleCategory" ADD VALUE 'ELECTRIC_MOTORCYCLE' AFTER 'ELECTRIC_SCOOTER';
ALTER TYPE "VehicleCategory" ADD VALUE 'AUTO_RICKSHAW' AFTER 'MOPED';
ALTER TYPE "VehicleCategory" ADD VALUE 'E_RICKSHAW' AFTER 'AUTO_RICKSHAW';
ALTER TYPE "VehicleCategory" ADD VALUE 'CARGO_THREE_WHEELER' AFTER 'E_RICKSHAW';
ALTER TYPE "VehicleCategory" ADD VALUE 'PASSENGER_VAN';
ALTER TYPE "VehicleCategory" ADD VALUE 'CARGO_VAN';
ALTER TYPE "VehicleCategory" ADD VALUE 'MINI_BUS';
ALTER TYPE "VehicleCategory" ADD VALUE 'STANDARD_BUS';
ALTER TYPE "VehicleCategory" ADD VALUE 'COACH';
ALTER TYPE "VehicleCategory" ADD VALUE 'SLEEPER_BUS';
ALTER TYPE "VehicleCategory" ADD VALUE 'SCHOOL_BUS';
