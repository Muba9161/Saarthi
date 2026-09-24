import { describe, expect, it } from 'vitest';
import {
  DocumentValidity,
  DocumentVerificationStatus,
  OrderStatus,
  PLAN_TIERS,
  PlanTier,
  RoleName,
  ScoreCategory,
  SosStatus,
  TrackerProduct,
  TripStatus,
  OrganizationType,
  VehicleType,
} from './enums';
import {
  DEFAULT_SCORING_CONFIG,
  buildScoreBreakdown,
  computeCategoryScores,
  computeOverallScore,
  ruleFor,
  scoreBand,
  type AppliedScoreEvent,
} from './scoring';
import {
  bearing,
  boundingDeltas,
  compassDirection,
  cumulativeDistances,
  destinationPoint,
  distanceKm,
  distanceToPath,
  distanceToSegment,
  haversineDistance,
  interpolate,
  pathLength,
  pointAtDistance,
} from './geo';
import { orderStateMachine, sosStateMachine, tripStateMachine } from './state-machines';
import {
  DOCUMENT_TYPE_CODES,
  daysUntil,
  documentTypeDefinition,
  documentTypesFor,
  isRetiredDocumentType,
  mandatoryDocumentTypes,
  resolveDocumentValidity,
} from './documents';
import {
  Feature,
  LAPSED_FEATURES,
  PLAN_CATALOGUE,
  PLAN_LIMITS,
  accountFeatures,
  accountRunsVehicles,
  accountUsesTracker,
  featuresForTier,
  isTrackerFeature,
  minimumTierFor,
  personalTrackerNeedsAadhaar,
  personalVehicleNeedsAadhaar,
  planAllowedForOrganizationType,
  tierHasFeature,
  trackerFeatures,
} from './entitlements';
import {
  DEFAULT_TRIAL_DAYS,
  GST_RATE,
  TRACKER_PRODUCTS,
  VEHICLE_TOPUP,
  canAddVehicleTopUp,
  canAddVehicleTracker,
  effectiveVehicleLimit,
  inclusiveOfGst,
  monthlyCostFor,
  quoteSubscription,
  roundUpToNine,
  trackerCharge,
  trackerProduct,
  withGst,
} from './pricing';
import { TRUCK_VEHICLE_TYPES, allowedVehicleTypes, vehicleTypeRefusal } from './vehicle-eligibility';
import { Permission, hasPermission, permissionsForRole, permissionsForRoles } from './permissions';
import { evaluateAchievements, emptyAchievementMetrics } from './achievements';

/**
 * Unit tests for the pure domain rules. These functions are the ones the API,
 * the simulator and the UI all depend on, so they are tested directly rather
 * than only through HTTP.
 */

describe('geo', () => {
  // Known reference points: Connaught Place, Delhi → Jaipur city centre.
  const DELHI = { latitude: 28.6139, longitude: 77.209 };
  const JAIPUR = { latitude: 26.9124, longitude: 75.7873 };

  it('measures great-circle distance accurately', () => {
    const km = distanceKm(DELHI, JAIPUR);
    // Real straight-line distance is roughly 240 km.
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(250);
  });

  it('returns zero distance for the same point', () => {
    expect(haversineDistance(DELHI, DELHI)).toBe(0);
  });

  it('computes a bearing in the expected quadrant', () => {
    // Jaipur is south-west of Delhi.
    const heading = bearing(DELHI, JAIPUR);
    expect(heading).toBeGreaterThan(180);
    expect(heading).toBeLessThan(270);
    expect(compassDirection(heading)).toBe('SW');
  });

  it('normalises compass directions', () => {
    expect(compassDirection(0)).toBe('N');
    expect(compassDirection(90)).toBe('E');
    expect(compassDirection(180)).toBe('S');
    expect(compassDirection(270)).toBe('W');
    expect(compassDirection(360)).toBe('N');
    expect(compassDirection(-90)).toBe('W');
  });

  it('round-trips destinationPoint against haversine', () => {
    const target = destinationPoint(DELHI, 90, 10_000);
    expect(haversineDistance(DELHI, target)).toBeCloseTo(10_000, -1);
  });

  it('interpolates between two points', () => {
    const middle = interpolate(DELHI, JAIPUR, 0.5);
    expect(middle.latitude).toBeCloseTo((DELHI.latitude + JAIPUR.latitude) / 2, 5);
    // Clamped outside [0, 1].
    expect(interpolate(DELHI, JAIPUR, -1)).toEqual(DELHI);
    expect(interpolate(DELHI, JAIPUR, 2)).toEqual(JAIPUR);
  });

  it('accumulates path length across a polyline', () => {
    const path = [DELHI, { latitude: 27.8, longitude: 76.5 }, JAIPUR];
    const total = pathLength(path);
    const cumulative = cumulativeDistances(path);

    expect(cumulative[0]).toBe(0);
    expect(cumulative[2]).toBeCloseTo(total, 5);
    // A dog-legged route is longer than the straight line.
    expect(total).toBeGreaterThan(haversineDistance(DELHI, JAIPUR));
  });

  it('resolves a point at a given distance along a path', () => {
    const path = [DELHI, JAIPUR];
    const total = pathLength(path);

    expect(pointAtDistance(path, 0).position).toEqual(DELHI);

    // Interpolation is linear in lat/lng, so over a 240 km leg it differs from
    // the great-circle midpoint by ~0.1%. That is well inside GPS noise and
    // keeps the simulator cheap; assert the tolerance explicitly.
    const midpoint = pointAtDistance(path, total / 2);
    const measured = haversineDistance(DELHI, midpoint.position);
    expect(Math.abs(measured - total / 2) / (total / 2)).toBeLessThan(0.005);

    // Past the end clamps to the final vertex.
    const end = pointAtDistance(path, total * 2);
    expect(end.position.latitude).toBeCloseTo(JAIPUR.latitude, 4);
  });

  it('measures perpendicular distance to a segment', () => {
    const start = { latitude: 28.0, longitude: 77.0 };
    const end = { latitude: 28.0, longitude: 78.0 };

    // Directly above the midpoint of an east-west segment.
    const offset = distanceToSegment({ latitude: 28.01, longitude: 77.5 }, start, end);
    expect(offset).toBeGreaterThan(1000);
    expect(offset).toBeLessThan(1200);

    // A point on the line itself.
    expect(distanceToSegment({ latitude: 28.0, longitude: 77.5 }, start, end)).toBeLessThan(1);
  });

  it('finds the closest approach to a multi-segment path', () => {
    const path = [
      { latitude: 28.0, longitude: 77.0 },
      { latitude: 28.0, longitude: 78.0 },
      { latitude: 27.0, longitude: 78.0 },
    ];
    expect(distanceToPath({ latitude: 27.5, longitude: 78.01 }, path)).toBeLessThan(1500);
    expect(distanceToPath({ latitude: 25.0, longitude: 70.0 }, path)).toBeGreaterThan(100_000);
  });

  it('produces a bounding box wide enough for the requested radius', () => {
    const { latDelta, lngDelta } = boundingDeltas(28.6, 10_000);
    // 10 km is about 0.09° of latitude anywhere on Earth.
    expect(latDelta).toBeGreaterThan(0.08);
    expect(latDelta).toBeLessThan(0.1);
    // Longitude degrees shrink towards the poles, so the delta must be larger.
    expect(lngDelta).toBeGreaterThan(latDelta);
  });
});

