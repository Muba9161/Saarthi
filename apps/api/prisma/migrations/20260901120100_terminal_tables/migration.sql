-- Saarthi Terminal — tables.
--
-- One driver-on-terminal lifecycle per terminal_sessions row, a configurable
-- pre-trip checklist, its submissions, and driver-reported vehicle issues.
-- Terminals themselves are hardware_devices, vehicles are trucks and drivers
-- are drivers: nothing here duplicates them.

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "terminalDeviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "driverUserId" UUID NOT NULL,
    "status" "TerminalSessionStatus" NOT NULL DEFAULT 'DRIVER_IDENTIFIED',
    "scannedQrCodeId" UUID,
    "scanLatitude" DOUBLE PRECISION,
    "scanLongitude" DOUBLE PRECISION,
    "selfieMediaId" UUID,
    "selfieCapturedAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionNote" TEXT,
    "rejectionReason" TEXT,
    "truckAssignmentId" UUID,
    "checklistCompletedAt" TIMESTAMP(3),
    "tripStartedAt" TIMESTAMP(3),
    "tripCompletedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_session_events" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "eventType" "TerminalSessionEventType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_checklist_templates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Pre-trip safety check',
    "vehicleType" "VehicleType",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_checklist_template_items" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "kind" "TerminalChecklistItemKind" NOT NULL DEFAULT 'MANUAL',
    "metric" TEXT,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "terminal_checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_checklist_submissions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "templateId" UUID,
    "outcome" "TerminalChecklistOutcome" NOT NULL DEFAULT 'PASSED',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "odometerKm" DOUBLE PRECISION,
    "usedSimulatedData" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_checklist_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_checklist_item_results" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "TerminalChecklistItemKind" NOT NULL DEFAULT 'MANUAL',
    "status" "TerminalChecklistItemStatus" NOT NULL DEFAULT 'OK',
    "observedValue" DOUBLE PRECISION,
    "unit" TEXT,
    "metric" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "detail" TEXT,

    CONSTRAINT "terminal_checklist_item_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_issue_reports" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID,
    "terminalDeviceId" UUID,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "reportedByUserId" UUID,
    "category" "TerminalIssueCategory" NOT NULL DEFAULT 'OTHER',
    "status" "TerminalIssueStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "description" TEXT NOT NULL,
    "mediaIds" TEXT[],
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "odometerKm" DOUBLE PRECISION,
    "maintenanceRecordId" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_issue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terminal_sessions_organizationId_status_requestedAt_idx" ON "terminal_sessions"("organizationId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "terminal_sessions_terminalDeviceId_status_idx" ON "terminal_sessions"("terminalDeviceId", "status");

-- CreateIndex
CREATE INDEX "terminal_sessions_vehicleId_status_idx" ON "terminal_sessions"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "terminal_sessions_driverId_status_idx" ON "terminal_sessions"("driverId", "status");

-- CreateIndex
CREATE INDEX "terminal_sessions_status_expiresAt_idx" ON "terminal_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "terminal_session_events_sessionId_createdAt_idx" ON "terminal_session_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "terminal_checklist_templates_organizationId_active_idx" ON "terminal_checklist_templates"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_checklist_templates_organizationId_vehicleType_key" ON "terminal_checklist_templates"("organizationId", "vehicleType");

-- CreateIndex
CREATE INDEX "terminal_checklist_template_items_templateId_sortOrder_idx" ON "terminal_checklist_template_items"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_checklist_template_items_templateId_code_key" ON "terminal_checklist_template_items"("templateId", "code");

-- CreateIndex
CREATE INDEX "terminal_checklist_submissions_organizationId_submittedAt_idx" ON "terminal_checklist_submissions"("organizationId", "submittedAt");

-- CreateIndex
CREATE INDEX "terminal_checklist_submissions_vehicleId_submittedAt_idx" ON "terminal_checklist_submissions"("vehicleId", "submittedAt");

-- CreateIndex
CREATE INDEX "terminal_checklist_submissions_sessionId_idx" ON "terminal_checklist_submissions"("sessionId");

-- CreateIndex
CREATE INDEX "terminal_checklist_item_results_submissionId_idx" ON "terminal_checklist_item_results"("submissionId");

-- CreateIndex
CREATE INDEX "terminal_issue_reports_organizationId_status_createdAt_idx" ON "terminal_issue_reports"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "terminal_issue_reports_vehicleId_createdAt_idx" ON "terminal_issue_reports"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "terminal_issue_reports_sessionId_idx" ON "terminal_issue_reports"("sessionId");

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_terminalDeviceId_fkey" FOREIGN KEY ("terminalDeviceId") REFERENCES "hardware_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_session_events" ADD CONSTRAINT "terminal_session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_checklist_template_items" ADD CONSTRAINT "terminal_checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "terminal_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_checklist_submissions" ADD CONSTRAINT "terminal_checklist_submissions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_checklist_submissions" ADD CONSTRAINT "terminal_checklist_submissions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "terminal_checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_checklist_item_results" ADD CONSTRAINT "terminal_checklist_item_results_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "terminal_checklist_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_issue_reports" ADD CONSTRAINT "terminal_issue_reports_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_issue_reports" ADD CONSTRAINT "terminal_issue_reports_terminalDeviceId_fkey" FOREIGN KEY ("terminalDeviceId") REFERENCES "hardware_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_issue_reports" ADD CONSTRAINT "terminal_issue_reports_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_issue_reports" ADD CONSTRAINT "terminal_issue_reports_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

