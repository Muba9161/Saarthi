-- Unpaid-account retention: archive after 3 days' grace, purge 90 days later.
ALTER TABLE "organizations" ADD COLUMN "billingArchivedAt" TIMESTAMP(3),
ADD COLUMN "dataPurgeAt" TIMESTAMP(3),
ADD COLUMN "dataPurgedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "organizations_dataPurgeAt_idx" ON "organizations"("dataPurgeAt");