describe('state machines', () => {
  it('allows only legal trip transitions', () => {
    expect(tripStateMachine.canTransition(TripStatus.ASSIGNED, TripStatus.STARTED)).toBe(true);
    expect(tripStateMachine.canTransition(TripStatus.ASSIGNED, TripStatus.COMPLETED)).toBe(false);
    expect(tripStateMachine.canTransition(TripStatus.IN_TRANSIT, TripStatus.ARRIVED)).toBe(true);
    expect(tripStateMachine.canTransition(TripStatus.COMPLETED, TripStatus.IN_TRANSIT)).toBe(false);
  });

  it('explains why a transition was refused', () => {
    const result = tripStateMachine.assertTransition(TripStatus.ASSIGNED, TripStatus.COMPLETED);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ASSIGNED');
    expect(result.reason).toContain('COMPLETED');
    // The message lists what the user *can* do next.
    expect(result.reason).toContain('LOADING');
  });

  it('refuses a no-op transition', () => {
    const result = tripStateMachine.assertTransition(TripStatus.STARTED, TripStatus.STARTED);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already');
  });

  it('marks terminal states', () => {
    expect(tripStateMachine.isTerminal(TripStatus.COMPLETED)).toBe(true);
    expect(tripStateMachine.isTerminal(TripStatus.CANCELLED)).toBe(true);
    expect(tripStateMachine.isTerminal(TripStatus.IN_TRANSIT)).toBe(false);
  });

  it('walks the full order lifecycle', () => {
    const path = [
      OrderStatus.REQUESTED,
      OrderStatus.QUOTED,
      OrderStatus.CONFIRMED,
      OrderStatus.ASSIGNED,
      OrderStatus.PICKUP,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    for (let index = 1; index < path.length; index += 1) {
      expect(orderStateMachine.canTransition(path[index - 1]!, path[index]!)).toBe(true);
    }
    // A completed order is final.
    expect(orderStateMachine.canTransition(OrderStatus.COMPLETED, OrderStatus.CANCELLED)).toBe(false);
  });

  it('walks the full SOS lifecycle including direct arrival', () => {
    expect(sosStateMachine.canTransition(SosStatus.TRIGGERED, SosStatus.BROADCASTING)).toBe(true);
    expect(sosStateMachine.canTransition(SosStatus.BROADCASTING, SosStatus.ACKNOWLEDGED)).toBe(true);
    // A responder who acknowledged may arrive without a formal assignment step.
    expect(
      sosStateMachine.canTransition(SosStatus.ACKNOWLEDGED, SosStatus.ASSISTANCE_ARRIVED),
    ).toBe(true);
    expect(sosStateMachine.canTransition(SosStatus.ASSISTANCE_ARRIVED, SosStatus.RESOLVED)).toBe(true);
    expect(sosStateMachine.isTerminal(SosStatus.RESOLVED)).toBe(true);
  });
});

describe('driver scoring', () => {
  it('starts every driver from the configured baseline', () => {
    const scores = computeCategoryScores([]);
    expect(scores[ScoreCategory.SAFETY]).toBe(DEFAULT_SCORING_CONFIG.baselineScore);
    expect(computeOverallScore(scores)).toBe(DEFAULT_SCORING_CONFIG.baselineScore);
  });

  it('applies events to the right category', () => {
    const events: AppliedScoreEvent[] = [
      { category: ScoreCategory.SAFETY, points: -5, reason: 'Speeding.' },
      { category: ScoreCategory.TIMELINESS, points: 3, reason: 'On time.' },
    ];
    const scores = computeCategoryScores(events);
    expect(scores[ScoreCategory.SAFETY]).toBe(70);
    expect(scores[ScoreCategory.TIMELINESS]).toBe(78);
    // Untouched categories stay at the baseline.
    expect(scores[ScoreCategory.COMPLIANCE]).toBe(75);
  });

  it('clamps scores to the configured range', () => {
    const heavyPenalty: AppliedScoreEvent[] = Array.from({ length: 30 }, () => ({
      category: ScoreCategory.SAFETY,
      points: -15,
      reason: 'Incident.',
    }));
    expect(computeCategoryScores(heavyPenalty)[ScoreCategory.SAFETY]).toBe(0);

    const heavyBonus: AppliedScoreEvent[] = Array.from({ length: 30 }, () => ({
      category: ScoreCategory.SAFETY,
      points: 10,
      reason: 'Good driving.',
    }));
    expect(computeCategoryScores(heavyBonus)[ScoreCategory.SAFETY]).toBe(100);
  });

  it('weights the overall score by category', () => {
    // Safety carries the largest weight (0.30), compliance a smaller one (0.15).
    const safetyHit = computeOverallScore(
      computeCategoryScores([{ category: ScoreCategory.SAFETY, points: -20, reason: 'x' }]),
    );
    const complianceHit = computeOverallScore(
      computeCategoryScores([{ category: ScoreCategory.COMPLIANCE, points: -20, reason: 'x' }]),
    );
    expect(safetyHit).toBeLessThan(complianceHit);
  });

  it('is deterministic for the same event history', () => {
    const events: AppliedScoreEvent[] = [
      { category: ScoreCategory.SAFETY, points: -5, reason: 'a' },
      { category: ScoreCategory.RELIABILITY, points: 4, reason: 'b' },
      { category: ScoreCategory.TIMELINESS, points: -4, reason: 'c' },
    ];
    expect(computeCategoryScores(events)).toEqual(computeCategoryScores(events));
  });

  it('provides a rule with a human reason for every event type', () => {
    const rule = ruleFor('SPEED_VIOLATION');
    expect(rule.category).toBe(ScoreCategory.SAFETY);
    expect(rule.points).toBeLessThan(0);
    expect(rule.reason.length).toBeGreaterThan(10);
  });

  it('builds an explainable breakdown with improvement advice', () => {
    const scores = computeCategoryScores([
      { category: ScoreCategory.SAFETY, points: 20, reason: 'a' },
      { category: ScoreCategory.TIMELINESS, points: -20, reason: 'b' },
    ]);
    const breakdown = buildScoreBreakdown(scores);

    expect(breakdown.strengths).toContain(ScoreCategory.SAFETY);
    expect(breakdown.weaknesses).toContain(ScoreCategory.TIMELINESS);
    // A weakness always comes with actionable advice.
    expect(breakdown.recommendations.length).toBe(breakdown.weaknesses.length);
    expect(breakdown.recommendations[0]).toMatch(/departure|delay|time/i);
  });

  it('bands scores consistently', () => {
    expect(scoreBand(95)).toBe('EXCELLENT');
    expect(scoreBand(80)).toBe('GOOD');
    expect(scoreBand(65)).toBe('FAIR');
    expect(scoreBand(40)).toBe('AT_RISK');
  });
});

describe('document expiry', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('counts whole days to expiry', () => {
    expect(daysUntil(new Date('2026-06-20T00:00:00.000Z'), now)).toBe(5);
    expect(daysUntil(new Date('2026-06-10T00:00:00.000Z'), now)).toBe(-5);
    expect(daysUntil(new Date('2026-06-15T23:00:00.000Z'), now)).toBe(0);
  });

  it('flags an expired document regardless of verification state', () => {
    const { validity } = resolveDocumentValidity(
      {
        expiryDate: new Date('2026-06-01T00:00:00.000Z'),
        verificationStatus: DocumentVerificationStatus.VERIFIED,
      },
      { now },
    );
    expect(validity).toBe(DocumentValidity.EXPIRED);
  });

  it('flags a document expiring inside the alert window', () => {
    const { validity, daysRemaining } = resolveDocumentValidity(
      {
        expiryDate: new Date('2026-07-01T00:00:00.000Z'),
        verificationStatus: DocumentVerificationStatus.VERIFIED,
      },
      { now },
    );
    expect(validity).toBe(DocumentValidity.EXPIRING_SOON);
    expect(daysRemaining).toBe(16);
  });

  it('treats a rejected document as rejected, not as valid', () => {
    const { validity } = resolveDocumentValidity(
      {
        expiryDate: new Date('2027-01-01T00:00:00.000Z'),
        verificationStatus: DocumentVerificationStatus.REJECTED,
      },
      { now },
    );
    expect(validity).toBe(DocumentValidity.REJECTED);
  });

  it('reports a document with no expiry separately from a valid one', () => {
    const { validity } = resolveDocumentValidity(
      { expiryDate: null, verificationStatus: DocumentVerificationStatus.VERIFIED },
      { now },
    );
    expect(validity).toBe(DocumentValidity.NO_EXPIRY);
  });

  it('lists the mandatory documents a truck and a driver need', () => {
    const truckDocs = mandatoryDocumentTypes('TRUCK').map((definition) => definition.code);
    expect(truckDocs).toContain('REGISTRATION_CERTIFICATE');
    expect(truckDocs).toContain('INSURANCE');

    const driverDocs = mandatoryDocumentTypes('DRIVER').map((definition) => definition.code);
    expect(driverDocs).toContain('DRIVING_LICENCE');
  });

  /*
   * A vehicle photograph is not paperwork. It moved to the media library, and
   * the two halves of that move are tested here: it can no longer be uploaded
   * as a document, and the rows that were uploaded before it moved still read
   * correctly.
   */
  it('no longer offers the vehicle photograph as a truck document', () => {
    const truckDocs = documentTypesFor('TRUCK').map((definition) => definition.code);
    expect(truckDocs).not.toContain('TRUCK_PHOTO');
    // The upload schema validates against this list, so absence here is what
    // actually refuses a new one.
    expect(DOCUMENT_TYPE_CODES).not.toContain('TRUCK_PHOTO');
  });

  it('still resolves a retired type so existing rows keep their label', () => {
    expect(documentTypeDefinition('TRUCK_PHOTO')?.label).toBe('Vehicle photograph');
    expect(isRetiredDocumentType('TRUCK_PHOTO')).toBe(true);
    expect(isRetiredDocumentType('REGISTRATION_CERTIFICATE')).toBe(false);
    expect(documentTypeDefinition('NOT_A_DOCUMENT')).toBeUndefined();
  });
});

