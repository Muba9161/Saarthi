-- CreateTable
CREATE TABLE "petrol_stations" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ssr',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "hasPetrol" BOOLEAN,
    "hasDiesel" BOOLEAN,
    "hasCng" BOOLEAN,
    "petrolPrice" DOUBLE PRECISION,
    "dieselPrice" DOUBLE PRECISION,
    "cngPrice" DOUBLE PRECISION,
    "timings" TEXT,
    "directionsUrl" TEXT,
    "rawData" JSONB,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petrol_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_lookups" (
    "id" UUID NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "organizationId" UUID,
    "requestedById" UUID,
    "provider" TEXT NOT NULL DEFAULT 'way2api',
    "providerReference" TEXT,
    "responseData" JSONB NOT NULL,
    "pdfStorageKey" TEXT,
    "pdfFileName" TEXT,
    "pdfMimeType" TEXT,
    "pdfSize" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "petrol_stations_latitude_longitude_idx" ON "petrol_stations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "petrol_stations_city_idx" ON "petrol_stations"("city");

-- CreateIndex
CREATE INDEX "petrol_stations_company_idx" ON "petrol_stations"("company");

-- CreateIndex
CREATE UNIQUE INDEX "petrol_stations_source_externalId_key" ON "petrol_stations"("source", "externalId");

-- CreateIndex
CREATE INDEX "vehicle_lookups_registrationNumber_expiresAt_idx" ON "vehicle_lookups"("registrationNumber", "expiresAt");

-- CreateIndex
CREATE INDEX "vehicle_lookups_organizationId_createdAt_idx" ON "vehicle_lookups"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_lookups_expiresAt_idx" ON "vehicle_lookups"("expiresAt");
