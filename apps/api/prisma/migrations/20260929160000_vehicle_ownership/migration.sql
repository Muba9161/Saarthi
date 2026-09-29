-- Vehicle ownership, the secure PIN and passkeys that unlock sensitive details,
-- and the switch that decides whether a QR scan shows a vehicle's RC.
-- Existing vehicles start PENDING; existing fleets' QR codes stop showing RC
-- details until the account turns it on.

-- CreateEnum
CREATE TYPE "VehicleOwnershipStatus" AS ENUM ('PENDING', 'VERIFIED', 'RELEASED');

-- AlterTable
ALTER TABLE "trucks" ADD COLUMN     "ownershipStatus" "VehicleOwnershipStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ownershipVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "ownershipNote" TEXT,
ADD COLUMN     "ownershipCheckedAt" TIMESTAMP(3),
ADD COLUMN     "releasedRegistrationNumber" TEXT;

-- CreateIndex
CREATE INDEX "trucks_ownershipStatus_ownershipCheckedAt_idx" ON "trucks"("ownershipStatus", "ownershipCheckedAt");

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "securePinHash" TEXT,
ADD COLUMN     "securePinSetAt" TIMESTAMP(3),
ADD COLUMN     "securePinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "securePinLockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_panNumber_idx" ON "users"("panNumber");

-- CreateIndex
CREATE INDEX "organizations_panNumber_idx" ON "organizations"("panNumber");

-- CreateTable
CREATE TABLE "user_passkeys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_passkeys_credentialId_key" ON "user_passkeys"("credentialId");

-- CreateIndex
CREATE INDEX "user_passkeys_userId_idx" ON "user_passkeys"("userId");

-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "qr_privacy_policies" ADD COLUMN     "showRcDetails" BOOLEAN NOT NULL DEFAULT false;