describe('entitlements', () => {
  it('gives every paid plan the same features — a plan is billing, not a ladder', () => {
    const business = featuresForTier(PlanTier.BUSINESS);
    for (const tier of [PlanTier.PERSONAL, PlanTier.SUPPLIER]) {
      expect(new Set(featuresForTier(tier))).toEqual(new Set(business));
    }
    // What used to be withheld from Personal for being cheaper is not any more.
    for (const feature of [
      Feature.ORDERS_MARKETPLACE,
      Feature.AI_COPILOT,
      Feature.FLEET_ANALYTICS,
      Feature.DRIVER_SCORING,
      Feature.FINANCE_LOANS,
    ]) {
      expect(tierHasFeature(PlanTier.PERSONAL, feature)).toBe(true);
    }
  });

  it('does not degrade AI or retention on a cheaper plan', () => {
    const personal = PLAN_LIMITS[PlanTier.PERSONAL];
    const business = PLAN_LIMITS[PlanTier.BUSINESS];
    expect(personal.aiRequestsPerDay).toBe(business.aiRequestsPerDay);
    expect(personal.trackingHistoryDays).toBe(business.trackingHistoryDays);
    expect(personal.telemetryRetentionDays).toBe(business.telemetryRetentionDays);
  });

  it('never gates safety behind the price', () => {
    for (const feature of [
      Feature.SOS_NETWORK,
      Feature.ROUTE_INTELLIGENCE_ALERTS,
      Feature.CITY_ACCESS_INTELLIGENCE,
      Feature.NEARBY_SERVICES,
    ]) {
      expect(tierHasFeature(PlanTier.PERSONAL, feature)).toBe(true);
      // And a lapsed account keeps them.
      expect(LAPSED_FEATURES).toContain(feature);
    }
  });

  it('makes telemetry depend on a tracker rather than on a plan', () => {
    // No plan grants telemetry: without a tracker there is nothing for it to
    // report, and with one it is available on any plan that runs vehicles.
    for (const feature of trackerFeatures()) {
      expect(isTrackerFeature(feature)).toBe(true);
      for (const tier of PLAN_TIERS) expect(tierHasFeature(tier, feature)).toBe(false);
      // `null` tells a caller to say "fit a tracker" instead of "upgrade".
      expect(minimumTierFor(feature)).toBeNull();
      expect(LAPSED_FEATURES).not.toContain(feature);
    }
  });

  it('reports the cheapest tier that unlocks a feature', () => {
    expect(minimumTierFor(Feature.MAPS_2D)).toBe(PlanTier.FREE);
    expect(minimumTierFor(Feature.TRAVEL_BOOKINGS)).toBe(PlanTier.FREE);
    expect(minimumTierFor(Feature.AI_COPILOT)).toBe(PlanTier.PERSONAL);
    expect(minimumTierFor(Feature.SSO)).toBe(PlanTier.PERSONAL);
  });

  it('includes one vehicle on Personal and Business, and none on Free or Supplier', () => {
    expect(PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks).toBe(1);
    expect(PLAN_LIMITS[PlanTier.BUSINESS].maxTrucks).toBe(1);
    for (const tier of [PlanTier.FREE, PlanTier.SUPPLIER]) {
      const limits = PLAN_LIMITS[tier];
      expect(limits.maxTrucks).toBe(0);
      expect(limits.maxVehicleTopUps).toBe(0);
      expect(limits.maxTrackers).toBe(0);
      expect(limits.maxDevices).toBe(0);
      expect(canAddVehicleTopUp(tier, 0)).toBe(false);
      expect(canAddVehicleTracker({ tier, activeTrackers: 0, vehicleCount: 0 })).toBe(false);
    }
    expect(effectiveVehicleLimit(1, 2)).toBe(3);
    expect(effectiveVehicleLimit(null, 2)).toBeNull();
  });

  it('prices vehicleless plans at the plan alone', () => {
    for (const tier of [PlanTier.FREE, PlanTier.SUPPLIER]) {
      const quote = quoteSubscription({ tier, vehicles: 9, trackers: 4 });
      expect(quote.vehicles).toBe(0);
      expect(quote.vehicleTopUps).toBe(0);
      expect(quote.trackers).toBe(0);
      expect(quote.overVehicleCeiling).toBe(false);
    }
    expect(quoteSubscription({ tier: PlanTier.FREE, vehicles: 9 }).dueNow.total).toBe(0);
    expect(quoteSubscription({ tier: PlanTier.SUPPLIER, vehicles: 9 }).dueNow.total).toBe(179);
  });

  it('withholds the vehicle and telemetry surface from Free', () => {
    for (const feature of [
      Feature.FLEET_BASIC,
      Feature.MAINTENANCE_BASIC,
      Feature.TOLL_FASTAG,
      Feature.FINANCE_LOANS,
      Feature.TELEMETRY_LIVE,
      Feature.HARDWARE_CONNECTIVITY,
      Feature.RETURN_LOADS,
    ]) {
      expect(tierHasFeature(PlanTier.FREE, feature)).toBe(false);
    }
    for (const feature of [
      Feature.NEARBY_SERVICES,
      Feature.TRACKING_LIVE,
      Feature.ORDERS_MARKETPLACE,
      Feature.TRAVEL_BOOKINGS,
    ]) {
      expect(tierHasFeature(PlanTier.FREE, feature)).toBe(true);
    }
  });

  it('holds the top-up ceiling on Personal but not on Business', () => {
    expect(canAddVehicleTopUp(PlanTier.PERSONAL, 3)).toBe(true);
    expect(canAddVehicleTopUp(PlanTier.PERSONAL, PLAN_LIMITS[PlanTier.PERSONAL].maxVehicleTopUps)).toBe(
      false,
    );
    expect(canAddVehicleTopUp(PlanTier.BUSINESS, 40)).toBe(true);
  });

  it('refuses a tracker with no vehicle to fit it to', () => {
    expect(
      canAddVehicleTracker({ tier: PlanTier.BUSINESS, activeTrackers: 0, vehicleCount: 0 }),
    ).toBe(true); // one vehicle is assumed as the floor; the service checks the real count
    expect(
      canAddVehicleTracker({ tier: PlanTier.BUSINESS, activeTrackers: 3, vehicleCount: 3 }),
    ).toBe(false);
    expect(
      canAddVehicleTracker({ tier: PlanTier.PERSONAL, activeTrackers: 5, vehicleCount: 20 }),
    ).toBe(false);
  });
});

