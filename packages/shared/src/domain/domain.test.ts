import { describe, expect, it } from 'vitest';
import {
  DocumentValidity,
  DocumentVerificationStatus,
  OrderStatus,
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
import { daysUntil, mandatoryDocumentTypes, resolveDocumentValidity } from './documents';
import { Feature, featuresForTier, minimumTierFor, tierHasFeature } from './entitlements';
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
});

describe('entitlements', () => {
  it('grants progressively more features up the tiers', () => {
    const basic = featuresForTier(PlanTier.BASIC);
    const pro = featuresForTier(PlanTier.PRO);
    const intelligence = featuresForTier(PlanTier.INTELLIGENCE);

    expect(pro.length).toBeGreaterThan(basic.length);
    expect(intelligence.length).toBeGreaterThan(pro.length);
    // Every Basic feature survives into Pro.
    for (const feature of basic) expect(pro).toContain(feature);
  });

  it('gates premium features correctly', () => {
    expect(tierHasFeature(PlanTier.BASIC, Feature.MAPS_2D)).toBe(true);
    expect(tierHasFeature(PlanTier.BASIC, Feature.MAPS_3D)).toBe(false);
    expect(tierHasFeature(PlanTier.BASIC, Feature.AI_COPILOT)).toBe(false);
    expect(tierHasFeature(PlanTier.PRO, Feature.DRIVER_SCORING)).toBe(true);
    expect(tierHasFeature(PlanTier.PRO, Feature.AI_COPILOT)).toBe(false);
    expect(tierHasFeature(PlanTier.INTELLIGENCE, Feature.AI_COPILOT)).toBe(true);
    expect(tierHasFeature(PlanTier.ENTERPRISE, Feature.API_ACCESS)).toBe(true);
  });

  it('reports the cheapest tier that unlocks a feature', () => {
    expect(minimumTierFor(Feature.MAPS_2D)).toBe(PlanTier.BASIC);
    expect(minimumTierFor(Feature.DRIVER_SCORING)).toBe(PlanTier.PRO);
    expect(minimumTierFor(Feature.AI_COPILOT)).toBe(PlanTier.INTELLIGENCE);
    expect(minimumTierFor(Feature.SSO)).toBe(PlanTier.ENTERPRISE);
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
