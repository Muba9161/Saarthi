-- Saarthi Terminal — enum additions.
--
-- Split from the table migration on purpose. PostgreSQL will not let a value
-- added by ALTER TYPE ... ADD VALUE be used inside the same transaction, and
-- Prisma runs one migration per transaction — so the types have to be
-- committed before anything can reference them. The same split is why
-- 20260829120000_device_client_enums exists.

-- CreateEnum
CREATE TYPE "TerminalSessionStatus" AS ENUM ('DRIVER_IDENTIFIED', 'SELFIE_SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'TRIP_ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TerminalSessionEventType" AS ENUM ('REQUESTED', 'SELFIE_SUBMITTED', 'SUBMITTED_FOR_APPROVAL', 'REMINDER_SENT', 'ESCALATED', 'APPROVED', 'REJECTED', 'CHECKLIST_SUBMITTED', 'TRIP_STARTED', 'TRIP_COMPLETED', 'CANCELLED', 'EXPIRED', 'NOTE');

-- CreateEnum
CREATE TYPE "TerminalChecklistItemKind" AS ENUM ('MANUAL', 'TELEMETRY', 'MAINTENANCE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "TerminalChecklistItemStatus" AS ENUM ('OK', 'ATTENTION', 'CRITICAL', 'UNAVAILABLE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TerminalChecklistOutcome" AS ENUM ('PASSED', 'PASSED_WITH_WARNINGS', 'FAILED');

-- CreateEnum
CREATE TYPE "TerminalIssueCategory" AS ENUM ('ENGINE', 'TYRE', 'BRAKE', 'ELECTRICAL', 'ACCIDENT', 'BODY', 'OTHER');

-- CreateEnum
CREATE TYPE "TerminalIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'VEHICLE_TERMINAL';

-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'DRIVER_VERIFICATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_REQUEST_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_REQUEST_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_DRIVER_REQUEST_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_CHECKLIST_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'TERMINAL_ISSUE_REPORTED';