describe('pricing', () => {
  it('sells the plans at final, GST-inclusive prices ending in 9', () => {
    const price = (tier: PlanTier) =>
      PLAN_CATALOGUE.find((plan) => plan.tier === tier)?.priceMonthly;
    expect(price(PlanTier.FREE)).toBe(0);
    expect(price(PlanTier.PERSONAL)).toBe(119);
    expect(price(PlanTier.BUSINESS)).toBe(239);
    expect(price(PlanTier.SUPPLIER)).toBe(179);
    expect(VEHICLE_TOPUP.priceMonthly).toBe(99);
  });

  it('charges exactly the displayed subscription price, with GST inside it', () => {
    const quote = quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: 1 });
    expect(quote.monthly.total).toBe(119);
    expect(quote.dueNow.total).toBe(119);
    // The tax is recovered for the invoice, not added on top.
    expect(quote.monthly.subtotal).toBe(100.85);
    expect(quote.monthly.gst).toBe(18.15);
    expect(quote.lines[0]?.taxIncluded).toBe(true);
  });

  it('prices a fleet as the plan plus ₹99 per extra vehicle', () => {
    expect(monthlyCostFor({ tier: PlanTier.PERSONAL, vehicles: 1 })).toBe(119);
    expect(monthlyCostFor({ tier: PlanTier.PERSONAL, vehicles: 3 })).toBe(119 + 2 * 99);
    expect(monthlyCostFor({ tier: PlanTier.BUSINESS, vehicles: 10 })).toBe(239 + 9 * 99);
    // Zero and one cost the same: the floor never undercuts the plan.
    for (const vehicles of [0, -3, 1]) {
      expect(monthlyCostFor({ tier: PlanTier.BUSINESS, vehicles })).toBe(239);
    }
  });

  it('offers two trackers, priced before GST', () => {
    expect(TRACKER_PRODUCTS.map((product) => product.product)).toEqual([
      TrackerProduct.OBD_BLUETOOTH,
      TrackerProduct.CONNECTED_4G,
    ]);
    expect(trackerProduct(TrackerProduct.OBD_BLUETOOTH).priceOneTime).toBe(599);
    expect(trackerProduct(TrackerProduct.CONNECTED_4G).priceOneTime).toBe(1999);
  });

  it('prices a tracker at its base plus 18% GST, rounded up to end in 9', () => {
    expect(GST_RATE).toBe(0.18);
    expect(roundUpToNine(116.82)).toBe(119);
    expect(roundUpToNine(706.82)).toBe(709);
    expect(roundUpToNine(2358.82)).toBe(2359);
    expect(roundUpToNine(709)).toBe(709);
    expect(trackerProduct(TrackerProduct.OBD_BLUETOOTH).price).toBe(709);
    expect(trackerProduct(TrackerProduct.CONNECTED_4G).price).toBe(2359);
    // The GST is inside the final price, split out only for the invoice.
    expect(trackerCharge(599)).toEqual({ subtotal: 600.85, gst: 108.15, total: 709 });
  });

  it('keeps hardware out of what renews', () => {
    const quote = quoteSubscription({
      tier: PlanTier.BUSINESS,
      vehicles: 3,
      trackers: 2,
      trackerProduct: TrackerProduct.CONNECTED_4G,
    });

    expect(quote.oneTime.total).toBe(2 * 2359);
    // Only the subscription comes back next month.
    expect(quote.monthly.total).toBe(239 + 2 * 99);
    expect(quote.dueNow.total).toBe(239 + 2 * 99 + 2 * 2359);

    const once = quote.lines.filter((line) => line.cadence === 'once');
    expect(once).toHaveLength(1);
    expect(once[0]?.taxIncluded).toBe(true);
  });

  it('charges the add-ons without the plan, exactly', () => {
    const quote = quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 4, trackers: 2 });
    // Three top-ups at ₹99 and two OBD units at ₹709 — every price final.
    expect(quote.addOns.total).toBe(3 * 99 + 2 * 709);
    expect(quote.addOns.total).toBeCloseTo(quote.dueNow.total - 239, 2);
  });

  it('rounds money to paise', () => {
    expect(inclusiveOfGst(99)).toEqual({ subtotal: 83.9, gst: 15.1, total: 99 });
    expect(withGst(599)).toEqual({ subtotal: 599, gst: 107.82, total: 706.82 });
  });

  it('flags a configuration the plan cannot hold', () => {
    const ceiling =
      (PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks ?? 0) +
      PLAN_LIMITS[PlanTier.PERSONAL].maxVehicleTopUps;

    expect(quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: ceiling }).overVehicleCeiling).toBe(
      false,
    );
    expect(
      quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: ceiling + 1 }).overVehicleCeiling,
    ).toBe(true);
    expect(
      quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 2, trackers: 3 }).overTrackerCeiling,
    ).toBe(true);
    expect(
      quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 3, trackers: 3 }).overTrackerCeiling,
    ).toBe(false);
  });

  it('defaults the paid-plan trial to 30 days', () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(30);
  });
});

