-- Free retries for paid checks marked "Not verified" because Saarthi misread
-- Way2API's answer, not because the record failed.
--
-- Three defects, fixed in the same change as this migration:
--   * Voter ID and GST sent the number under a field the provider does not
--     read (`epic_number` / `gstin` instead of `voter_id` / `gst_number`), so
--     no negative answer to either was about the number the customer entered.
--   * The Aadhaar–PAN link check never read `linking_status`, so a linked
--     Aadhaar came back UNCONFIRMED with the stock "would not confirm" reason.
--   * SOURCE_UNAVAILABLE (the government source was down) was read as "no
--     record" for PAN, Voter ID and GST, and as "not linked" for Aadhaar. Only
--     the attempts whose stored reason carries the provider's own
--     "unavailable" wording can be told apart, so only those are re-credited.
--
-- Each such charge becomes RETRY_REQUIRED: the state the charge service gives
-- an attempt that got no answer, whose fee the next attempt at the same check
-- reuses without a second payment. A check since verified is left alone, as
-- there is nothing left to retry. The payer is told in-app, as the charge
-- service tells them when it grants a free retry itself.

WITH misread AS (
  UPDATE "verification_charges" AS c
  SET "status" = 'RETRY_REQUIRED',
      "reason" = 'The result of this check was not read correctly. Your fee is kept. Try again at no charge.',
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE c."status" = 'FAILED'
    AND (
      c."checkType" IN ('VOTER_ID', 'GST')
      OR (
        c."checkType" = 'AADHAAR'
        AND c."reason" = 'The records service would not confirm the Aadhaar–PAN link. Left for a reviewer.'
      )
      OR (
        c."checkType" IN ('AADHAAR', 'PAN', 'VOTER_ID', 'GST')
        AND c."reason" ILIKE '%unavailable%'
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "verification_charges" AS later
      WHERE later."checkType" = c."checkType"
        AND later."subjectType" = c."subjectType"
        AND later."subjectId" = c."subjectId"
        AND later."status" = 'VERIFIED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "identity_verifications" AS iv
      WHERE iv."subjectType" = c."subjectType"
        AND iv."subjectId" = c."subjectId"
        AND iv."kind"::text = c."checkType"::text
        AND iv."outcome" = 'VERIFIED'
    )
  RETURNING c."requestedById", c."organizationId", c."checkType"
)
INSERT INTO "notifications" ("id", "userId", "organizationId", "type", "title", "body", "priority", "actionUrl", "createdAt")
SELECT
  gen_random_uuid(),
  m."requestedById",
  m."organizationId",
  'VERIFICATION_RESULT'::"NotificationType",
  CASE m."checkType"
    WHEN 'AADHAAR' THEN 'Aadhaar'
    WHEN 'VOTER_ID' THEN 'Voter ID'
    ELSE m."checkType"::text
  END || ' check can be retried free',
  'We could not read the result of your paid check correctly. Your fee is kept. Retry it at no extra charge.',
  'NORMAL'::"NotificationPriority",
  '/verification',
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "requestedById", "organizationId", "checkType" FROM misread) AS m;
