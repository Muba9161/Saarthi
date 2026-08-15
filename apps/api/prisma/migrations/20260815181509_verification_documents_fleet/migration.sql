-- CreateEnum
CREATE TYPE "VerificationSubjectType" AS ENUM ('USER', 'DRIVER', 'TRUCK', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('USER', 'DRIVER', 'TRUCK', 'ORGANIZATION', 'ORDER', 'TRIP');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'ON_TRIP', 'LOADING', 'UNLOADING', 'IDLE', 'MAINTENANCE', 'OFFLINE', 'EMERGENCY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TruckType" AS ENUM ('OPEN_BODY', 'CLOSED_CONTAINER', 'TIPPER', 'TRAILER', 'TANKER', 'FLATBED', 'REFRIGERATED', 'MINI_TRUCK', 'MULTI_AXLE', 'OTHER');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'CNG', 'LNG', 'ELECTRIC', 'HYBRID');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'ON_LEAVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TrackingSource" AS ENUM ('MOCK', 'DEVICE', 'PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScoreCategory" AS ENUM ('SAFETY', 'RELIABILITY', 'TIMELINESS', 'COMPLIANCE', 'VEHICLE_CARE');

-- CreateEnum
CREATE TYPE "ScoreEventType" AS ENUM ('TRIP_COMPLETED_ON_TIME', 'TRIP_COMPLETED_LATE', 'TRIP_CANCELLED_BY_DRIVER', 'SPEED_VIOLATION', 'HARSH_BRAKING', 'HARSH_ACCELERATION', 'ROUTE_DEVIATION', 'DOCUMENT_EXPIRED', 'DOCUMENT_RENEWED', 'CUSTOMER_POSITIVE_RATING', 'CUSTOMER_NEGATIVE_RATING', 'INCIDENT', 'MAINTENANCE_REPORTED', 'MAINTENANCE_NEGLECTED', 'SOS_ASSISTANCE_PROVIDED', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AchievementCode" AS ENUM ('SAFE_DRIVER', 'ON_TIME_CHAMPION', 'CENTURY_TRIPS', 'ZERO_INCIDENT_STREAK', 'DOCUMENT_PERFECT', 'FUEL_EFFICIENT', 'CUSTOMER_FAVOURITE', 'EMERGENCY_HELPER', 'FIRST_TRIP', 'LONG_HAULER');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'REPAIR', 'INSPECTION', 'TYRE', 'OIL_CHANGE', 'BRAKE', 'ENGINE', 'ELECTRICAL', 'BODYWORK', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL,
    "subjectType" "VerificationSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "organizationId" UUID,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL,
    "verificationCaseId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_events" (
    "id" UUID NOT NULL,
    "verificationCaseId" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "organizationId" UUID,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT,
    "title" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "rejectionReason" TEXT,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "uploadedById" UUID NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploadedById" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseExpiryDate" TIMESTAMP(3),
    "licenseClass" TEXT,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "dateOfBirth" TIMESTAMP(3),
    "bloodGroup" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "currentTruckId" UUID,
    "overallScore" INTEGER,
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "totalDistanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_scores" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "safetyScore" INTEGER NOT NULL,
    "reliabilityScore" INTEGER NOT NULL,
    "timelinessScore" INTEGER NOT NULL,
    "complianceScore" INTEGER NOT NULL,
    "vehicleCareScore" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_score_events" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "eventType" "ScoreEventType" NOT NULL,
    "category" "ScoreCategory" NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" UUID,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_achievements" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "code" "AchievementCode" NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "driver_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trucks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "truckType" "TruckType" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "capacityTons" DOUBLE PRECISION NOT NULL,
    "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "fuelEfficiency" DOUBLE PRECISION,
    "odometerKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TruckStatus" NOT NULL DEFAULT 'AVAILABLE',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "currentDriverId" UUID,
    "currentTripId" UUID,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastSpeedKph" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "shareLocation" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trucks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_assignments" (
    "id" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedById" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "truck_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_locations" (
    "id" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tripId" UUID,
    "driverId" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heading" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "source" "TrackingSource" NOT NULL DEFAULT 'MOCK',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truck_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_events" (
    "id" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truck_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "odometerKm" DOUBLE PRECISION,
    "cost" DECIMAL(12,2),
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "serviceProvider" TEXT,
    "nextDueOdometerKm" DOUBLE PRECISION,
    "nextDueAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_records" (
    "id" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tripId" UUID,
    "driverId" UUID,
    "quantityLitres" DOUBLE PRECISION NOT NULL,
    "pricePerUnit" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "odometerKm" DOUBLE PRECISION,
    "stationName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_cases_status_createdAt_idx" ON "verification_cases"("status", "createdAt");

-- CreateIndex
CREATE INDEX "verification_cases_organizationId_status_idx" ON "verification_cases"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_cases_subjectType_subjectId_key" ON "verification_cases"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "verification_documents_documentId_idx" ON "verification_documents"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_documents_verificationCaseId_documentId_key" ON "verification_documents"("verificationCaseId", "documentId");

-- CreateIndex
CREATE INDEX "verification_events_verificationCaseId_createdAt_idx" ON "verification_events"("verificationCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_ownerType_ownerId_deletedAt_idx" ON "documents"("ownerType", "ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "documents_organizationId_verificationStatus_idx" ON "documents"("organizationId", "verificationStatus");

-- CreateIndex
CREATE INDEX "documents_expiryDate_idx" ON "documents"("expiryDate");

-- CreateIndex
CREATE INDEX "documents_documentType_idx" ON "documents"("documentType");

-- CreateIndex
CREATE INDEX "document_versions_documentId_createdAt_idx" ON "document_versions"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

-- CreateIndex
CREATE INDEX "drivers_organizationId_availability_idx" ON "drivers"("organizationId", "availability");

-- CreateIndex
CREATE INDEX "drivers_organizationId_verificationStatus_idx" ON "drivers"("organizationId", "verificationStatus");

-- CreateIndex
CREATE INDEX "drivers_currentTruckId_idx" ON "drivers"("currentTruckId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_organizationId_licenseNumber_key" ON "drivers"("organizationId", "licenseNumber");

-- CreateIndex
CREATE INDEX "driver_scores_driverId_calculatedAt_idx" ON "driver_scores"("driverId", "calculatedAt");

-- CreateIndex
CREATE INDEX "driver_score_events_driverId_createdAt_idx" ON "driver_score_events"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "driver_score_events_eventType_idx" ON "driver_score_events"("eventType");

-- CreateIndex
CREATE INDEX "driver_achievements_driverId_idx" ON "driver_achievements"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_achievements_driverId_code_key" ON "driver_achievements"("driverId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "trucks_registrationNumber_key" ON "trucks"("registrationNumber");

-- CreateIndex
CREATE INDEX "trucks_organizationId_status_idx" ON "trucks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "trucks_organizationId_archivedAt_idx" ON "trucks"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "trucks_currentDriverId_idx" ON "trucks"("currentDriverId");

-- CreateIndex
CREATE INDEX "trucks_lastLocationAt_idx" ON "trucks"("lastLocationAt");

-- CreateIndex
CREATE INDEX "trucks_lastLatitude_lastLongitude_idx" ON "trucks"("lastLatitude", "lastLongitude");

-- CreateIndex
CREATE INDEX "truck_assignments_truckId_status_idx" ON "truck_assignments"("truckId", "status");

-- CreateIndex
CREATE INDEX "truck_assignments_driverId_status_idx" ON "truck_assignments"("driverId", "status");

-- CreateIndex
CREATE INDEX "truck_assignments_organizationId_assignedAt_idx" ON "truck_assignments"("organizationId", "assignedAt");

-- CreateIndex
CREATE INDEX "truck_locations_truckId_recordedAt_idx" ON "truck_locations"("truckId", "recordedAt");

-- CreateIndex
CREATE INDEX "truck_locations_tripId_recordedAt_idx" ON "truck_locations"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "truck_locations_organizationId_recordedAt_idx" ON "truck_locations"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "truck_events_truckId_createdAt_idx" ON "truck_events"("truckId", "createdAt");

-- CreateIndex
CREATE INDEX "truck_events_organizationId_createdAt_idx" ON "truck_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "maintenance_records_truckId_status_idx" ON "maintenance_records"("truckId", "status");

-- CreateIndex
CREATE INDEX "maintenance_records_organizationId_status_scheduledAt_idx" ON "maintenance_records"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "maintenance_records_nextDueAt_idx" ON "maintenance_records"("nextDueAt");

-- CreateIndex
CREATE INDEX "fuel_records_truckId_recordedAt_idx" ON "fuel_records"("truckId", "recordedAt");

-- CreateIndex
CREATE INDEX "fuel_records_organizationId_recordedAt_idx" ON "fuel_records"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "fuel_records_tripId_idx" ON "fuel_records"("tripId");

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_verificationCaseId_fkey" FOREIGN KEY ("verificationCaseId") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_verificationCaseId_fkey" FOREIGN KEY ("verificationCaseId") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_score_events" ADD CONSTRAINT "driver_score_events_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_achievements" ADD CONSTRAINT "driver_achievements_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_locations" ADD CONSTRAINT "truck_locations_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_events" ADD CONSTRAINT "truck_events_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_records" ADD CONSTRAINT "fuel_records_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