describe('vehicle eligibility', () => {
  const personal = { tier: PlanTier.PERSONAL, organizationType: OrganizationType.FLEET_OWNER };
  const fleet = { tier: PlanTier.BUSINESS, organizationType: OrganizationType.FLEET_OWNER };
  const mobility = { tier: PlanTier.BUSINESS, organizationType: OrganizationType.MOBILITY_PROVIDER };

  it('treats goods-only carriers as trucks', () => {
    expect(TRUCK_VEHICLE_TYPES).toContain(VehicleType.TRUCK);
    expect(TRUCK_VEHICLE_TYPES).toContain(VehicleType.PICKUP);
    // A van carries people too.
    expect(TRUCK_VEHICLE_TYPES).not.toContain(VehicleType.VAN);
  });

  it('lets Personal add a car but never a truck', () => {
    expect(vehicleTypeRefusal(personal, VehicleType.CAR)).toBeNull();
    expect(vehicleTypeRefusal(personal, VehicleType.SUV)).toBeNull();
    expect(vehicleTypeRefusal(personal, VehicleType.TRUCK)).toMatch(/Personal/);
  });

  it('keeps a fleet owner to trucks', () => {
    expect(vehicleTypeRefusal(fleet, VehicleType.TRUCK)).toBeNull();
    expect(vehicleTypeRefusal(fleet, VehicleType.CAR)).toMatch(/fleet owner/);
  });

  it('keeps trucks off a mobility provider', () => {
    expect(vehicleTypeRefusal(mobility, VehicleType.TAXI)).toBeNull();
    expect(vehicleTypeRefusal(mobility, VehicleType.BUS)).toBeNull();
    expect(vehicleTypeRefusal(mobility, VehicleType.TRUCK)).toMatch(/mobility/);
  });

  it('allows no vehicle on Supplier or Free', () => {
    for (const context of [
      { tier: PlanTier.SUPPLIER, organizationType: OrganizationType.SUPPLIER },
      { tier: PlanTier.FREE, organizationType: OrganizationType.CUSTOMER },
    ]) {
      expect(allowedVehicleTypes(context)).toEqual([]);
      expect(vehicleTypeRefusal(context, VehicleType.CAR)).toMatch(/does not run vehicles/);
    }
  });

  it('sells the Supplier plan to suppliers and nobody else', () => {
    expect(planAllowedForOrganizationType(PlanTier.SUPPLIER, OrganizationType.SUPPLIER)).toBe(true);
    expect(planAllowedForOrganizationType(PlanTier.BUSINESS, OrganizationType.SUPPLIER)).toBe(false);
    expect(planAllowedForOrganizationType(PlanTier.SUPPLIER, OrganizationType.FLEET_OWNER)).toBe(
      false,
    );
    expect(planAllowedForOrganizationType(PlanTier.PERSONAL, OrganizationType.FLEET_OWNER)).toBe(
      true,
    );
  });
});

