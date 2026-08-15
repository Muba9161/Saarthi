-- CreateEnum
CREATE TYPE "SosType" AS ENUM ('MEDICAL', 'ACCIDENT', 'BREAKDOWN', 'TYRE', 'FUEL', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('TRIGGERED', 'BROADCASTING', 'ACKNOWLEDGED', 'HELP_ASSIGNED', 'ASSISTANCE_ARRIVED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SosResponderStatus" AS ENUM ('NOTIFIED', 'ACKNOWLEDGED', 'ASSIGNED', 'DECLINED', 'ARRIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SosEventType" AS ENUM ('TRIGGERED', 'BROADCAST_STARTED', 'RESPONDER_NOTIFIED', 'RESPONDER_ACKNOWLEDGED', 'RESPONDER_DECLINED', 'HELP_ASSIGNED', 'ASSISTANCE_ARRIVED', 'RADIUS_EXPANDED', 'RESOLVED', 'CANCELLED', 'NOTE');

-- CreateEnum
CREATE TYPE "NearbyCategory" AS ENUM ('FUEL', 'FOOD', 'PARKING', 'WORKSHOP', 'TYRE_SHOP', 'HOSPITAL', 'PHARMACY', 'POLICE', 'REST_AREA', 'CHARGING', 'WEIGHBRIDGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AiInsightType" AS ENUM ('SUMMARY', 'RECOMMENDATION', 'WARNING', 'FORECAST', 'EXPLANATION', 'ACTION_SUGGESTION');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('IDLE', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');

-- CreateTable
CREATE TABLE "sos_incidents" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "driverId" UUID,
    "truckId" UUID,
    "tripId" UUID,
    "triggeredByUserId" UUID NOT NULL,
    "type" "SosType" NOT NULL,
    "status" "SosStatus" NOT NULL DEFAULT 'TRIGGERED',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "searchRadiusMeters" INTEGER NOT NULL DEFAULT 5000,
    "contactPhone" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolutionNote" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_responders" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "status" "SosResponderStatus" NOT NULL DEFAULT 'NOTIFIED',
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "sos_responders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_events" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "eventType" "SosEventType" NOT NULL,
    "description" TEXT,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nearby_places" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "category" "NearbyCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "phone" TEXT,
    "attributes" JSONB,
    "rating" DOUBLE PRECISION,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'local',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nearby_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "contextSummary" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "AiInsightType" NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "references" JSONB,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "basis" TEXT NOT NULL DEFAULT 'calculated',
    "validUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "tripId" UUID,
    "status" "SimulationStatus" NOT NULL DEFAULT 'IDLE',
    "route" JSONB NOT NULL,
    "routeDistanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressMeters" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseSpeedKph" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "speedMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "behaviours" JSONB,
    "deviationActive" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastTickAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sos_incidents_reference_key" ON "sos_incidents"("reference");

-- CreateIndex
CREATE INDEX "sos_incidents_organizationId_status_triggeredAt_idx" ON "sos_incidents"("organizationId", "status", "triggeredAt");

-- CreateIndex
CREATE INDEX "sos_incidents_status_triggeredAt_idx" ON "sos_incidents"("status", "triggeredAt");

-- CreateIndex
CREATE INDEX "sos_incidents_driverId_idx" ON "sos_incidents"("driverId");

-- CreateIndex
CREATE INDEX "sos_incidents_tripId_idx" ON "sos_incidents"("tripId");

-- CreateIndex
CREATE INDEX "sos_responders_incidentId_status_idx" ON "sos_responders"("incidentId", "status");

-- CreateIndex
CREATE INDEX "sos_responders_driverId_status_idx" ON "sos_responders"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sos_responders_incidentId_truckId_key" ON "sos_responders"("incidentId", "truckId");

-- CreateIndex
CREATE INDEX "sos_events_incidentId_createdAt_idx" ON "sos_events"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "nearby_places_category_active_idx" ON "nearby_places"("category", "active");

-- CreateIndex
CREATE INDEX "nearby_places_latitude_longitude_idx" ON "nearby_places"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "nearby_places_source_externalId_key" ON "nearby_places"("source", "externalId");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_updatedAt_idx" ON "ai_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_conversations_organizationId_updatedAt_idx" ON "ai_conversations"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_insights_organizationId_createdAt_idx" ON "ai_insights"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_insights_organizationId_type_dismissedAt_idx" ON "ai_insights"("organizationId", "type", "dismissedAt");

-- CreateIndex
CREATE INDEX "ai_usage_organizationId_createdAt_idx" ON "ai_usage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_userId_createdAt_idx" ON "ai_usage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "simulations_organizationId_status_idx" ON "simulations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "simulations_truckId_status_idx" ON "simulations"("truckId", "status");

-- CreateIndex
CREATE INDEX "simulations_status_idx" ON "simulations"("status");

-- AddForeignKey
ALTER TABLE "sos_responders" ADD CONSTRAINT "sos_responders_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "sos_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "sos_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
