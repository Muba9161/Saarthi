-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'TAXI', 'CAR', 'BUS', 'VAN', 'SUV', 'TEMPO', 'AUTO_RICKSHAW', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('FREIGHT', 'TAXI', 'TRAVEL', 'TOUR');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssociationAlertStatus" AS ENUM ('NOTIFIED', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssociationAlertEventType" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'RESPONDER_ASSIGNED', 'RESPONDER_UPDATED', 'NOTE_ADDED', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssociationResponderStatus" AS ENUM ('ASSIGNED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssociationResponderKind" AS ENUM ('MEMBER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TravelServiceKind" AS ENUM ('LOCAL_SIGHTSEEING', 'INTERCITY', 'MULTI_DAY_TOUR', 'AIRPORT_TRANSFER', 'CUSTOM_TRIP', 'PILGRIMAGE');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FIXED_PACKAGE', 'PER_PERSON', 'PER_DAY', 'PER_KM');

-- CreateEnum
CREATE TYPE "TravelPackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM ('CREATED', 'PAYMENT_INITIATED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'CONFIRMED', 'DECLINED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'TRIP_CREATED', 'STARTED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'RATED', 'NOTE');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'PROVIDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('TRAVEL_BOOKING', 'ORDER', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOCK', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH');

-- CreateEnum
CREATE TYPE "DeviceProvider" AS ENUM ('FREEMATICS', 'MOCK', 'GENERIC_GPS', 'GENERIC_OBD', 'GENERIC_CAN');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('OBD_TELEMATICS', 'GPS_TRACKER', 'CAN_LOGGER', 'J1939_LOGGER', 'DASHCAM', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('REGISTERED', 'ACTIVE', 'OFFLINE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeviceAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "DeviceEventType" AS ENUM ('REGISTERED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'ONLINE', 'OFFLINE', 'SECRET_ROTATED', 'FIRMWARE_REPORTED', 'SUSPENDED', 'REACTIVATED', 'RETIRED', 'REJECTED_PAYLOAD', 'DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "TelemetryAlertType" AS ENUM ('OVERSPEED', 'HARSH_BRAKING', 'HARSH_ACCELERATION', 'EXCESSIVE_IDLING', 'ENGINE_TEMPERATURE', 'LOW_VOLTAGE', 'DEVICE_OFFLINE', 'ROUTE_DEVIATION', 'GEOFENCE_BREACH', 'DIAGNOSTIC_FAULT', 'FUEL_DROP', 'UNUSUAL_BEHAVIOUR');

-- CreateEnum
CREATE TYPE "TelemetryAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "GeofenceKind" AS ENUM ('INCLUSION', 'EXCLUSION');

-- CreateEnum
CREATE TYPE "MockDeviceScenario" AS ENUM ('NORMAL', 'OVERSPEED', 'HARSH_DRIVING', 'OVERHEATING', 'LOW_VOLTAGE', 'FAULT_CODE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ASSOCIATION_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'ASSOCIATION_ALERT_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSOCIATION_ALERT_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REFUNDED';
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_OFFLINE';
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_ONLINE';
ALTER TYPE "NotificationType" ADD VALUE 'TELEMETRY_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'DIAGNOSTIC_FAULT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrganizationType" ADD VALUE 'TRUCK_ASSOCIATION';
ALTER TYPE "OrganizationType" ADD VALUE 'MOBILITY_PROVIDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleName" ADD VALUE 'ASSOCIATION_ADMIN';
ALTER TYPE "RoleName" ADD VALUE 'ASSOCIATION_RESPONDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScoreEventType" ADD VALUE 'EXCESSIVE_IDLING';
ALTER TYPE "ScoreEventType" ADD VALUE 'TELEMETRY_SAFE_DRIVING';

-- AlterTable
ALTER TABLE "trucks" ADD COLUMN     "airConditioned" BOOLEAN,
ADD COLUMN     "colour" TEXT,
ADD COLUMN     "passengerCapacity" INTEGER,
ADD COLUMN     "vehicleType" "VehicleType" NOT NULL DEFAULT 'TRUCK',
ALTER COLUMN "truckType" SET DEFAULT 'OTHER',
ALTER COLUMN "capacityTons" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "association_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "officialEmail" TEXT NOT NULL,
    "officialPhone" TEXT NOT NULL,
    "emergencyPhone" TEXT NOT NULL,
    "representativeName" TEXT NOT NULL,
    "representativeDesignation" TEXT,
    "representativePhone" TEXT NOT NULL,
    "representativeEmail" TEXT,
    "memberTruckCount" INTEGER,
    "about" TEXT,
    "acceptingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "alertsReceived" INTEGER NOT NULL DEFAULT 0,
    "alertsAcknowledged" INTEGER NOT NULL DEFAULT 0,
    "alertsResolved" INTEGER NOT NULL DEFAULT 0,
    "avgResponseMinutes" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_coverage_areas" (
    "id" UUID NOT NULL,
    "associationId" UUID NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "label" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_coverage_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_alerts" (
    "id" UUID NOT NULL,
    "associationId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AssociationAlertStatus" NOT NULL DEFAULT 'NOTIFIED',
    "incidentType" "SosType" NOT NULL,
    "vehicleRegistration" TEXT,
    "vehicleType" "VehicleType",
    "fleetName" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "district" TEXT,
    "state" TEXT,
    "description" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "contactPhone" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "respondingAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "outcome" TEXT,
    "assistanceProvided" BOOLEAN,
    "closedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_alert_events" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "eventType" "AssociationAlertEventType" NOT NULL,
    "description" TEXT,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "association_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_responders" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "kind" "AssociationResponderKind" NOT NULL,
    "status" "AssociationResponderStatus" NOT NULL DEFAULT 'ASSIGNED',
    "userId" UUID,
    "name" TEXT,
    "phone" TEXT,
    "organisation" TEXT,
    "etaMinutes" INTEGER,
    "note" TEXT,
    "assignedById" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enRouteAt" TIMESTAMP(3),
    "onSceneAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_responders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_provider_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "serviceTypes" "ServiceType"[],
    "about" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "whatsappPhone" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "businessRegistrationNumber" TEXT,
    "yearsInBusiness" INTEGER,
    "languages" TEXT[],
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "bookingsTotal" INTEGER NOT NULL DEFAULT 0,
    "bookingsCompleted" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_service_areas" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_packages" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "serviceKind" "TravelServiceKind" NOT NULL,
    "imageUrls" TEXT[],
    "destinations" TEXT[],
    "startLocation" TEXT NOT NULL,
    "startLatitude" DOUBLE PRECISION NOT NULL,
    "startLongitude" DOUBLE PRECISION NOT NULL,
    "endLocation" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "durationNights" INTEGER,
    "approxDistanceKm" DOUBLE PRECISION,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleId" UUID,
    "minPassengers" INTEGER NOT NULL DEFAULT 1,
    "maxPassengers" INTEGER NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "inclusions" TEXT[],
    "exclusions" TEXT[],
    "cancellationPolicy" JSONB,
    "advanceBookingDays" INTEGER NOT NULL DEFAULT 1,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "availableWeekdays" INTEGER[],
    "driverIncluded" BOOLEAN NOT NULL DEFAULT true,
    "fuelIncluded" BOOLEAN NOT NULL DEFAULT true,
    "status" "TravelPackageStatus" NOT NULL DEFAULT 'DRAFT',
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_itinerary_days" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "highlights" TEXT[],
    "overnightAt" TEXT,
    "approxDistanceKm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_itinerary_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_bookings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "packageId" UUID NOT NULL,
    "providerOrganizationId" UUID NOT NULL,
    "customerOrganizationId" UUID NOT NULL,
    "customerId" UUID,
    "bookedByUserId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "passengers" INTEGER NOT NULL,
    "pickupAddress" TEXT,
    "pickupLatitude" DOUBLE PRECISION,
    "pickupLongitude" DOUBLE PRECISION,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "specialRequests" TEXT,
    "pricingModel" "PricingModel" NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "priceBreakdown" TEXT,
    "vehicleId" UUID,
    "driverId" UUID,
    "tripId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "CancelledBy",
    "cancellationReason" TEXT,
    "refundAmount" DECIMAL(12,2),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_booking_events" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "eventType" "BookingEventType" NOT NULL,
    "description" TEXT,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_reviews" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "providerOrganizationId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "vehicleRating" INTEGER,
    "driverRating" INTEGER,
    "comment" TEXT,
    "ratedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL DEFAULT 'MOCK',
    "organizationId" UUID NOT NULL,
    "initiatedByUserId" UUID NOT NULL,
    "bookingId" UUID,
    "orderId" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardware_devices" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceIdentifier" TEXT NOT NULL,
    "provider" "DeviceProvider" NOT NULL,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'OBD_TELEMATICS',
    "serialNumber" TEXT NOT NULL,
    "imei" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "firmwareVersion" TEXT,
    "simIccid" TEXT,
    "simMsisdn" TEXT,
    "simOperator" TEXT,
    "secretHash" TEXT NOT NULL,
    "secretRotatedAt" TIMESTAMP(3),
    "lastSequence" INTEGER,
    "status" "DeviceStatus" NOT NULL DEFAULT 'REGISTERED',
    "supportedMetrics" TEXT[],
    "observedMetrics" TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "lastTelemetryAt" TIMESTAMP(3),
    "readingCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "installedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardware_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "DeviceAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedById" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedAt" TIMESTAMP(3),
    "unassignedAt" TIMESTAMP(3),
    "unassignedById" UUID,
    "note" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_events" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventType" "DeviceEventType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_readings" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "driverId" UUID,
    "tripId" UUID,
    "metrics" TEXT[],
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speedKph" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "satellites" INTEGER,
    "rpm" DOUBLE PRECISION,
    "engineLoad" DOUBLE PRECISION,
    "coolantTemperature" DOUBLE PRECISION,
    "intakeTemperature" DOUBLE PRECISION,
    "fuelLevel" DOUBLE PRECISION,
    "fuelRate" DOUBLE PRECISION,
    "throttlePosition" DOUBLE PRECISION,
    "batteryVoltage" DOUBLE PRECISION,
    "odometerKm" DOUBLE PRECISION,
    "vin" TEXT,
    "accelerationX" DOUBLE PRECISION,
    "accelerationY" DOUBLE PRECISION,
    "accelerationZ" DOUBLE PRECISION,
    "harshBraking" BOOLEAN NOT NULL DEFAULT false,
    "harshAcceleration" BOOLEAN NOT NULL DEFAULT false,
    "suddenMovement" BOOLEAN NOT NULL DEFAULT false,
    "deviceTemperature" DOUBLE PRECISION,
    "signalStrength" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER,
    "rawPayload" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_diagnostic_codes" (
    "id" UUID NOT NULL,
    "readingId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_diagnostic_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_alerts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "deviceId" UUID,
    "driverId" UUID,
    "tripId" UUID,
    "readingId" UUID,
    "type" "TelemetryAlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "TelemetryAlertStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "unit" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "note" TEXT,
    "scoreEventId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telemetry_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_alert_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID,
    "type" "TelemetryAlertType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" DOUBLE PRECISION,
    "severity" "AlertSeverity",
    "cooldownSeconds" INTEGER,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telemetry_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID,
    "name" TEXT NOT NULL,
    "kind" "GeofenceKind" NOT NULL DEFAULT 'INCLUSION',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_device_runs" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'IDLE',
    "scenario" "MockDeviceScenario" NOT NULL DEFAULT 'NORMAL',
    "intervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "maxReadings" INTEGER,
    "readingsSent" INTEGER NOT NULL DEFAULT 0,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastSpeedKph" DOUBLE PRECISION,
    "lastFuelLevel" DOUBLE PRECISION,
    "lastOdometerKm" DOUBLE PRECISION,
    "startedById" UUID,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_device_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "association_profiles_organizationId_key" ON "association_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "association_profiles_state_district_idx" ON "association_profiles"("state", "district");

-- CreateIndex
CREATE INDEX "association_profiles_acceptingAlerts_idx" ON "association_profiles"("acceptingAlerts");

-- CreateIndex
CREATE INDEX "association_coverage_areas_associationId_idx" ON "association_coverage_areas"("associationId");

-- CreateIndex
CREATE INDEX "association_coverage_areas_state_district_idx" ON "association_coverage_areas"("state", "district");

-- CreateIndex
CREATE INDEX "association_coverage_areas_latitude_longitude_idx" ON "association_coverage_areas"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "association_alerts_reference_key" ON "association_alerts"("reference");

-- CreateIndex
CREATE INDEX "association_alerts_associationId_status_notifiedAt_idx" ON "association_alerts"("associationId", "status", "notifiedAt");

-- CreateIndex
CREATE INDEX "association_alerts_incidentId_idx" ON "association_alerts"("incidentId");

-- CreateIndex
CREATE INDEX "association_alerts_status_severity_notifiedAt_idx" ON "association_alerts"("status", "severity", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "association_alerts_associationId_incidentId_key" ON "association_alerts"("associationId", "incidentId");

-- CreateIndex
CREATE INDEX "association_alert_events_alertId_createdAt_idx" ON "association_alert_events"("alertId", "createdAt");

-- CreateIndex
CREATE INDEX "association_responders_alertId_status_idx" ON "association_responders"("alertId", "status");

-- CreateIndex
CREATE INDEX "association_responders_userId_idx" ON "association_responders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "service_provider_profiles_organizationId_key" ON "service_provider_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "service_provider_profiles_status_idx" ON "service_provider_profiles"("status");

-- CreateIndex
CREATE INDEX "service_provider_profiles_ratingAverage_idx" ON "service_provider_profiles"("ratingAverage");

-- CreateIndex
CREATE INDEX "provider_service_areas_providerId_idx" ON "provider_service_areas"("providerId");

-- CreateIndex
CREATE INDEX "provider_service_areas_city_state_idx" ON "provider_service_areas"("city", "state");

-- CreateIndex
CREATE INDEX "provider_service_areas_latitude_longitude_idx" ON "provider_service_areas"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "travel_packages_status_serviceKind_idx" ON "travel_packages"("status", "serviceKind");

-- CreateIndex
CREATE INDEX "travel_packages_organizationId_status_idx" ON "travel_packages"("organizationId", "status");

-- CreateIndex
CREATE INDEX "travel_packages_providerId_status_idx" ON "travel_packages"("providerId", "status");

-- CreateIndex
CREATE INDEX "travel_packages_vehicleType_maxPassengers_idx" ON "travel_packages"("vehicleType", "maxPassengers");

-- CreateIndex
CREATE INDEX "travel_packages_basePrice_idx" ON "travel_packages"("basePrice");

-- CreateIndex
CREATE INDEX "travel_packages_ratingAverage_idx" ON "travel_packages"("ratingAverage");

-- CreateIndex
CREATE INDEX "travel_itinerary_days_packageId_idx" ON "travel_itinerary_days"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_itinerary_days_packageId_dayNumber_key" ON "travel_itinerary_days"("packageId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_reference_key" ON "travel_bookings"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_tripId_key" ON "travel_bookings"("tripId");

-- CreateIndex
CREATE INDEX "travel_bookings_customerOrganizationId_status_startDate_idx" ON "travel_bookings"("customerOrganizationId", "status", "startDate");

-- CreateIndex
CREATE INDEX "travel_bookings_providerOrganizationId_status_startDate_idx" ON "travel_bookings"("providerOrganizationId", "status", "startDate");

-- CreateIndex
CREATE INDEX "travel_bookings_packageId_startDate_idx" ON "travel_bookings"("packageId", "startDate");

-- CreateIndex
CREATE INDEX "travel_bookings_status_startDate_idx" ON "travel_bookings"("status", "startDate");

-- CreateIndex
CREATE INDEX "travel_bookings_driverId_idx" ON "travel_bookings"("driverId");

-- CreateIndex
CREATE INDEX "travel_booking_events_bookingId_createdAt_idx" ON "travel_booking_events"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_reviews_bookingId_key" ON "travel_reviews"("bookingId");

-- CreateIndex
CREATE INDEX "travel_reviews_providerOrganizationId_createdAt_idx" ON "travel_reviews"("providerOrganizationId", "createdAt");

-- CreateIndex
CREATE INDEX "travel_reviews_packageId_idx" ON "travel_reviews"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_organizationId_createdAt_idx" ON "payments"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_devices_deviceIdentifier_key" ON "hardware_devices"("deviceIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_devices_imei_key" ON "hardware_devices"("imei");

-- CreateIndex
CREATE INDEX "hardware_devices_organizationId_status_idx" ON "hardware_devices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "hardware_devices_provider_status_idx" ON "hardware_devices"("provider", "status");

-- CreateIndex
CREATE INDEX "hardware_devices_lastSeenAt_idx" ON "hardware_devices"("lastSeenAt");

-- CreateIndex
CREATE INDEX "hardware_devices_organizationId_archivedAt_idx" ON "hardware_devices"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "device_assignments_deviceId_status_idx" ON "device_assignments"("deviceId", "status");

-- CreateIndex
CREATE INDEX "device_assignments_vehicleId_status_idx" ON "device_assignments"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "device_assignments_organizationId_assignedAt_idx" ON "device_assignments"("organizationId", "assignedAt");

-- CreateIndex
CREATE INDEX "device_events_deviceId_createdAt_idx" ON "device_events"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_events_organizationId_createdAt_idx" ON "device_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "telemetry_readings_vehicleId_recordedAt_idx" ON "telemetry_readings"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "telemetry_readings_deviceId_recordedAt_idx" ON "telemetry_readings"("deviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "telemetry_readings_organizationId_recordedAt_idx" ON "telemetry_readings"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "telemetry_readings_tripId_recordedAt_idx" ON "telemetry_readings"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "telemetry_readings_driverId_recordedAt_idx" ON "telemetry_readings"("driverId", "recordedAt");

-- CreateIndex
CREATE INDEX "telemetry_diagnostic_codes_vehicleId_createdAt_idx" ON "telemetry_diagnostic_codes"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "telemetry_diagnostic_codes_organizationId_code_idx" ON "telemetry_diagnostic_codes"("organizationId", "code");

-- CreateIndex
CREATE INDEX "telemetry_alerts_organizationId_status_occurredAt_idx" ON "telemetry_alerts"("organizationId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "telemetry_alerts_vehicleId_occurredAt_idx" ON "telemetry_alerts"("vehicleId", "occurredAt");

-- CreateIndex
CREATE INDEX "telemetry_alerts_driverId_type_occurredAt_idx" ON "telemetry_alerts"("driverId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "telemetry_alerts_type_severity_occurredAt_idx" ON "telemetry_alerts"("type", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "telemetry_alert_rules_organizationId_enabled_idx" ON "telemetry_alert_rules"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_alert_rules_organizationId_vehicleId_type_key" ON "telemetry_alert_rules"("organizationId", "vehicleId", "type");

-- CreateIndex
CREATE INDEX "geofences_organizationId_enabled_idx" ON "geofences"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "geofences_vehicleId_idx" ON "geofences"("vehicleId");

-- CreateIndex
CREATE INDEX "mock_device_runs_deviceId_status_idx" ON "mock_device_runs"("deviceId", "status");

-- CreateIndex
CREATE INDEX "mock_device_runs_status_idx" ON "mock_device_runs"("status");

-- CreateIndex
CREATE INDEX "trucks_organizationId_vehicleType_idx" ON "trucks"("organizationId", "vehicleType");

-- AddForeignKey
ALTER TABLE "association_profiles" ADD CONSTRAINT "association_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_coverage_areas" ADD CONSTRAINT "association_coverage_areas_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "association_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_alerts" ADD CONSTRAINT "association_alerts_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "association_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_alerts" ADD CONSTRAINT "association_alerts_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "sos_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_alert_events" ADD CONSTRAINT "association_alert_events_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "association_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_responders" ADD CONSTRAINT "association_responders_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "association_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_provider_profiles" ADD CONSTRAINT "service_provider_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "service_provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "service_provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_itinerary_days" ADD CONSTRAINT "travel_itinerary_days_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "travel_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "travel_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_events" ADD CONSTRAINT "travel_booking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_reviews" ADD CONSTRAINT "travel_reviews_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_diagnostic_codes" ADD CONSTRAINT "telemetry_diagnostic_codes_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "telemetry_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_alerts" ADD CONSTRAINT "telemetry_alerts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_alerts" ADD CONSTRAINT "telemetry_alerts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_device_runs" ADD CONSTRAINT "mock_device_runs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