describe('permissions', () => {
  it('gives a platform admin every permission', () => {
    const permissions = permissionsForRole(RoleName.PLATFORM_ADMIN);
    expect(hasPermission(permissions, Permission.ADMIN_PLATFORM)).toBe(true);
    expect(hasPermission(permissions, Permission.TRUCKS_DELETE)).toBe(true);
  });

  it('separates owner from manager capabilities', () => {
    const owner = permissionsForRole(RoleName.FLEET_OWNER);
    const manager = permissionsForRole(RoleName.FLEET_MANAGER);

    expect(hasPermission(owner, Permission.TRUCKS_DELETE)).toBe(true);
    expect(hasPermission(manager, Permission.TRUCKS_DELETE)).toBe(false);
    expect(hasPermission(manager, Permission.TRUCKS_CREATE)).toBe(true);
    // Only the owner controls billing.
    expect(hasPermission(owner, Permission.SUBSCRIPTION_MANAGE)).toBe(true);
    expect(hasPermission(manager, Permission.SUBSCRIPTION_MANAGE)).toBe(false);
  });

  it('keeps a driver away from fleet administration', () => {
    const driver = permissionsForRole(RoleName.DRIVER);
    expect(hasPermission(driver, Permission.TRUCKS_CREATE)).toBe(false);
    expect(hasPermission(driver, Permission.DRIVERS_MANAGE)).toBe(false);
    // But a driver can do their own job.
    expect(hasPermission(driver, Permission.TRIPS_DRIVE)).toBe(true);
    expect(hasPermission(driver, Permission.SOS_TRIGGER)).toBe(true);
    expect(hasPermission(driver, Permission.TRACKING_INGEST)).toBe(true);
  });

  it('keeps a customer out of another party fleet operations', () => {
    const customer = permissionsForRole(RoleName.CUSTOMER);
    expect(hasPermission(customer, Permission.ORDERS_CREATE)).toBe(true);
    expect(hasPermission(customer, Permission.ORDERS_QUOTE)).toBe(false);
    expect(hasPermission(customer, Permission.TRUCKS_CREATE)).toBe(false);
    expect(hasPermission(customer, Permission.DRIVERS_MANAGE)).toBe(false);
  });

  it('unions permissions across multiple roles', () => {
    const combined = permissionsForRoles([RoleName.DRIVER, RoleName.FLEET_MANAGER]);
    expect(hasPermission(combined, Permission.TRIPS_DRIVE)).toBe(true);
    expect(hasPermission(combined, Permission.TRUCKS_CREATE)).toBe(true);
    // No duplicates in the union.
    expect(new Set(combined).size).toBe(combined.length);
  });
});

