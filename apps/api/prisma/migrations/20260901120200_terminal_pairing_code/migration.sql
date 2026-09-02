-- Human-typeable pairing code for a Saarthi Terminal.
--
-- A terminal is a tablet bolted into a cab, often with a scratched digitiser
-- and always in bad light, so it has to be pairable when the camera will not
-- focus. This is the same single-use credential as `tokenHash`, in a shorter
-- alphabet, and it is null for every other kind of device.

-- AlterTable
ALTER TABLE "device_pairing_tokens" ADD COLUMN     "pairingCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_tokens_pairingCode_key" ON "device_pairing_tokens"("pairingCode");
