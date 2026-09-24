-- Hosted checkout and autopay.
--
-- With a real gateway a charge does not settle in-process: the customer pays
-- on the provider's checkout and the result arrives later. Top-ups and
-- trackers ordered that way wait in PENDING_PAYMENT, granting nothing, until
-- the payment is confirmed server-side.
ALTER TYPE "TopUpStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "TrackerStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

-- A payment made on the gateway's hosted checkout, where the payer picks the
-- method themselves.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ONLINE';

-- An owner asking a driver to install the Saarthi Driver App.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DRIVER_APP_INVITE';

-- The recurring-billing mandate for the plan itself.
ALTER TABLE "subscriptions" ADD COLUMN "autopayProvider" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "autopayStatus" TEXT;

-- Every provider webhook, once. The unique key is what makes a retried or
-- duplicated delivery harmless.
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_eventKey_key" ON "payment_webhook_events"("eventKey");
CREATE INDEX "payment_webhook_events_provider_eventType_idx" ON "payment_webhook_events"("provider", "eventType");