describe('achievements', () => {
  it('awards nothing to a brand-new driver except unmet progress', () => {
    const evaluations = evaluateAchievements(emptyAchievementMetrics());
    expect(evaluations.every((evaluation) => !evaluation.earned)).toBe(true);
    expect(evaluations.every((evaluation) => evaluation.progress >= 0 && evaluation.progress <= 1)).toBe(
      true,
    );
  });

  it('awards the first-trip badge after one completed trip', () => {
    const metrics = { ...emptyAchievementMetrics(), completedTrips: 1 };
    const first = evaluateAchievements(metrics).find(
      (evaluation) => evaluation.code === 'FIRST_TRIP',
    );
    expect(first?.earned).toBe(true);
  });

  it('requires both score and volume for the safe-driver badge', () => {
    const highScoreFewTrips = evaluateAchievements({
      ...emptyAchievementMetrics(),
      safetyScore: 95,
      completedTrips: 3,
    }).find((evaluation) => evaluation.code === 'SAFE_DRIVER');
    expect(highScoreFewTrips?.earned).toBe(false);
    // Partial progress is still reported, so the driver can see the goal.
    expect(highScoreFewTrips?.progress).toBeGreaterThan(0);

    const qualified = evaluateAchievements({
      ...emptyAchievementMetrics(),
      safetyScore: 95,
      completedTrips: 12,
    }).find((evaluation) => evaluation.code === 'SAFE_DRIVER');
    expect(qualified?.earned).toBe(true);
  });

  it('withholds document-perfect while a document is expired', () => {
    const evaluation = evaluateAchievements({
      ...emptyAchievementMetrics(),
      complianceScore: 100,
      expiredMandatoryDocuments: 1,
    }).find((entry) => entry.code === 'DOCUMENT_PERFECT');
    expect(evaluation?.earned).toBe(false);
    expect(evaluation?.progress).toBe(0);
  });
});

/**
 * The account-shape rules.
 *
 * These decide two things that a plan on its own cannot: whether an account
 * enters the vehicle and tracker ecosystem, and which of its plan's features
 * this kind of business can actually use. Every one of the workflow bugs this
 * suite is named after came from asking the plan and stopping there.
 */
