-- AlterTable
--
-- Whether this organization is a real business or just somebody's seat.
--
-- A driver who signs up without an employer's invite code still needs an
-- organization: every membership, driver row, document and QR badge hangs off
-- one. Registration gives them a single-member FLEET_OWNER named after them,
-- which the code has always described as "a seat, not a business" — but the
-- distinction lived only in that comment. Anything asking "does this account
-- act for a business?" could check only whether an organization existed, and
-- one always does, so a driver was offered the business documents screen and
-- asked for a GST number and a registration certificate they will never have.
--
-- Defaults to false so every existing real fleet, supplier, customer and
-- association is untouched. The backfill below marks only the seats.
ALTER TABLE "organizations"
  ADD COLUMN "isPersonalSeat" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the seats already created by driver self-registration.
--
-- Identified by the shape registration gives them and nothing else: a
-- FLEET_OWNER whose single membership is held with the DRIVER role. A solo
-- fleet owner who also drives is not caught by this — their membership role is
-- FLEET_OWNER, because they own the vehicles and merely also drive them.
--
-- Deliberately conservative. Mislabelling a real fleet as a seat would hide
-- its business documents from the people who must file them, so a seat missed
-- here stays visible and harmless; the reverse would not be.
UPDATE "organizations" o
SET "isPersonalSeat" = true
WHERE o."type" = 'FLEET_OWNER'
  AND (
    SELECT COUNT(*) FROM "memberships" m WHERE m."organizationId" = o."id"
  ) = 1
  AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."organizationId" = o."id" AND m."role" = 'DRIVER'
  );
