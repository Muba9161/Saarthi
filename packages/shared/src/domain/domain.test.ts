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
  TripStatus,
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
  GST_RATE,
  PLAN_CATALOGUE,
  PLAN_LIMITS,
  canAddVehicleTopUp,
  canAddVehicleTracker,
  effectiveVehicleLimit,
  featuresForTier,
  isTrackerFeature,
  minimumTierFor,
  monthlyCostFor,
  monthsFreeOnYearly,
  quoteSubscription,
  tierHasFeature,
  trackerFeatures,
} from './entitlements';
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
  it('gives Business everything Personal has, and more', () => {
    const personal = featuresForTier(PlanTier.PERSONAL);
    const business = featuresForTier(PlanTier.BUSINESS);

    expect(business.length).toBeGreaterThan(personal.length);
    // Nothing a Personal customer relies on disappears when they upgrade.
    for (const feature of personal) expect(business).toContain(feature);
  });

  it('keeps the commercial surface out of Personal', () => {
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.MAPS_2D)).toBe(true);
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.FINANCE_LOANS)).toBe(true);
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.ORDERS_MARKETPLACE)).toBe(false);
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.AI_COPILOT)).toBe(false);
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.RETURN_LOADS)).toBe(false);
    expect(tierHasFeature(PlanTier.PERSONAL, Feature.DRIVER_SCORING)).toBe(false);

    expect(tierHasFeature(PlanTier.BUSINESS, Feature.ORDERS_MARKETPLACE)).toBe(true);
    expect(tierHasFeature(PlanTier.BUSINESS, Feature.AI_COPILOT)).toBe(true);
    expect(tierHasFeature(PlanTier.BUSINESS, Feature.API_ACCESS)).toBe(true);
  });

  it('never gates safety behind the price', () => {
    // A plan that withholds an SOS, a hazard warning or a no-entry rule is a
    // plan that lets a paying customer drive into trouble. Asserted rather
    // than left to the catalogue, because it is a product promise.
    for (const feature of [
      Feature.SOS_NETWORK,
      Feature.ROUTE_INTELLIGENCE_ALERTS,
      Feature.CITY_ACCESS_INTELLIGENCE,
      Feature.NEARBY_SERVICES,
    ]) {
      expect(tierHasFeature(PlanTier.PERSONAL, feature)).toBe(true);
    }
  });

  it('sells the telemetry capabilities with hardware rather than with a plan', () => {
    // These read a device wired into the vehicle. No plan can grant them,
    // because without a tracker there is nothing for them to report.
    for (const feature of trackerFeatures()) {
      expect(isTrackerFeature(feature)).toBe(true);
      expect(tierHasFeature(PlanTier.PERSONAL, feature)).toBe(false);
      expect(tierHasFeature(PlanTier.BUSINESS, feature)).toBe(false);
      // `null` is what tells a caller to say "fit a tracker" instead of
      // "upgrade" — advice a Business customer could not act on.
      expect(minimumTierFor(feature)).toBeNull();
    }
  });

  it('reports the cheapest tier that unlocks a feature', () => {
    expect(minimumTierFor(Feature.MAPS_2D)).toBe(PlanTier.PERSONAL);
    expect(minimumTierFor(Feature.SOS_NETWORK)).toBe(PlanTier.PERSONAL);
    expect(minimumTierFor(Feature.DRIVER_SCORING)).toBe(PlanTier.BUSINESS);
    expect(minimumTierFor(Feature.AI_COPILOT)).toBe(PlanTier.BUSINESS);
    expect(minimumTierFor(Feature.SSO)).toBe(PlanTier.BUSINESS);
  });

  it('starts both plans at one vehicle, and sells the rest per vehicle', () => {
    for (const tier of PLAN_TIERS) {
      expect(PLAN_LIMITS[tier].maxTrucks).toBe(1);
    }
    expect(effectiveVehicleLimit(1, 2)).toBe(3);
    // An unlimited base stays unlimited rather than becoming a number.
    expect(effectiveVehicleLimit(null, 2)).toBeNull();
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
      canAddVehicleTracker({ tier: PlanTier.BUSINESS, activeTrackers: 2, vehicleCount: 3 }),
    ).toBe(true);
    // Personal's own ceiling binds before the vehicle count does.
    expect(
      canAddVehicleTracker({ tier: PlanTier.PERSONAL, activeTrackers: 5, vehicleCount: 20 }),
    ).toBe(false);
  });

  it('prices a fleet as the plan plus one top-up per extra vehicle', () => {
    const personal = PLAN_CATALOGUE.find((plan) => plan.tier === PlanTier.PERSONAL);
    expect(personal?.priceMonthly).toBe(99);

    // One vehicle is the plan alone.
    expect(monthlyCostFor({ tier: PlanTier.PERSONAL, vehicles: 1 })).toBe(99);
    // Three vehicles is the plan plus two top-ups.
    expect(monthlyCostFor({ tier: PlanTier.PERSONAL, vehicles: 3 })).toBe(99 + 2 * 75);
    expect(monthlyCostFor({ tier: PlanTier.BUSINESS, vehicles: 10 })).toBe(199 + 9 * 75);
    // Zero and one cost the same: there is no such thing as a plan with no
    // vehicle allowance, so the floor must not price below the plan.
    expect(monthlyCostFor({ tier: PlanTier.BUSINESS, vehicles: 0 })).toBe(199);
  });

  it('itemises a configuration, keeping hardware out of what renews', () => {
    // Three vehicles and two trackers on Personal: the plan, two top-ups and
    // two one-time tracker charges.
    const quote = quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: 3, trackers: 2 });

    expect(quote.vehicleTopUps).toBe(2);
    expect(quote.monthly.subtotal).toBe(99 + 2 * 75);
    expect(quote.oneTime.subtotal).toBe(2 * 499);
    // The first invoice is both halves together...
    expect(quote.dueNow.subtotal).toBe(99 + 2 * 75 + 2 * 499);
    // ...but only the recurring half comes back next month. A tracker folded
    // into the renewal figure would overstate the bill by a thousand rupees a
    // month, which is the kind of wrong a customer notices once and never
    // forgives.
    expect(quote.renews.subtotal).toBe(99 + 2 * 75);

    const once = quote.lines.filter((line) => line.cadence === 'once');
    expect(once).toHaveLength(1);
    expect(once[0]?.amount).toBe(2 * 499);
  });

  it('adds GST at 18% and totals what will actually be charged', () => {
    const quote = quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: 3, trackers: 2 });

    expect(quote.gstRate).toBe(0.18);
    expect(GST_RATE).toBe(0.18);

    const subtotal = 99 + 2 * 75 + 2 * 499;
    expect(quote.dueNow.subtotal).toBe(subtotal);
    expect(quote.dueNow.gst).toBeCloseTo(subtotal * 0.18, 2);
    expect(quote.dueNow.total).toBeCloseTo(subtotal * 1.18, 2);

    // Every bucket carries its own tax, so no surface has to work one out.
    for (const totals of [quote.recurring, quote.monthly, quote.oneTime, quote.addOns, quote.dueNow, quote.renews]) {
      expect(totals.gst).toBeCloseTo(totals.subtotal * 0.18, 2);
      expect(totals.total).toBeCloseTo(totals.subtotal + totals.gst, 2);
    }
  });

  it('charges the add-ons without the plan, exactly', () => {
    /*
     * What signup takes: the top-ups and trackers, not the plan, which is on
     * trial. Asserted against its own arithmetic rather than against
     * `dueNow - plan`, because that subtraction is the bug this field exists
     * to prevent — it would be a rupee out whenever rounding fell badly.
     */
    const quote = quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 4, trackers: 2 });

    const addOnSubtotal = 3 * 75 + 2 * 499;
    expect(quote.addOns.subtotal).toBe(addOnSubtotal);
    expect(quote.addOns.total).toBeCloseTo(addOnSubtotal * 1.18, 2);
    // And it really is the invoice minus the plan, to the paisa.
    expect(quote.addOns.subtotal).toBeCloseTo(quote.dueNow.subtotal - 199, 2);
  });

  it('rounds money to paise rather than leaving a float in a charge', () => {
    // 99 × 0.18 = 17.82 exactly; a float would offer 17.819999999999999.
    const quote = quoteSubscription({ tier: PlanTier.PERSONAL, vehicles: 1 });
    expect(quote.dueNow.gst).toBe(17.82);
    expect(quote.dueNow.total).toBe(116.82);

    // Every figure that could reach a payment intent is at most two decimals.
    for (const totals of [quote.recurring, quote.monthly, quote.oneTime, quote.addOns, quote.dueNow]) {
      for (const amount of [totals.subtotal, totals.gst, totals.total]) {
        expect(Math.round(amount * 100)).toBe(amount * 100);
      }
    }
  });

  it('prices a yearly commitment as ten months, on the plan and every vehicle', () => {
    const quote = quoteSubscription({
      tier: PlanTier.BUSINESS,
      vehicles: 4,
      trackers: 1,
      billing: 'yearly',
    });

    expect(quote.recurring.subtotal).toBe(1990 + 3 * 750);
    expect(quote.monthly.subtotal).toBeCloseTo((1990 + 3 * 750) / 12, 2);
    // Charged once means once, whichever period the plan is billed on.
    expect(quote.oneTime.subtotal).toBe(499);
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

    // More trackers than vehicles is hardware with nothing to fit it to.
    expect(
      quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 2, trackers: 3 }).overTrackerCeiling,
    ).toBe(true);
    expect(
      quoteSubscription({ tier: PlanTier.BUSINESS, vehicles: 3, trackers: 3 }).overTrackerCeiling,
    ).toBe(false);
  });

  it('never prices below the plan, whatever it is asked for', () => {
    // Zero and one vehicle cost the same: there is no such thing as a plan with
    // no vehicle allowance, so the floor must not undercut the plan itself.
    for (const vehicles of [0, -3, 1]) {
      const quote = quoteSubscription({ tier: PlanTier.PERSONAL, vehicles });
      expect(quote.vehicles).toBe(1);
      expect(quote.vehicleTopUps).toBe(0);
      expect(quote.monthly.subtotal).toBe(99);
    }
  });

  it('agrees with monthlyCostFor, which quotes the pre-tax figure', () => {
    for (const tier of PLAN_TIERS) {
      for (const vehicles of [1, 2, 5]) {
        for (const billing of ['monthly', 'yearly'] as const) {
          expect(quoteSubscription({ tier, vehicles, billing }).monthly.subtotal).toBeCloseTo(
            monthlyCostFor({ tier, vehicles, billing }),
            2,
          );
        }
      }
    }
  });

  it('advertises a yearly discount only when every price agrees on it', () => {
    // Two months free, from the real figures rather than from copy.
    expect(monthsFreeOnYearly()).toBe(2);
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