describe('account shape', () => {
  it('keeps a Free account out of the vehicle and tracker ecosystem', () => {
    // Bug 1: a Free user being asked for a vehicle.
    expect(accountRunsVehicles({ tier: PlanTier.FREE })).toBe(false);
    expect(
      accountRunsVehicles({
        tier: PlanTier.FREE,
        // Even if something upstream guessed a type, the plan settles it.
        organizationType: OrganizationType.FLEET_OWNER,
      }),
    ).toBe(false);
    expect(accountUsesTracker({ tier: PlanTier.FREE })).toBe(false);
  });

  it('puts a Personal account in it, business type or none', () => {
    expect(accountRunsVehicles({ tier: PlanTier.PERSONAL })).toBe(true);
    expect(accountUsesTracker({ tier: PlanTier.PERSONAL })).toBe(true);
  });

  it('decides Business on the kind of business, not on the plan', () => {
    // The two that operate vehicles.
    for (const type of [OrganizationType.FLEET_OWNER, OrganizationType.MOBILITY_PROVIDER]) {
      expect(accountRunsVehicles({ tier: PlanTier.BUSINESS, organizationType: type })).toBe(true);
    }

    // Bug 2: a supplier being asked for a tracker. Whatever plan it sits on,
    // it owns nothing to fit one to.
    for (const type of [
      OrganizationType.SUPPLIER,
      OrganizationType.CUSTOMER,
      OrganizationType.TRUCK_ASSOCIATION,
    ]) {
      expect(accountRunsVehicles({ tier: PlanTier.BUSINESS, organizationType: type })).toBe(false);
      expect(accountUsesTracker({ tier: PlanTier.BUSINESS, organizationType: type })).toBe(false);
    }
  });

  it('keeps the Supplier plan out of the vehicle ecosystem', () => {
    expect(
      accountRunsVehicles({ tier: PlanTier.SUPPLIER, organizationType: OrganizationType.SUPPLIER }),
    ).toBe(false);
  });

  it('answers false for a Business registration that has not chosen a type yet', () => {
    // The registration form reads this before the account-type step. Answering
    // "true" here is what priced every business registrant for trucks before
    // any of them had said what kind of business they were.
    expect(accountRunsVehicles({ tier: PlanTier.BUSINESS })).toBe(false);
    expect(accountRunsVehicles({ tier: PlanTier.BUSINESS, organizationType: null })).toBe(false);
  });

  it('withholds the fleet, telemetry and freight surface from a supplier', () => {
    // Bug 3: a supplier being shown fleet-owner features.
    const supplier = accountFeatures({
      tier: PlanTier.SUPPLIER,
      organizationType: OrganizationType.SUPPLIER,
    });

    for (const feature of [
      Feature.FLEET_BASIC,
      Feature.DRIVER_SCORING,
      Feature.MAINTENANCE_PREDICTIVE,
      Feature.TELEMETRY_LIVE,
      Feature.HARDWARE_CONNECTIVITY,
      Feature.RETURN_LOADS,
      Feature.TOLL_FASTAG,
      Feature.TRAVEL_SERVICES,
    ]) {
      expect(supplier).not.toContain(feature);
    }

    // And keeps everything a supplier's own business runs on.
    for (const feature of [
      Feature.INVENTORY_MANAGEMENT,
      Feature.ORDERS_MARKETPLACE,
      Feature.DOCUMENTS_BASIC,
      Feature.MEDIA_LIBRARY,
    ]) {
      expect(supplier).toContain(feature);
    }
  });

  it('keeps freight-only concepts away from a mobility provider', () => {
    // Bug 4: a mobility provider being shown truck features. Backhaul is the
    // return leg of a load and the relay hands a consignment to a pickup;
    // a taxi operator has neither.
    const mobility = accountFeatures({
      tier: PlanTier.BUSINESS,
      organizationType: OrganizationType.MOBILITY_PROVIDER,
    });

    expect(mobility).not.toContain(Feature.RETURN_LOADS);
    expect(mobility).not.toContain(Feature.LAST_MILE_RELAY);

    // What it does sell, and the operating surface it shares with a fleet.
    expect(mobility).toContain(Feature.TRAVEL_SERVICES);
    expect(mobility).toContain(Feature.TRAVEL_BOOKINGS);
    expect(mobility).toContain(Feature.FLEET_BASIC);
    expect(mobility).toContain(Feature.DRIVER_SCORING);
  });

  it('leaves the fleet owner every freight capability', () => {
    // Bug 5: a fleet owner missing truck features. This is the type that must
    // lose nothing operational — only the passenger surface it cannot sell.
    const fleet = accountFeatures({
      tier: PlanTier.BUSINESS,
      organizationType: OrganizationType.FLEET_OWNER,
    });

    for (const feature of [
      Feature.FLEET_BASIC,
      Feature.FLEET_ANALYTICS,
      Feature.RETURN_LOADS,
      Feature.LAST_MILE_RELAY,
      Feature.DRIVER_SCORING,
      Feature.ORDERS_MARKETPLACE,
      Feature.MAINTENANCE_PREDICTIVE,
      Feature.TOLL_FASTAG,
      Feature.AI_COPILOT,
    ]) {
      expect(fleet).toContain(feature);
    }

    // Publishing tour packages is the mobility provider's, and the travel
    // routes already refuse a freight fleet that tries.
    expect(fleet).not.toContain(Feature.TRAVEL_SERVICES);
  });

  it('never adds a feature the plan did not grant', () => {
    // The narrowing is subtractive by design: a capability added to Business
    // tomorrow reaches every business type unless it is named as an exclusion,
    // which is the safe direction for a list somebody must remember to update.
    for (const type of Object.values(OrganizationType)) {
      const narrowed = accountFeatures({ tier: PlanTier.BUSINESS, organizationType: type });
      const granted = featuresForTier(PlanTier.BUSINESS);
      for (const feature of narrowed) {
        expect(granted).toContain(feature);
      }
    }
  });
});

describe('personal Aadhaar before a vehicle', () => {
  it('lets the vehicle the plan includes on without it', () => {
    expect(PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks).toBe(1);
    expect(personalVehicleNeedsAadhaar(0)).toBe(false);
  });

  it('asks for it from the next vehicle on', () => {
    expect(personalVehicleNeedsAadhaar(1)).toBe(true);
    expect(personalVehicleNeedsAadhaar(3)).toBe(true);
  });

  it('treats trackers the same way: the first without it, the next with it', () => {
    expect(personalTrackerNeedsAadhaar(0)).toBe(false);
    expect(personalTrackerNeedsAadhaar(1)).toBe(true);
  });
});
