-- Salesman identity, sales leads, referral attribution, commission and
-- tracker custody.
--
-- Purely additive. Nothing existing is altered beyond two enums gaining
-- values, so this migration cannot change the behaviour of any surface that
-- was working before it ran.
--
-- Three things at the bottom of this file are hand-written rather than
-- generated, and they are the ones that matter most:
--
--   1. `referral_attributions_one_live_per_organization` — a PARTIAL UNIQUE
--      index that makes "first valid attribution wins" a database guarantee.
--      Service code checking for an existing attribution before inserting is
--      not enough: two registrations arriving in the same instant would both
--      find none and both insert, and one salesperson's commission would
--      quietly become two.
--
--   2. `commissions_trigger_paymentReference_key` — one commission per qualifying
--      payment, per trigger. Payment webhooks retry, renewals replay, and a
--      support agent will click the retry button twice. Idempotency belongs in
--      the schema for the same reason as above.
--
--   3. `commission_rules_one_default_per_trigger` — at most one *active*,
--      currently-effective, plan-agnostic rule per trigger, so a qualifying
--      sale cannot match two catch-all rules and pay whichever one the query
--      planner happened to return first.
--
-- Note also what this migration does NOT create: no device table, no tracker
-- registry, no payment table, no customer table. `tracker_handovers` points at
-- the existing `vehicle_trackers` row the customer paid for, and `commissions`
-- points at the existing organization and payment reference. Saarthi has one
-- of each of those and this adds no second one.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "SalesmanStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalesmanVerificationMethod" AS ENUM ('GODWEB', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "SalesLeadSource" AS ENUM ('FIELD_VISIT', 'REFERRAL_LINK', 'REFERRAL_QR', 'INBOUND_CALL', 'EVENT', 'EXISTING_CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'INTERESTED', 'SIGNUP_PENDING', 'PAYMENT_PENDING', 'SUBSCRIBED', 'TRACKER_PENDING', 'ONBOARDING', 'ACTIVATED', 'LOST', 'CANCELLED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "SalesLeadEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'NOTE_ADDED', 'FOLLOW_UP_SET', 'DEMO_RECORDED', 'CUSTOMER_LINKED', 'TRACKER_HANDED_OVER', 'ONBOARDING_COMPLETED');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('PHYSICAL', 'REFERRAL_LINK', 'REFERRAL_QR', 'ASSISTED_SIGNUP', 'MANUAL_GODID');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('CAPTURED', 'ATTRIBUTED', 'CONVERTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAYABLE', 'PAID', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommissionTrigger" AS ENUM ('SUBSCRIPTION', 'TRACKER', 'VEHICLE_TOPUP');

-- CreateEnum
CREATE TYPE "TrackerHandoverStatus" AS ENUM ('ASSIGNED_TO_SALESMAN', 'HANDED_TO_CUSTOMER', 'INSTALLED', 'RETURNED', 'LOST');

-- AlterEnum
--
-- Added inside the migration transaction, which PostgreSQL 12 and later
-- permit; the values are not *used* until a later statement in a later
-- transaction, which is the restriction that still applies. The project
-- targets PostgreSQL 14+ (see docker/ and docs/PRODUCTION.md).
ALTER TYPE "NotificationType" ADD VALUE 'SALES_LEAD_FOLLOW_UP_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SALES_REFERRAL_CONVERTED';
ALTER TYPE "NotificationType" ADD VALUE 'SALES_COMMISSION_PENDING';
ALTER TYPE "NotificationType" ADD VALUE 'SALES_COMMISSION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SALES_COMMISSION_PAID';
ALTER TYPE "NotificationType" ADD VALUE 'SALES_TRACKER_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'SALESMAN_VERIFIED';

-- AlterEnum
ALTER TYPE "RoleName" ADD VALUE 'SALESMAN';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "salesman_profiles" (
    "id" UUID NOT NULL,
    "godId" TEXT NOT NULL,
    "userId" UUID,
    "externalSalespersonId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "territory" TEXT,
    "status" "SalesmanStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verificationMethod" "SalesmanVerificationMethod",
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" UUID,
    "verificationNote" TEXT,
    "godwebReference" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "standingReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salesman_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_leads" (
    "id" UUID NOT NULL,
    "salesmanId" UUID NOT NULL,
    "contactName" TEXT NOT NULL,
    "businessName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "fleetSize" INTEGER,
    "vehicleTypes" "VehicleType"[],
    "interestedPlan" "PlanTier",
    "source" "SalesLeadSource" NOT NULL DEFAULT 'FIELD_VISIT',
    "status" "SalesLeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "organizationId" UUID,
    "attributionId" UUID,
    "demoCompletedAt" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "firstVehicleId" UUID,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lead_events" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" "SalesLeadEventType" NOT NULL,
    "fromStatus" "SalesLeadStatus",
    "toStatus" "SalesLeadStatus",
    "note" TEXT,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" UUID NOT NULL,
    "salesmanId" UUID NOT NULL,
    "godId" TEXT NOT NULL,
    "salespersonExternalId" TEXT,
    "source" "ReferralSource" NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'CAPTURED',
    "organizationId" UUID,
    "customerUserId" UUID,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attributedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,
    "captureIpHash" TEXT,
    "captureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- Ships empty. See the model comment in schema.prisma: a commission rate is a
-- commercial agreement, and one seeded here would be a rate nobody agreed to.
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "planTier" "PlanTier",
    "trigger" "CommissionTrigger" NOT NULL DEFAULT 'SUBSCRIPTION',
    "commissionType" "CommissionType" NOT NULL,
    "commissionRate" DECIMAL(6,3),
    "fixedAmount" DECIMAL(12,2),
    "qualificationDays" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "salesmanId" UUID NOT NULL,
    "attributionId" UUID,
    "ruleId" UUID,
    "godId" TEXT NOT NULL,
    "salespersonExternalId" TEXT,
    "organizationId" UUID NOT NULL,
    "planTier" "PlanTier",
    "trigger" "CommissionTrigger" NOT NULL DEFAULT 'SUBSCRIPTION',
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "commissionRate" DECIMAL(6,3),
    -- Nullable on purpose. Null is "qualified, no rule covered it"; zero would
    -- be "settled for nothing", and the two must never be confused.
    "commissionAmount" DECIMAL(12,2),
    "paymentReference" TEXT NOT NULL,
    "paymentId" UUID,
    "subscriptionId" UUID,
    "eligibleAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "paidAt" TIMESTAMP(3),
    "paidByUserId" UUID,
    "payoutReference" TEXT,
    "reversedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "unmatchedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracker_handovers" (
    "id" UUID NOT NULL,
    "trackerId" UUID NOT NULL,
    "salesmanId" UUID NOT NULL,
    "leadId" UUID,
    "organizationId" UUID,
    "status" "TrackerHandoverStatus" NOT NULL DEFAULT 'ASSIGNED_TO_SALESMAN',
    "serialNumber" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" UUID,
    "handedOverAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "installedAt" TIMESTAMP(3),
    "vehicleId" UUID,
    "returnedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracker_handovers_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "salesman_profiles_godId_key" ON "salesman_profiles"("godId");

-- CreateIndex
CREATE UNIQUE INDEX "salesman_profiles_userId_key" ON "salesman_profiles"("userId");

-- CreateIndex
CREATE INDEX "salesman_profiles_status_idx" ON "salesman_profiles"("status");

-- CreateIndex
CREATE INDEX "salesman_profiles_externalSalespersonId_idx" ON "salesman_profiles"("externalSalespersonId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_leads_attributionId_key" ON "sales_leads"("attributionId");

-- CreateIndex
CREATE INDEX "sales_leads_salesmanId_status_idx" ON "sales_leads"("salesmanId", "status");

-- CreateIndex
CREATE INDEX "sales_leads_status_nextFollowUpAt_idx" ON "sales_leads"("status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "sales_leads_organizationId_idx" ON "sales_leads"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_leads_salesmanId_phone_key" ON "sales_leads"("salesmanId", "phone");

-- CreateIndex
CREATE INDEX "sales_lead_events_leadId_createdAt_idx" ON "sales_lead_events"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_attributions_salesmanId_status_idx" ON "referral_attributions"("salesmanId", "status");

-- CreateIndex
CREATE INDEX "referral_attributions_godId_idx" ON "referral_attributions"("godId");

-- CreateIndex
CREATE INDEX "referral_attributions_organizationId_status_idx" ON "referral_attributions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "referral_attributions_status_expiresAt_idx" ON "referral_attributions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "commission_rules_active_trigger_planTier_idx" ON "commission_rules"("active", "trigger", "planTier");

-- CreateIndex
CREATE INDEX "commissions_salesmanId_status_idx" ON "commissions"("salesmanId", "status");

-- CreateIndex
CREATE INDEX "commissions_status_eligibleAt_idx" ON "commissions"("status", "eligibleAt");

-- CreateIndex
CREATE INDEX "commissions_organizationId_idx" ON "commissions"("organizationId");

-- CreateIndex
CREATE INDEX "commissions_godId_idx" ON "commissions"("godId");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_handovers_trackerId_key" ON "tracker_handovers"("trackerId");

-- CreateIndex
CREATE INDEX "tracker_handovers_salesmanId_status_idx" ON "tracker_handovers"("salesmanId", "status");

-- CreateIndex
CREATE INDEX "tracker_handovers_organizationId_idx" ON "tracker_handovers"("organizationId");

-- CreateIndex
CREATE INDEX "tracker_handovers_status_idx" ON "tracker_handovers"("status");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "salesman_profiles" ADD CONSTRAINT "salesman_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "salesman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "referral_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_events" ADD CONSTRAINT "sales_lead_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "salesman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "salesman_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "referral_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_handovers" ADD CONSTRAINT "tracker_handovers_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "salesman_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_handovers" ADD CONSTRAINT "tracker_handovers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_handovers" ADD CONSTRAINT "tracker_handovers_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "vehicle_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_handovers" ADD CONSTRAINT "tracker_handovers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Anti-fraud constraints
--
-- Hand-written, and not expressible in the Prisma schema — which is why they
-- carry this comment rather than a `@@unique`. Prisma is aware of them only in
-- so far as a violation surfaces as P2002; the rules themselves live here.
-- ---------------------------------------------------------------------------

-- "First valid attribution wins", as a database guarantee.
--
-- At most one live attribution per organization. CAPTURED, ATTRIBUTED and
-- CONVERTED are live; EXPIRED and REVOKED are not, so a window that ran out or
-- an administrator's withdrawal frees the customer for a genuine new
-- attribution while the old row stays for the audit trail.
--
-- Salesman B entering their GODID after Salesman A's referral has already been
-- attributed does not get a second row — the insert fails on this index and the
-- service reports that the customer is already attributed.
CREATE UNIQUE INDEX "referral_attributions_one_live_per_organization"
    ON "referral_attributions" ("organizationId")
    WHERE "organizationId" IS NOT NULL
      AND "status" IN ('CAPTURED', 'ATTRIBUTED', 'CONVERTED');

-- One commission per qualifying payment, per kind of sale.
--
-- The idempotency key for commission generation. A payment webhook that
-- retries, a renewal event replayed by the provider, or two concurrent
-- qualification passes all converge on the same row rather than paying twice.
--
-- `trigger` is part of the key because one payment can legitimately carry a
-- subscription and a tracker; each earns its own commission under its own rule,
-- and both are still capped at one.
-- Named as Prisma would name it, because it is also declared in the schema
-- (`@@unique([trigger, paymentReference])`) so the client can `upsert` on it.
-- A hand-picked name here would show up as a drift on every future diff.
CREATE UNIQUE INDEX "commissions_trigger_paymentReference_key"
    ON "commissions" ("trigger", "paymentReference");

-- At most one catch-all rule in force per trigger.
--
-- A plan-agnostic rule (planTier IS NULL) applies to every sale of its kind, so
-- two of them in force at once means a qualifying sale matches both and the
-- amount depends on row order. A plan-specific rule is exempt: those are
-- disjoint by construction, and the resolver prefers the specific one anyway.
CREATE UNIQUE INDEX "commission_rules_one_default_per_trigger"
    ON "commission_rules" ("trigger")
    WHERE "active" = true AND "planTier" IS NULL;

-- One rule per (trigger, plan) while active, for the same reason.
CREATE UNIQUE INDEX "commission_rules_one_per_trigger_plan"
    ON "commission_rules" ("trigger", "planTier")
    WHERE "active" = true AND "planTier" IS NOT NULL;

-- An approved or paid commission must carry an amount.
--
-- The last line of defence for the rule that a null amount is never settled. If
-- a future code path ever approves a row whose rule did not resolve, this
-- refuses the write rather than creating a debt of an unknown size.
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_settled_amount_present"
    CHECK (
        "status" NOT IN ('APPROVED', 'PAYABLE', 'PAID')
        OR "commissionAmount" IS NOT NULL
    );
