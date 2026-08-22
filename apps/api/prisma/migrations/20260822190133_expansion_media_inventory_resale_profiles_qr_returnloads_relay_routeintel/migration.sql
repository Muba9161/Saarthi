-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('USER', 'ORGANIZATION', 'DRIVER', 'VEHICLE', 'MATERIAL', 'INVENTORY_LOCATION', 'ORDER', 'TRIP', 'SOS_INCIDENT', 'MAINTENANCE_RECORD', 'FUEL_RECORD', 'VEHICLE_LISTING', 'TRAVEL_PACKAGE', 'ROUTE_HAZARD', 'RELAY_DELIVERY', 'TRANSFER_HUB', 'NEARBY_PLACE', 'PETROL_STATION', 'ASSOCIATION', 'DEVICE');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('AVATAR', 'LOGO', 'COVER', 'GALLERY', 'PRODUCT', 'VEHICLE_EXTERIOR', 'VEHICLE_INTERIOR', 'VEHICLE_DAMAGE', 'ODOMETER', 'PROOF_OF_PICKUP', 'PROOF_OF_DELIVERY', 'HANDOVER', 'INCIDENT', 'HAZARD_EVIDENCE', 'INSPECTION', 'SIGNATURE', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'PLATFORM', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MediaModerationStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryLocationKind" AS ENUM ('YARD', 'WAREHOUSE', 'DEPOT', 'QUARRY', 'PLANT', 'RETAIL_COUNTER', 'TRANSIT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'RECEIPT', 'ISSUE', 'RESERVE', 'RELEASE', 'CONSUME', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN_IN', 'DAMAGE', 'COUNT_CORRECTION');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MaterialAvailabilityMode" AS ENUM ('IN_STOCK', 'MADE_TO_ORDER', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "StockAvailabilityStatus" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'MADE_TO_ORDER', 'ON_REQUEST', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "VehicleListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RESERVED', 'SOLD', 'WITHDRAWN', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleListingVisibility" AS ENUM ('ORGANIZATION', 'ASSOCIATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "VehicleCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_REPAIR', 'NON_RUNNING');

-- CreateEnum
CREATE TYPE "VehicleOfferStatus" AS ENUM ('OFFERED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleInspectionStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleTransferStatus" AS ENUM ('PENDING', 'DOCUMENTS_PENDING', 'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleListingEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'PRICE_CHANGED', 'OFFER_RECEIVED', 'OFFER_COUNTERED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_WITHDRAWN', 'INSPECTION_REQUESTED', 'INSPECTION_COMPLETED', 'RESERVED', 'SOLD', 'WITHDRAWN', 'EXPIRED', 'TRANSFER_STARTED', 'TRANSFER_COMPLETED', 'NOTE');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PRIVATE', 'PLATFORM', 'PARTNERS');

-- CreateEnum
CREATE TYPE "QrSubjectType" AS ENUM ('DRIVER', 'VEHICLE', 'USER', 'TRIP', 'ORDER', 'VEHICLE_LISTING', 'INVENTORY_LOCATION', 'TRANSFER_HUB', 'RELAY_DELIVERY');

-- CreateEnum
CREATE TYPE "QrCodeStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QrScope" AS ENUM ('IDENTITY', 'CONTACT', 'VEHICLE_SUMMARY', 'DRIVER_SUMMARY', 'COMPLIANCE', 'ASSIGNMENT', 'TRIP_STATUS', 'ORDER_STATUS', 'EMERGENCY', 'HANDOVER');

-- CreateEnum
CREATE TYPE "QrScanResult" AS ENUM ('ALLOWED', 'DENIED', 'NOT_FOUND', 'REVOKED', 'EXPIRED', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "QrScanPurpose" AS ENUM ('IDENTITY_CHECK', 'ASSIGNMENT', 'CHECKPOINT', 'PICKUP', 'DELIVERY_HANDOVER', 'INSPECTION', 'EMERGENCY', 'PUBLIC_VIEW');

-- CreateEnum
CREATE TYPE "ReturnLoadStatus" AS ENUM ('OPEN', 'MATCHED', 'BOOKED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReturnLoadMatchStatus" AS ENUM ('SUGGESTED', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TripLegType" AS ENUM ('PRIMARY', 'RETURN', 'RELAY_LAST_MILE');

-- CreateEnum
CREATE TYPE "CityRestrictionKind" AS ENUM ('NO_ENTRY', 'TIME_WINDOW', 'PERMIT_REQUIRED', 'WEIGHT_LIMIT', 'HEIGHT_LIMIT', 'AXLE_LIMIT', 'ODD_EVEN', 'ZONE_BAN', 'CONGESTION_CHARGE');

-- CreateEnum
CREATE TYPE "RelayStatus" AS ENUM ('DRAFT', 'REQUESTED', 'OFFERED', 'ASSIGNED', 'EN_ROUTE_TO_HUB', 'AT_HUB', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RelayReason" AS ENUM ('CITY_NO_ENTRY', 'TIME_WINDOW', 'WEIGHT_LIMIT', 'HEIGHT_LIMIT', 'PERMIT_MISSING', 'NARROW_ACCESS', 'CUSTOMER_REQUEST', 'MULTI_DROP_SPLIT');

-- CreateEnum
CREATE TYPE "RelayOfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RelayEventType" AS ENUM ('CREATED', 'REQUESTED', 'OFFER_RECEIVED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'ASSIGNED', 'ARRIVED_AT_HUB', 'HANDOVER_STARTED', 'HANDOVER_VERIFIED', 'DISCREPANCY_RAISED', 'LOADED', 'DEPARTED', 'DELIVERED', 'FAILED', 'CANCELLED', 'NOTE');

-- CreateEnum
CREATE TYPE "RouteHazardKind" AS ENUM ('TRAFFIC_SIGNAL', 'SPEED_CAMERA', 'RED_LIGHT_CAMERA', 'AVERAGE_SPEED_ZONE', 'POLICE_CHECKPOINT', 'RTO_CHECKPOST', 'TOLL_PLAZA', 'WEIGHBRIDGE', 'BORDER_CHECKPOST', 'SPEED_BREAKER', 'SHARP_CURVE', 'STEEP_GRADIENT', 'ACCIDENT_PRONE_ZONE', 'SCHOOL_ZONE', 'RAILWAY_CROSSING', 'NARROW_BRIDGE', 'ROAD_WORK', 'DIVERSION', 'ACCIDENT', 'TRAFFIC_JAM', 'WATERLOGGING', 'LANDSLIDE', 'FOG_ZONE', 'PROTEST_BLOCKADE', 'ANIMAL_CROSSING', 'UNLIT_STRETCH');

-- CreateEnum
CREATE TYPE "RouteHazardTier" AS ENUM ('STATIC', 'PREDICTED', 'LIVE');

-- CreateEnum
CREATE TYPE "RouteHazardSource" AS ENUM ('PLATFORM', 'AUTHORITY', 'PARTNER_FEED', 'DRIVER_REPORT', 'ASSOCIATION', 'TELEMETRY_DERIVED');

-- CreateEnum
CREATE TYPE "RouteHazardStatus" AS ENUM ('UNVERIFIED', 'ACTIVE', 'EXPIRED', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HazardVote" AS ENUM ('CONFIRM', 'REJECT', 'CLEARED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentPurpose" ADD VALUE 'VEHICLE_PURCHASE';
ALTER TYPE "PaymentPurpose" ADD VALUE 'RELAY_DELIVERY';

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "availabilityMode" "MaterialAvailabilityMode" NOT NULL DEFAULT 'IN_STOCK',
ADD COLUMN     "availabilityStatus" "StockAvailabilityStatus" NOT NULL DEFAULT 'IN_STOCK',
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "maximumOrderQty" DOUBLE PRECISION,
ADD COLUMN     "nextRestockAt" TIMESTAMP(3),
ADD COLUMN     "onHandQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reservedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "stockTracked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "isReturnLoad" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastMileStatus" "RelayStatus",
ADD COLUMN     "parentOrderId" UUID,
ADD COLUMN     "requiresLastMile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnLoadRequestId" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "legType" "TripLegType" NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN     "parentTripId" UUID,
ADD COLUMN     "returnLoadRequestId" UUID;

-- AlterTable
ALTER TABLE "trucks" ADD COLUMN     "acceptsReturnLoads" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "axleCount" INTEGER,
ADD COLUMN     "heightMetres" DOUBLE PRECISION,
ADD COLUMN     "homeBaseAddress" TEXT,
ADD COLUMN     "homeBaseLatitude" DOUBLE PRECISION,
ADD COLUMN     "homeBaseLongitude" DOUBLE PRECISION,
ADD COLUMN     "lastMileCapable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL DEFAULT 'GALLERY',
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "thumbnailStorageKey" TEXT,
    "thumbnailWidth" INTEGER,
    "thumbnailHeight" INTEGER,
    "thumbnailFileSize" INTEGER,
    "altText" TEXT,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "moderationStatus" "MediaModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "moderationNote" TEXT,
    "uploadedById" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "InventoryLocationKind" NOT NULL DEFAULT 'YARD',
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "openFromMinutes" INTEGER,
    "openToMinutes" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "onHandQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incomingQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderLevel" DOUBLE PRECISION,
    "reorderQuantity" DOUBLE PRECISION,
    "binReference" TEXT,
    "lastCountedAt" TIMESTAMP(3),
    "lastMovementAt" TIMESTAMP(3),
    "nextRestockAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "onHandAfter" DOUBLE PRECISION NOT NULL,
    "reservedAfter" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" UUID,
    "unitCost" DECIMAL(12,2),
    "reason" TEXT,
    "note" TEXT,
    "actorUserId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "orderId" UUID,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_price_tiers" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "minQuantity" DOUBLE PRECISION NOT NULL,
    "pricePerUnit" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_listings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "status" "VehicleListingStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "VehicleListingVisibility" NOT NULL DEFAULT 'PLATFORM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "askingPrice" DECIMAL(12,2) NOT NULL,
    "negotiable" BOOLEAN NOT NULL DEFAULT true,
    "minimumPrice" DECIMAL(12,2),
    "condition" "VehicleCondition" NOT NULL DEFAULT 'GOOD',
    "odometerKm" DOUBLE PRECISION NOT NULL,
    "ownershipCount" INTEGER NOT NULL DEFAULT 1,
    "accidentHistory" BOOLEAN NOT NULL DEFAULT false,
    "accidentNote" TEXT,
    "majorRepairsNote" TEXT,
    "tyreConditionPercent" INTEGER,
    "engineConditionNote" TEXT,
    "insuranceValidTill" TIMESTAMP(3),
    "fitnessValidTill" TIMESTAMP(3),
    "permitType" TEXT,
    "permitValidTill" TIMESTAMP(3),
    "loanOutstanding" BOOLEAN NOT NULL DEFAULT false,
    "hypothecationNote" TEXT,
    "city" TEXT,
    "state" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "sharedEvidence" TEXT[],
    "availableFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reservedForOrganizationId" UUID,
    "soldToOrganizationId" UUID,
    "soldPrice" DECIMAL(12,2),
    "soldAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_listing_offers" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "buyerOrganizationId" UUID NOT NULL,
    "buyerUserId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "message" TEXT,
    "status" "VehicleOfferStatus" NOT NULL DEFAULT 'OFFERED',
    "counterAmount" DECIMAL(12,2),
    "counterMessage" TEXT,
    "counteredAt" TIMESTAMP(3),
    "wantsInspection" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_listing_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_inspection_requests" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "requesterOrganizationId" UUID NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "status" "VehicleInspectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "preferredAt" TIMESTAMP(3) NOT NULL,
    "alternateAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "location" TEXT,
    "contactPhone" TEXT,
    "note" TEXT,
    "reportSummary" TEXT,
    "inspectorUserId" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_inspection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_listing_events" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "type" "VehicleListingEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_listing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_listing_watches" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_listing_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_transfers" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "fromOrganizationId" UUID NOT NULL,
    "toOrganizationId" UUID NOT NULL,
    "status" "VehicleTransferStatus" NOT NULL DEFAULT 'PENDING',
    "salePrice" DECIMAL(12,2) NOT NULL,
    "rcTransferReference" TEXT,
    "paymentId" UUID,
    "paymentReference" TEXT,
    "documentsCompleteAt" TIMESTAMP(3),
    "paymentCompleteAt" TIMESTAMP(3),
    "transferredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "languages" TEXT[],
    "skills" TEXT[],
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "socialLinks" JSONB,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "preferences" JSONB,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PLATFORM',
    "fieldVisibility" JSONB,
    "publicSlug" TEXT,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "completedSections" TEXT[],
    "lastBuiltAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tagline" TEXT,
    "about" TEXT,
    "foundedYear" INTEGER,
    "employeeCount" INTEGER,
    "website" TEXT,
    "socialLinks" JSONB,
    "serviceAreas" TEXT[],
    "specialities" TEXT[],
    "certifications" TEXT[],
    "operatingHours" JSONB,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "billingContactName" TEXT,
    "billingContactPhone" TEXT,
    "billingEmail" TEXT,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PLATFORM',
    "fieldVisibility" JSONB,
    "publicSlug" TEXT,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "completedSections" TEXT[],
    "lastBuiltAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "subjectType" "QrSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "scopes" "QrScope"[],
    "label" TEXT,
    "allowPublicResolve" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revokeReason" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_scans" (
    "id" UUID NOT NULL,
    "qrCodeId" UUID NOT NULL,
    "scannedByUserId" UUID,
    "scannedByOrganizationId" UUID,
    "purpose" "QrScanPurpose" NOT NULL DEFAULT 'IDENTITY_CHECK',
    "result" "QrScanResult" NOT NULL,
    "scopesGranted" "QrScope"[],
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_load_requests" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "driverId" UUID,
    "outboundTripId" UUID,
    "status" "ReturnLoadStatus" NOT NULL DEFAULT 'OPEN',
    "originAddress" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationLatitude" DOUBLE PRECISION NOT NULL,
    "destinationLongitude" DOUBLE PRECISION NOT NULL,
    "availableFrom" TIMESTAMP(3) NOT NULL,
    "availableUntil" TIMESTAMP(3) NOT NULL,
    "capacityTons" DOUBLE PRECISION NOT NULL,
    "truckType" "TruckType",
    "detourToleranceKm" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "acceptsPartialLoad" BOOLEAN NOT NULL DEFAULT true,
    "minimumPrice" DECIMAL(12,2),
    "autoMatch" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "matchedOrderId" UUID,
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_load_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_load_matches" (
    "id" UUID NOT NULL,
    "returnLoadRequestId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "ReturnLoadMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "score" DOUBLE PRECISION NOT NULL,
    "distanceToPickupKm" DOUBLE PRECISION NOT NULL,
    "detourKm" DOUBLE PRECISION NOT NULL,
    "directionAlignment" DOUBLE PRECISION NOT NULL,
    "capacityFitPercent" DOUBLE PRECISION NOT NULL,
    "timingFitHours" DOUBLE PRECISION NOT NULL,
    "estimatedRevenue" DECIMAL(12,2),
    "reasons" TEXT[],
    "quoteId" UUID,
    "notifiedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_load_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_access_restrictions" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "CityRestrictionKind" NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT NOT NULL,
    "centerLatitude" DOUBLE PRECISION NOT NULL,
    "centerLongitude" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION,
    "polygon" JSONB,
    "vehicleTypes" "VehicleType"[],
    "truckTypes" "TruckType"[],
    "minCapacityTons" DOUBLE PRECISION,
    "maxHeightMetres" DOUBLE PRECISION,
    "maxAxles" INTEGER,
    "daysOfWeek" INTEGER[],
    "startTimeMinutes" INTEGER,
    "endTimeMinutes" INTEGER,
    "permitAuthority" TEXT,
    "permitUrl" TEXT,
    "penaltyNote" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_access_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_hubs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "facilities" JSONB,
    "maxVehicleLengthMetres" DOUBLE PRECISION,
    "parkingSlots" INTEGER,
    "openFromMinutes" INTEGER,
    "openToMinutes" INTEGER,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "handlingChargePerTon" DECIMAL(10,2),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "last_mile_partners" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "serviceCities" TEXT[],
    "maxWeightTons" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "vehicleCount" INTEGER NOT NULL DEFAULT 0,
    "minimumCharge" DECIMAL(10,2) NOT NULL,
    "perKmRate" DECIMAL(10,2) NOT NULL,
    "perTonRate" DECIMAL(10,2),
    "handlesFragile" BOOLEAN NOT NULL DEFAULT false,
    "handlesRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "openFromMinutes" INTEGER,
    "openToMinutes" INTEGER,
    "averageResponseMinutes" INTEGER,
    "completedRelays" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "last_mile_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_deliveries" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentTripId" UUID,
    "transferHubId" UUID,
    "originLocationId" UUID,
    "status" "RelayStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" "RelayReason" NOT NULL,
    "restrictionId" UUID,
    "partnerOrganizationId" UUID,
    "pickupVehicleId" UUID,
    "pickupDriverId" UUID,
    "relayTripId" UUID,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "weightTons" DOUBLE PRECISION,
    "packageCount" INTEGER,
    "fragile" BOOLEAN NOT NULL DEFAULT false,
    "dropAddress" TEXT NOT NULL,
    "dropLatitude" DOUBLE PRECISION NOT NULL,
    "dropLongitude" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "price" DECIMAL(12,2),
    "handlingCharge" DECIMAL(10,2),
    "requestedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "hubArrivalAt" TIMESTAMP(3),
    "handoverAt" TIMESTAMP(3),
    "handoverQrScanId" UUID,
    "handoverPackageCount" INTEGER,
    "handoverWeightTons" DOUBLE PRECISION,
    "discrepancyNote" TEXT,
    "departedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relay_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_offers" (
    "id" UUID NOT NULL,
    "relayId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID,
    "createdById" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "etaMinutes" INTEGER NOT NULL,
    "message" TEXT,
    "status" "RelayOfferStatus" NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relay_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_events" (
    "id" UUID NOT NULL,
    "relayId" UUID NOT NULL,
    "type" "RelayEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_hazards" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "kind" "RouteHazardKind" NOT NULL,
    "tier" "RouteHazardTier" NOT NULL DEFAULT 'STATIC',
    "source" "RouteHazardSource" NOT NULL DEFAULT 'PLATFORM',
    "status" "RouteHazardStatus" NOT NULL DEFAULT 'ACTIVE',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "headingDegrees" INTEGER,
    "headingToleranceDegrees" INTEGER NOT NULL DEFAULT 60,
    "speedLimitKph" INTEGER,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "highway" TEXT,
    "landmark" TEXT,
    "signalCycleSeconds" INTEGER,
    "signalGreenSeconds" INTEGER,
    "signalOffsetSeconds" INTEGER,
    "signalReferenceAt" TIMESTAMP(3),
    "daysOfWeek" INTEGER[],
    "startTimeMinutes" INTEGER,
    "endTimeMinutes" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "confirmCount" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMP(3),
    "lastReportedAt" TIMESTAMP(3),
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "reportedByUserId" UUID,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_hazards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_hazard_reports" (
    "id" UUID NOT NULL,
    "hazardId" UUID,
    "organizationId" UUID,
    "kind" "RouteHazardKind" NOT NULL,
    "vote" "HazardVote" NOT NULL DEFAULT 'CONFIRM',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "headingDegrees" INTEGER,
    "note" TEXT,
    "mediaId" UUID,
    "tripId" UUID,
    "vehicleId" UUID,
    "driverId" UUID,
    "expectedDurationMinutes" INTEGER,
    "reportedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_hazard_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_hazard_alerts" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "hazardId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "distanceMeters" INTEGER NOT NULL,
    "speedAtAlertKph" DOUBLE PRECISION,
    "severity" "AlertSeverity" NOT NULL,
    "violated" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_hazard_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_assets_ownerType_ownerId_deletedAt_sortOrder_idx" ON "media_assets"("ownerType", "ownerId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "media_assets_organizationId_purpose_idx" ON "media_assets"("organizationId", "purpose");

-- CreateIndex
CREATE INDEX "media_assets_uploadedById_idx" ON "media_assets"("uploadedById");

-- CreateIndex
CREATE INDEX "media_assets_moderationStatus_idx" ON "media_assets"("moderationStatus");

-- CreateIndex
CREATE INDEX "inventory_locations_supplierId_active_idx" ON "inventory_locations"("supplierId", "active");

-- CreateIndex
CREATE INDEX "inventory_locations_latitude_longitude_idx" ON "inventory_locations"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_organizationId_code_key" ON "inventory_locations"("organizationId", "code");

-- CreateIndex
CREATE INDEX "stock_items_organizationId_materialId_idx" ON "stock_items"("organizationId", "materialId");

-- CreateIndex
CREATE INDEX "stock_items_locationId_idx" ON "stock_items"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_materialId_locationId_key" ON "stock_items"("materialId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_stockItemId_occurredAt_idx" ON "stock_movements"("stockItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_occurredAt_idx" ON "stock_movements"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_materialId_occurredAt_idx" ON "stock_movements"("materialId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");

-- CreateIndex
CREATE INDEX "stock_reservations_stockItemId_status_idx" ON "stock_reservations"("stockItemId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_organizationId_status_expiresAt_idx" ON "stock_reservations"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "material_price_tiers_materialId_minQuantity_key" ON "material_price_tiers"("materialId", "minQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_listings_reference_key" ON "vehicle_listings"("reference");

-- CreateIndex
CREATE INDEX "vehicle_listings_status_visibility_publishedAt_idx" ON "vehicle_listings"("status", "visibility", "publishedAt");

-- CreateIndex
CREATE INDEX "vehicle_listings_organizationId_status_idx" ON "vehicle_listings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_listings_vehicleId_idx" ON "vehicle_listings"("vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_listings_city_state_idx" ON "vehicle_listings"("city", "state");

-- CreateIndex
CREATE INDEX "vehicle_listing_offers_listingId_status_idx" ON "vehicle_listing_offers"("listingId", "status");

-- CreateIndex
CREATE INDEX "vehicle_listing_offers_buyerOrganizationId_status_idx" ON "vehicle_listing_offers"("buyerOrganizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_inspection_requests_listingId_status_idx" ON "vehicle_inspection_requests"("listingId", "status");

-- CreateIndex
CREATE INDEX "vehicle_inspection_requests_requesterOrganizationId_status_idx" ON "vehicle_inspection_requests"("requesterOrganizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_listing_events_listingId_createdAt_idx" ON "vehicle_listing_events"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_listing_watches_organizationId_idx" ON "vehicle_listing_watches"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_listing_watches_listingId_userId_key" ON "vehicle_listing_watches"("listingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_transfers_listingId_key" ON "vehicle_transfers"("listingId");

-- CreateIndex
CREATE INDEX "vehicle_transfers_fromOrganizationId_status_idx" ON "vehicle_transfers"("fromOrganizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_transfers_toOrganizationId_status_idx" ON "vehicle_transfers"("toOrganizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_transfers_vehicleId_idx" ON "vehicle_transfers"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_publicSlug_key" ON "user_profiles"("publicSlug");

-- CreateIndex
CREATE INDEX "user_profiles_city_state_idx" ON "user_profiles"("city", "state");

-- CreateIndex
CREATE INDEX "user_profiles_completionPercent_idx" ON "user_profiles"("completionPercent");

-- CreateIndex
CREATE UNIQUE INDEX "organization_profiles_organizationId_key" ON "organization_profiles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_profiles_publicSlug_key" ON "organization_profiles"("publicSlug");

-- CreateIndex
CREATE INDEX "organization_profiles_completionPercent_idx" ON "organization_profiles"("completionPercent");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "qr_codes_subjectType_subjectId_status_idx" ON "qr_codes"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "qr_codes_organizationId_status_idx" ON "qr_codes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "qr_scans_qrCodeId_createdAt_idx" ON "qr_scans"("qrCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "qr_scans_scannedByUserId_createdAt_idx" ON "qr_scans"("scannedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "return_load_requests_reference_key" ON "return_load_requests"("reference");

-- CreateIndex
CREATE INDEX "return_load_requests_status_availableFrom_idx" ON "return_load_requests"("status", "availableFrom");

-- CreateIndex
CREATE INDEX "return_load_requests_organizationId_status_idx" ON "return_load_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "return_load_requests_truckId_status_idx" ON "return_load_requests"("truckId", "status");

-- CreateIndex
CREATE INDEX "return_load_requests_originLatitude_originLongitude_idx" ON "return_load_requests"("originLatitude", "originLongitude");

-- CreateIndex
CREATE INDEX "return_load_matches_orderId_status_idx" ON "return_load_matches"("orderId", "status");

-- CreateIndex
CREATE INDEX "return_load_matches_status_score_idx" ON "return_load_matches"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "return_load_matches_returnLoadRequestId_orderId_key" ON "return_load_matches"("returnLoadRequestId", "orderId");

-- CreateIndex
CREATE INDEX "city_access_restrictions_city_state_active_idx" ON "city_access_restrictions"("city", "state", "active");

-- CreateIndex
CREATE INDEX "city_access_restrictions_centerLatitude_centerLongitude_idx" ON "city_access_restrictions"("centerLatitude", "centerLongitude");

-- CreateIndex
CREATE INDEX "city_access_restrictions_organizationId_active_idx" ON "city_access_restrictions"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_hubs_code_key" ON "transfer_hubs"("code");

-- CreateIndex
CREATE INDEX "transfer_hubs_city_state_active_idx" ON "transfer_hubs"("city", "state", "active");

-- CreateIndex
CREATE INDEX "transfer_hubs_latitude_longitude_idx" ON "transfer_hubs"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "last_mile_partners_organizationId_key" ON "last_mile_partners"("organizationId");

-- CreateIndex
CREATE INDEX "last_mile_partners_active_verificationStatus_idx" ON "last_mile_partners"("active", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "relay_deliveries_reference_key" ON "relay_deliveries"("reference");

-- CreateIndex
CREATE INDEX "relay_deliveries_orderId_idx" ON "relay_deliveries"("orderId");

-- CreateIndex
CREATE INDEX "relay_deliveries_organizationId_status_idx" ON "relay_deliveries"("organizationId", "status");

-- CreateIndex
CREATE INDEX "relay_deliveries_partnerOrganizationId_status_idx" ON "relay_deliveries"("partnerOrganizationId", "status");

-- CreateIndex
CREATE INDEX "relay_deliveries_status_scheduledAt_idx" ON "relay_deliveries"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "relay_offers_relayId_status_idx" ON "relay_offers"("relayId", "status");

-- CreateIndex
CREATE INDEX "relay_offers_organizationId_status_idx" ON "relay_offers"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "relay_offers_relayId_organizationId_key" ON "relay_offers"("relayId", "organizationId");

-- CreateIndex
CREATE INDEX "relay_events_relayId_createdAt_idx" ON "relay_events"("relayId", "createdAt");

-- CreateIndex
CREATE INDEX "route_hazards_latitude_longitude_status_idx" ON "route_hazards"("latitude", "longitude", "status");

-- CreateIndex
CREATE INDEX "route_hazards_kind_status_idx" ON "route_hazards"("kind", "status");

-- CreateIndex
CREATE INDEX "route_hazards_status_tier_validUntil_idx" ON "route_hazards"("status", "tier", "validUntil");

-- CreateIndex
CREATE INDEX "route_hazards_city_state_idx" ON "route_hazards"("city", "state");

-- CreateIndex
CREATE INDEX "route_hazards_organizationId_status_idx" ON "route_hazards"("organizationId", "status");

-- CreateIndex
CREATE INDEX "route_hazard_reports_hazardId_createdAt_idx" ON "route_hazard_reports"("hazardId", "createdAt");

-- CreateIndex
CREATE INDEX "route_hazard_reports_reportedByUserId_createdAt_idx" ON "route_hazard_reports"("reportedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "route_hazard_reports_latitude_longitude_idx" ON "route_hazard_reports"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "route_hazard_reports_organizationId_createdAt_idx" ON "route_hazard_reports"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_hazard_alerts_tripId_createdAt_idx" ON "trip_hazard_alerts"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_hazard_alerts_organizationId_createdAt_idx" ON "trip_hazard_alerts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_hazard_alerts_driverId_violated_idx" ON "trip_hazard_alerts"("driverId", "violated");

-- CreateIndex
CREATE UNIQUE INDEX "trip_hazard_alerts_tripId_hazardId_key" ON "trip_hazard_alerts"("tripId", "hazardId");

-- CreateIndex
CREATE INDEX "materials_availabilityStatus_idx" ON "materials"("availabilityStatus");

-- CreateIndex
CREATE INDEX "materials_sku_idx" ON "materials"("sku");

-- CreateIndex
CREATE INDEX "orders_isReturnLoad_status_idx" ON "orders"("isReturnLoad", "status");

-- CreateIndex
CREATE INDEX "orders_requiresLastMile_status_idx" ON "orders"("requiresLastMile", "status");

-- CreateIndex
CREATE INDEX "trips_legType_status_idx" ON "trips"("legType", "status");

-- CreateIndex
CREATE INDEX "trips_parentTripId_idx" ON "trips"("parentTripId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_returnLoadRequestId_fkey" FOREIGN KEY ("returnLoadRequestId") REFERENCES "return_load_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_returnLoadRequestId_fkey" FOREIGN KEY ("returnLoadRequestId") REFERENCES "return_load_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_price_tiers" ADD CONSTRAINT "material_price_tiers_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listing_offers" ADD CONSTRAINT "vehicle_listing_offers_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspection_requests" ADD CONSTRAINT "vehicle_inspection_requests_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listing_events" ADD CONSTRAINT "vehicle_listing_events_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listing_watches" ADD CONSTRAINT "vehicle_listing_watches_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_profiles" ADD CONSTRAINT "organization_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_load_requests" ADD CONSTRAINT "return_load_requests_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_load_matches" ADD CONSTRAINT "return_load_matches_returnLoadRequestId_fkey" FOREIGN KEY ("returnLoadRequestId") REFERENCES "return_load_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_load_matches" ADD CONSTRAINT "return_load_matches_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_deliveries" ADD CONSTRAINT "relay_deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_deliveries" ADD CONSTRAINT "relay_deliveries_transferHubId_fkey" FOREIGN KEY ("transferHubId") REFERENCES "transfer_hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_deliveries" ADD CONSTRAINT "relay_deliveries_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_deliveries" ADD CONSTRAINT "relay_deliveries_restrictionId_fkey" FOREIGN KEY ("restrictionId") REFERENCES "city_access_restrictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_offers" ADD CONSTRAINT "relay_offers_relayId_fkey" FOREIGN KEY ("relayId") REFERENCES "relay_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_events" ADD CONSTRAINT "relay_events_relayId_fkey" FOREIGN KEY ("relayId") REFERENCES "relay_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_hazard_reports" ADD CONSTRAINT "route_hazard_reports_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "route_hazards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_hazard_alerts" ADD CONSTRAINT "trip_hazard_alerts_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "route_hazards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_hazard_alerts" ADD CONSTRAINT "trip_hazard_alerts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
