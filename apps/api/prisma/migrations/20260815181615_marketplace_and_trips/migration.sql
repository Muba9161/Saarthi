-- CreateEnum
CREATE TYPE "MaterialUnit" AS ENUM ('TON', 'KG', 'CUBIC_METER', 'LITRE', 'PIECE', 'BAG', 'TRIP');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'REQUESTED', 'QUOTED', 'CONFIRMED', 'ASSIGNED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'QUOTE_ADDED', 'QUOTE_WITHDRAWN', 'QUOTE_ACCEPTED', 'CONFIRMED', 'ASSIGNED', 'STATUS_CHANGED', 'TRIP_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'FAILED', 'RATED', 'NOTE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'LOADING', 'STARTED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED', 'UNLOADING', 'COMPLETED', 'CANCELLED', 'EMERGENCY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'LOADING_STARTED', 'DEPARTED', 'LOCATION_UPDATE', 'STOP_STARTED', 'STOP_ENDED', 'ROUTE_DEVIATION', 'SPEED_VIOLATION', 'HARSH_BRAKING', 'HARSH_ACCELERATION', 'DELAY_DETECTED', 'ARRIVED', 'UNLOADING_STARTED', 'COMPLETED', 'CANCELLED', 'EMERGENCY', 'NOTE');

-- CreateEnum
CREATE TYPE "TripStopType" AS ENUM ('ORIGIN', 'DESTINATION', 'WAYPOINT', 'REST', 'FUEL', 'CHECKPOINT');

-- CreateEnum
CREATE TYPE "TripStopStatus" AS ENUM ('PENDING', 'ARRIVED', 'DEPARTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "businessDescription" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "unit" "MaterialUnit" NOT NULL DEFAULT 'TON',
    "pricePerUnit" DECIMAL(12,2) NOT NULL,
    "availableQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimumOrderQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "MaterialStatus" NOT NULL DEFAULT 'ACTIVE',
    "imageUrl" TEXT,
    "pickupAddress" TEXT,
    "pickupLatitude" DOUBLE PRECISION,
    "pickupLongitude" DOUBLE PRECISION,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "primaryUserId" UUID,
    "businessType" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "customerOrganizationId" UUID NOT NULL,
    "materialId" UUID,
    "supplierOrganizationId" UUID,
    "fleetOrganizationId" UUID,
    "materialName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "MaterialUnit" NOT NULL DEFAULT 'TON',
    "materialPrice" DECIMAL(12,2),
    "transportPrice" DECIMAL(12,2),
    "totalPrice" DECIMAL(12,2),
    "budget" DECIMAL(12,2),
    "originAddress" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationLatitude" DOUBLE PRECISION NOT NULL,
    "destinationLongitude" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "requiredCapacityTons" DOUBLE PRECISION NOT NULL,
    "requiredTruckType" "TruckType",
    "pickupAt" TIMESTAMP(3),
    "deliverBy" TIMESTAMP(3),
    "status" "OrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "assignedTruckId" UUID,
    "assignedDriverId" UUID,
    "tripId" UUID,
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_quotes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fleetOrganizationId" UUID NOT NULL,
    "truckId" UUID,
    "driverId" UUID,
    "price" DECIMAL(12,2) NOT NULL,
    "estimatedPickupAt" TIMESTAMP(3),
    "estimatedArrivalAt" TIMESTAMP(3),
    "distanceToPickupKm" DOUBLE PRECISION,
    "message" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ratings" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "driverId" UUID,
    "fleetOrganizationId" UUID,
    "supplierOrganizationId" UUID,
    "rating" INTEGER NOT NULL,
    "punctuality" INTEGER,
    "communication" INTEGER,
    "cargoCondition" INTEGER,
    "comment" TEXT,
    "ratedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "driverId" UUID,
    "originAddress" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationLatitude" DOUBLE PRECISION NOT NULL,
    "destinationLongitude" DOUBLE PRECISION NOT NULL,
    "plannedRoute" JSONB,
    "plannedDistanceKm" DOUBLE PRECISION,
    "actualDistanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedDurationMin" INTEGER,
    "actualDurationMin" INTEGER,
    "plannedStartAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "plannedArrivalAt" TIMESTAMP(3),
    "actualArrivalAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "price" DECIMAL(12,2),
    "expenses" DECIMAL(12,2),
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" "TripEventType" NOT NULL,
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" "TripStopType" NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedArrival" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "actualDeparture" TIMESTAMP(3),
    "status" "TripStopStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_key" ON "suppliers"("organizationId");

-- CreateIndex
CREATE INDEX "suppliers_verificationStatus_idx" ON "suppliers"("verificationStatus");

-- CreateIndex
CREATE INDEX "materials_supplierId_status_idx" ON "materials"("supplierId", "status");

-- CreateIndex
CREATE INDEX "materials_organizationId_status_idx" ON "materials"("organizationId", "status");

-- CreateIndex
CREATE INDEX "materials_category_idx" ON "materials"("category");

-- CreateIndex
CREATE INDEX "materials_name_idx" ON "materials"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_key" ON "customers"("organizationId");

-- CreateIndex
CREATE INDEX "customers_verificationStatus_idx" ON "customers"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "orders_reference_key" ON "orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tripId_key" ON "orders"("tripId");

-- CreateIndex
CREATE INDEX "orders_customerOrganizationId_status_createdAt_idx" ON "orders"("customerOrganizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_supplierOrganizationId_status_idx" ON "orders"("supplierOrganizationId", "status");

-- CreateIndex
CREATE INDEX "orders_fleetOrganizationId_status_idx" ON "orders"("fleetOrganizationId", "status");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_assignedTruckId_idx" ON "orders"("assignedTruckId");

-- CreateIndex
CREATE INDEX "order_quotes_orderId_status_idx" ON "order_quotes"("orderId", "status");

-- CreateIndex
CREATE INDEX "order_quotes_fleetOrganizationId_status_idx" ON "order_quotes"("fleetOrganizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_quotes_orderId_fleetOrganizationId_truckId_key" ON "order_quotes"("orderId", "fleetOrganizationId", "truckId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_ratings_orderId_key" ON "order_ratings"("orderId");

-- CreateIndex
CREATE INDEX "order_ratings_driverId_idx" ON "order_ratings"("driverId");

-- CreateIndex
CREATE INDEX "order_ratings_fleetOrganizationId_idx" ON "order_ratings"("fleetOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "trips_reference_key" ON "trips"("reference");

-- CreateIndex
CREATE INDEX "trips_organizationId_status_createdAt_idx" ON "trips"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "trips_truckId_status_idx" ON "trips"("truckId", "status");

-- CreateIndex
CREATE INDEX "trips_driverId_status_idx" ON "trips"("driverId", "status");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trip_events_tripId_createdAt_idx" ON "trip_events"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_events_type_idx" ON "trip_events"("type");

-- CreateIndex
CREATE INDEX "trip_stops_tripId_status_idx" ON "trip_stops"("tripId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_tripId_sequence_key" ON "trip_stops"("tripId", "sequence");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_quotes" ADD CONSTRAINT "order_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
