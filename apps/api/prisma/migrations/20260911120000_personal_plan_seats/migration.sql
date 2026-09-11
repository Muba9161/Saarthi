-- Backfill: accounts on the Personal plan are seats, not businesses.
--
-- `isPersonalSeat` arrived with driver self-registration in mind and was only
-- ever set there, so the other kind of seat was missed: somebody who subscribes
-- to Personal for their own two or three vehicles. They are never asked what
-- kind of business they are, never asked for a business name, and have no
-- registration certificate, GSTIN or bank mandate to file — yet their
-- organization looked exactly like a freight company to everything downstream,
-- and they were offered the business documents screen and asked for all three.
--
-- Registration now records this at the point the organization is created (see
-- `register` in auth.service.ts). This catches the accounts created before it
-- did.
--
-- Identified by the subscription rather than by any shape of the organization:
-- the Personal plan is the whole definition of a Personal account, and it is
-- the one thing that cannot be true of a business. The FLEET_OWNER check is
-- belt and braces — it is the only type a Personal registration can create.
--
-- Conservative in the same direction as the migration that added the column:
-- a seat missed here stays visible and harmless, while mislabelling a real
-- business would hide documents from the people who must file them. Hence the
-- membership guard — the Personal plan allows exactly one member, so anything
-- carrying more has stopped being one person's account.
UPDATE "organizations" o
SET "isPersonalSeat" = true
WHERE o."isPersonalSeat" = false
  AND o."type" = 'FLEET_OWNER'
  AND (
    SELECT COUNT(*) FROM "memberships" m WHERE m."organizationId" = o."id"
  ) <= 1
  AND EXISTS (
    SELECT 1
    FROM "subscriptions" s
    JOIN "subscription_plans" p ON p."id" = s."planId"
    WHERE s."organizationId" = o."id"
      AND p."tier" = 'PERSONAL'
  );
