-- Open already-printed driver and vehicle codes to roadside resolution.
--
-- A QR sticker fixed to a cab door or carried on a lanyard is meant to answer,
-- for whoever is standing in front of it, the questions the paper RC and licence
-- in the cab already answer. Until now every code was issued with
-- `allowPublicResolve = false`, so a scan with no session resolved to a 404 and
-- the phone landed on the sign-in screen — which makes the printed artefact
-- useless to exactly the people it was printed for.
--
-- Two changes, both scoped to codes that are actually printed and still live:
--
--   1. `allowPublicResolve` is switched on for ACTIVE DRIVER and VEHICLE codes,
--      so stickers already in the field start working without being reissued.
--      Rotating a code would have achieved the same thing one truck at a time,
--      at the cost of reprinting every sticker in the country.
--
--   2. Each of those codes gains the *other* subject's summary scope, so one
--      scan answers for the vehicle and for the person driving it. A code's
--      scopes are its ceiling, not its disclosure: what a given scanner
--      actually sees is still the intersection of these scopes, that scanner's
--      relationship to the subject, and the fleet's own field policy.
--
-- Deliberately untouched: TRIP, ORDER, USER, VEHICLE_LISTING,
-- INVENTORY_LOCATION, TRANSFER_HUB and RELAY_DELIVERY codes. Those are internal
-- handles that happen to be renderable as a QR, and one of them answering to a
-- passer-by would be a leak rather than a feature. REVOKED and EXPIRED codes are
-- untouched for the same reason they were revoked or expired.
--
-- Reversible by hand: set `allowPublicResolve = false` for the affected rows, or
-- switch `allowPublicScans` off on the organization's QR privacy policy, which
-- closes anonymous scanning across a whole tenant without touching this table.

UPDATE "qr_codes"
SET "allowPublicResolve" = true
WHERE "status" = 'ACTIVE'
  AND "subjectType" IN ('DRIVER', 'VEHICLE')
  AND "allowPublicResolve" = false;

-- A vehicle code learns to answer for its driver.
UPDATE "qr_codes"
SET "scopes" = array_append("scopes", 'DRIVER_SUMMARY'::"QrScope")
WHERE "status" = 'ACTIVE'
  AND "subjectType" = 'VEHICLE'
  AND NOT ('DRIVER_SUMMARY' = ANY ("scopes"));

-- A driver code learns to answer for the vehicle they are on.
UPDATE "qr_codes"
SET "scopes" = array_append("scopes", 'VEHICLE_SUMMARY'::"QrScope")
WHERE "status" = 'ACTIVE'
  AND "subjectType" = 'DRIVER'
  AND NOT ('VEHICLE_SUMMARY' = ANY ("scopes"));

-- Both need COMPLIANCE to reach the RC and licence records at all.
UPDATE "qr_codes"
SET "scopes" = array_append("scopes", 'COMPLIANCE'::"QrScope")
WHERE "status" = 'ACTIVE'
  AND "subjectType" IN ('DRIVER', 'VEHICLE')
  AND NOT ('COMPLIANCE' = ANY ("scopes"));
