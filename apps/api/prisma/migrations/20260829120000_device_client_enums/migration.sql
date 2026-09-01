-- CreateEnum
CREATE TYPE "DeviceRole" AS ENUM ('TELEMETRY', 'CAMERA', 'AUXILIARY');

-- CreateEnum
CREATE TYPE "DeviceEnrolmentStatus" AS ENUM ('PENDING', 'CLAIMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DeviceCommandType" AS ENUM ('START_CAMERA', 'STOP_CAMERA', 'CHANGE_REPORTING_INTERVAL', 'REQUEST_LOCATION', 'PING', 'UPDATE_CONFIGURATION');

-- CreateEnum
CREATE TYPE "DeviceCommandStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeviceNetworkType" AS ENUM ('WIFI', 'CELLULAR', 'ETHERNET', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeviceSubsystemStatus" AS ENUM ('OK', 'DEGRADED', 'PERMISSION_DENIED', 'UNAVAILABLE', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceEventType" ADD VALUE 'ENROLLED';
ALTER TYPE "DeviceEventType" ADD VALUE 'PAIRED';
ALTER TYPE "DeviceEventType" ADD VALUE 'UNPAIRED';
ALTER TYPE "DeviceEventType" ADD VALUE 'TOKEN_ISSUED';
ALTER TYPE "DeviceEventType" ADD VALUE 'HEARTBEAT_MISSED';
ALTER TYPE "DeviceEventType" ADD VALUE 'SOS_RAISED';
ALTER TYPE "DeviceEventType" ADD VALUE 'COMMAND_ISSUED';
ALTER TYPE "DeviceEventType" ADD VALUE 'COMMAND_ACKED';

-- AlterEnum
ALTER TYPE "DeviceProvider" ADD VALUE 'MOBILE';

-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'MOBILE_TEST_DEVICE';

