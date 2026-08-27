import { describe, expect, it } from 'vitest';
import {
  CityAccessRecommendation,
  CityRestrictionKind,
  MaterialAvailabilityMode,
  MaterialUnit,
  QrScope,
  RouteHazardKind,
  RouteHazardSource,
  RouteHazardTier,
  SignalPhase,
  StockAvailabilityStatus,
  StockMovementType,
  TruckType,
  VehicleType,
} from './enums';
import {
  aggregateStock,
  computeAvailability,
  movementDelta,
  resolveUnitPrice,
  validateOrderQuantity,
} from './inventory';
import {
  ScannerRelationship,
  defaultScopesFor,
  publicResolveDefaultFor,
  resolveGrantedScopes,
  shortTokenLabel,
} from './qr';
import { QrSubjectType } from './enums';
import {
  computeProfileCompletion,
  isFieldFilled,
  ProfileAudience,
  profileBlueprint,
  resolveProfileAudience,
} from './profiles';
import { RoleName, OrganizationType } from './enums';
import {
  computeDetourKm,
  computeDirectionAlignment,
  emptyKilometresSaved,
  findHardBlockers,
  matchReturnLoads,
  scoreReturnLoad,
  type ReturnLoadDemand,
  type ReturnLoadSupply,
} from './return-loads';
import {
  checkCityAccess,
  estimateRelayPrice,
  isLastMileCapable,
  isPointInPolygon,
  isWithinWindow,
  rankTransferHubs,
  type CityRestrictionRule,
  type VehicleAccessProfile,
} from './city-access';
import {
  applyVote,
  decayConfidence,
  decimatePath,
  hazardsAhead,
  hazardsOnRoute,
  initialConfidence,
  isHazardActiveNow,
  isSpeedViolation,
  predictSignalPhase,
  shouldPromote,
  shouldRetire,
} from './route-intelligence';
import { checkListingPublishGates, offerDiscountPercent, vehicleAgeYears } from './resale';
import { isMediaPurposeValidForOwner, mediaCacheControl, mediaPurposeDefinition } from './media';
import { MediaOwnerType, MediaPurpose, MediaVisibility } from './enums';

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('inventory availability', () => {
  const base = {
    onHandQuantity: 100,
    reservedQuantity: 0,
    incomingQuantity: 0,
    damagedQuantity: 0,
    lowStockThreshold: 10,
    allowBackorder: false,
    availabilityMode: MaterialAvailabilityMode.IN_STOCK,
    stockTracked: true,
  };

  it('subtracts reserved and damaged from on-hand', () => {
    const result = computeAvailability({ ...base, reservedQuantity: 30, damagedQuantity: 5 });
    expect(result.availableQuantity).toBe(65);
    expect(result.sellableQuantity).toBe(65);
    expect(result.status).toBe(StockAvailabilityStatus.IN_STOCK);
  });

  it('never reports a negative available quantity', () => {
    const result = computeAvailability({ ...base, onHandQuantity: 5, reservedQuantity: 40 });
    expect(result.availableQuantity).toBe(0);
    expect(result.orderable).toBe(false);
  });

  it('counts incoming stock only when backorder is allowed', () => {
    const without = computeAvailability({ ...base, onHandQuantity: 0, incomingQuantity: 50 });
    expect(without.sellableQuantity).toBe(0);
    expect(without.status).toBe(StockAvailabilityStatus.OUT_OF_STOCK);

    const with_ = computeAvailability({
      ...base,
      onHandQuantity: 0,
      incomingQuantity: 50,
      allowBackorder: true,
    });
    expect(with_.sellableQuantity).toBe(50);
    expect(with_.status).toBe(StockAvailabilityStatus.IN_STOCK);
  });

  it('flags low stock at or below the threshold', () => {
    expect(computeAvailability({ ...base, onHandQuantity: 10 }).status).toBe(
      StockAvailabilityStatus.LOW_STOCK,
    );
    expect(computeAvailability({ ...base, onHandQuantity: 11 }).status).toBe(
      StockAvailabilityStatus.IN_STOCK,
    );
  });

  it('ignores stock entirely for made-to-order and on-request items', () => {
    const madeToOrder = computeAvailability({
      ...base,
      onHandQuantity: 0,
      availabilityMode: MaterialAvailabilityMode.MADE_TO_ORDER,
    });
    expect(madeToOrder.status).toBe(StockAvailabilityStatus.MADE_TO_ORDER);
    expect(madeToOrder.orderable).toBe(true);

    const onRequest = computeAvailability({
      ...base,
      onHandQuantity: 0,
      availabilityMode: MaterialAvailabilityMode.ON_REQUEST,
    });
    expect(onRequest.status).toBe(StockAvailabilityStatus.ON_REQUEST);
    expect(onRequest.orderable).toBe(true);
  });

  it('reproduces the legacy hand-edited behaviour when tracking is off', () => {
    const result = computeAvailability({
      ...base,
      stockTracked: false,
      onHandQuantity: 999,
      reservedQuantity: 999,
      legacyAvailableQuantity: 42,
    });
    // The ledger columns are ignored entirely — the typed number is the truth.
    expect(result.availableQuantity).toBe(42);
    expect(result.sellableQuantity).toBe(42);
    expect(result.status).toBe(StockAvailabilityStatus.IN_STOCK);
  });
});

describe('stock movement deltas', () => {
  it('keeps a reservation off the physical balance', () => {
    expect(movementDelta(StockMovementType.RESERVE, 10)).toEqual({
      onHand: 0,
      reserved: 10,
      incoming: 0,
      damaged: 0,
    });
  });

  it('removes goods and clears the hold on consumption', () => {
    expect(movementDelta(StockMovementType.CONSUME, 10)).toEqual({
      onHand: -10,
      reserved: -10,
      incoming: 0,
      damaged: 0,
    });
  });

  it('treats a receipt as positive regardless of the sign passed', () => {
    expect(movementDelta(StockMovementType.RECEIPT, -10).onHand).toBe(10);
  });

  it('keeps adjustments signed so a correction can go either way', () => {
    expect(movementDelta(StockMovementType.ADJUSTMENT, -7).onHand).toBe(-7);
    expect(movementDelta(StockMovementType.ADJUSTMENT, 7).onHand).toBe(7);
  });

  it('reconciles a randomised movement sequence against the running balance', () => {
    // Reserve/release/consume are the sequence that historically drifts, so
    // this walks a realistic mix and checks the ledger against the aggregate.
    const sequence: Array<[StockMovementType, number]> = [
      [StockMovementType.OPENING_BALANCE, 500],
      [StockMovementType.RECEIPT, 120],
      [StockMovementType.RESERVE, 80],
      [StockMovementType.RESERVE, 40],
      [StockMovementType.RELEASE, 40],
      [StockMovementType.CONSUME, 80],
      [StockMovementType.DAMAGE, 15],
      [StockMovementType.ADJUSTMENT, -5],
      [StockMovementType.TRANSFER_OUT, 100],
      [StockMovementType.TRANSFER_IN, 30],
    ];

    let onHand = 0;
    let reserved = 0;
    let damaged = 0;
    for (const [type, quantity] of sequence) {
      const delta = movementDelta(type, quantity);
      onHand += delta.onHand;
      reserved += delta.reserved;
      damaged += delta.damaged;
    }

    expect(onHand).toBe(500 + 120 - 80 - 5 - 100 + 30);
    expect(reserved).toBe(0);
    expect(damaged).toBe(15);
  });
});

describe('stock aggregation and pricing', () => {
  it('sums positions across locations', () => {
    const total = aggregateStock([
      { onHandQuantity: 10, reservedQuantity: 2, incomingQuantity: 0, damagedQuantity: 1 },
      { onHandQuantity: 5.5, reservedQuantity: 0, incomingQuantity: 3, damagedQuantity: 0 },
    ]);
    expect(total).toEqual({
      onHandQuantity: 15.5,
      reservedQuantity: 2,
      incomingQuantity: 3,
      damagedQuantity: 1,
    });
  });

  it('applies the highest tier the quantity qualifies for', () => {
    const tiers = [
      { minQuantity: 10, pricePerUnit: 950 },
      { minQuantity: 50, pricePerUnit: 900 },
      { minQuantity: 100, pricePerUnit: 850 },
    ];
    expect(resolveUnitPrice(1000, tiers, 5).pricePerUnit).toBe(1000);
    expect(resolveUnitPrice(1000, tiers, 10).pricePerUnit).toBe(950);
    expect(resolveUnitPrice(1000, tiers, 75).pricePerUnit).toBe(900);
    expect(resolveUnitPrice(1000, tiers, 500).pricePerUnit).toBe(850);
  });
});

describe('order quantity validation', () => {
  const availability = computeAvailability({
    onHandQuantity: 40,
    reservedQuantity: 0,
    incomingQuantity: 0,
    damagedQuantity: 0,
    lowStockThreshold: 5,
    allowBackorder: false,
    availabilityMode: MaterialAvailabilityMode.IN_STOCK,
    stockTracked: true,
  });

  it('accepts a quantity within stock and order limits', () => {
    expect(
      validateOrderQuantity(availability, {
        quantity: 20,
        minimumOrderQty: 1,
        unit: MaterialUnit.TON,
      }),
    ).toBeNull();
  });

  it('rejects a quantity above what is sellable', () => {
    const problem = validateOrderQuantity(availability, {
      quantity: 60,
      minimumOrderQty: 1,
      unit: MaterialUnit.TON,
    });
    expect(problem).toContain('40');
  });

  it('enforces the minimum and maximum order quantities', () => {
    expect(
      validateOrderQuantity(availability, {
        quantity: 2,
        minimumOrderQty: 5,
        unit: MaterialUnit.TON,
      }),
    ).toContain('minimum');
    expect(
      validateOrderQuantity(availability, {
        quantity: 30,
        minimumOrderQty: 1,
        maximumOrderQty: 25,
        unit: MaterialUnit.TON,
      }),
    ).toContain('maximum');
  });
});

// ---------------------------------------------------------------------------
// QR scoping
// ---------------------------------------------------------------------------

describe('QR scope resolution', () => {
  const codeScopes = defaultScopesFor(QrSubjectType.DRIVER);

  it('gives a driver code its full scope set inside the fleet', () => {
    const granted = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.SAME_ORGANIZATION,
      emergencyContextActive: true,
    });
    expect(granted).toContain(QrScope.DRIVER_SUMMARY);
    expect(granted).toContain(QrScope.EMERGENCY);
  });

  it('gives a stranger the roadside verification set and nothing operational', () => {
    const granted = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.SIGNED_IN_STRANGER,
    });

    // What a checkpoint needs: who this is, the vehicle, the person, and
    // whether the paperwork is current.
    expect(granted).toContain(QrScope.IDENTITY);
    expect(granted).toContain(QrScope.VEHICLE_SUMMARY);
    expect(granted).toContain(QrScope.DRIVER_SUMMARY);
    expect(granted).toContain(QrScope.COMPLIANCE);

    // What it does not: how to reach the driver, their medical data, or who is
    // assigned to what.
    expect(granted).not.toContain(QrScope.CONTACT);
    expect(granted).not.toContain(QrScope.EMERGENCY);
    expect(granted).not.toContain(QrScope.ASSIGNMENT);
  });

  it('gives an anonymous scanner no more than a signed-in stranger', () => {
    const anonymous = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.ANONYMOUS,
    });
    const stranger = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.SIGNED_IN_STRANGER,
    });

    // Signing in must never *narrow* a result. The two ceilings share one list
    // precisely so this cannot drift; the assertion is here to catch a future
    // edit that splits them again.
    expect(anonymous).toEqual(stranger);
  });

  it('keeps a printed subject able to answer for both halves of a check', () => {
    // A driver card resolves the vehicle too, and a cab-door sticker resolves
    // the driver — one scan, one answer, whichever code the officer finds
    // first.
    expect(defaultScopesFor(QrSubjectType.DRIVER)).toContain(QrScope.VEHICLE_SUMMARY);
    expect(defaultScopesFor(QrSubjectType.VEHICLE)).toContain(QrScope.DRIVER_SUMMARY);
  });

  it('opts printed subjects into public resolution, and nothing else', () => {
    expect(publicResolveDefaultFor(QrSubjectType.DRIVER)).toBe(true);
    expect(publicResolveDefaultFor(QrSubjectType.VEHICLE)).toBe(true);

    // An order or trip code is an internal handle that happens to render as a
    // QR. One of those answering to a passer-by would be a leak.
    expect(publicResolveDefaultFor(QrSubjectType.ORDER)).toBe(false);
    expect(publicResolveDefaultFor(QrSubjectType.TRIP)).toBe(false);
    expect(publicResolveDefaultFor(QrSubjectType.INVENTORY_LOCATION)).toBe(false);
  });

  it('withholds emergency data from a responder with no active incident', () => {
    const granted = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.EMERGENCY_RESPONDER,
      emergencyContextActive: false,
    });
    expect(granted).not.toContain(QrScope.EMERGENCY);
  });

  it('releases emergency data to a responder on an active incident', () => {
    const granted = resolveGrantedScopes({
      codeScopes,
      relationship: ScannerRelationship.EMERGENCY_RESPONDER,
      emergencyContextActive: true,
    });
    expect(granted).toContain(QrScope.EMERGENCY);
  });

  it('never widens beyond what the code itself carries', () => {
    const granted = resolveGrantedScopes({
      codeScopes: [QrScope.IDENTITY],
      relationship: ScannerRelationship.SAME_ORGANIZATION,
      emergencyContextActive: true,
    });
    expect(granted).toEqual([QrScope.IDENTITY]);
  });

  it('gives a transacting partner compliance but not contact details', () => {
    const granted = resolveGrantedScopes({
      codeScopes: defaultScopesFor(QrSubjectType.VEHICLE),
      relationship: ScannerRelationship.TRANSACTING_PARTNER,
      handoverContextActive: true,
    });
    expect(granted).toContain(QrScope.COMPLIANCE);
    expect(granted).not.toContain(QrScope.CONTACT);
  });

  it('requires a live leg before granting the handover capability', () => {
    const granted = resolveGrantedScopes({
      codeScopes: [QrScope.HANDOVER],
      relationship: ScannerRelationship.RELAY_PARTNER,
      handoverContextActive: false,
    });
    expect(granted).toEqual([]);
  });

  it('formats a readable fallback label', () => {
    expect(shortTokenLabel('abcdefgh12345678')).toBe('ABCD-EFGH');
  });
});

// ---------------------------------------------------------------------------
// Profile completion
// ---------------------------------------------------------------------------

describe('profile completion', () => {
  const sections = profileBlueprint(ProfileAudience.DRIVER);

  it('treats blank and empty values as unfilled', () => {
    expect(isFieldFilled('   ')).toBe(false);
    expect(isFieldFilled([])).toBe(false);
    expect(isFieldFilled(null)).toBe(false);
    expect(isFieldFilled(0)).toBe(true);
    expect(isFieldFilled(false)).toBe(true);
  });

  it('scores an empty profile at zero and lists what is missing', () => {
    const result = computeProfileCompletion(sections, {});
    expect(result.percent).toBe(0);
    expect(result.nextBestAction).not.toBeNull();
    expect(result.completedSections).toEqual([]);
  });

  it('scores a fully populated profile at 100', () => {
    const values: Record<string, unknown> = {};
    for (const section of sections) {
      for (const field of section.fields) {
        values[`${section.key}.${field.key}`] = 'filled';
      }
    }
    expect(computeProfileCompletion(sections, values).percent).toBe(100);
  });

  it('points the next action at the heaviest incomplete section', () => {
    const result = computeProfileCompletion(sections, {});
    // Licence carries the highest weight in the driver blueprint.
    expect(result.nextBestAction?.sectionKey).toBe('licence');
  });

  it('marks a section complete once its required fields are present', () => {
    const values: Record<string, unknown> = { 'photo.avatar': 'media-id' };
    const result = computeProfileCompletion(sections, values);
    expect(result.completedSections).toContain('photo');
    expect(result.percent).toBeGreaterThan(0);
    expect(result.percent).toBeLessThan(100);
  });
});

describe('profile audience resolution', () => {
  it('prefers the driver blueprint for a driver inside a fleet', () => {
    expect(
      resolveProfileAudience({
        roles: [RoleName.DRIVER],
        membershipRole: RoleName.DRIVER,
        organizationType: OrganizationType.FLEET_OWNER,
      }),
    ).toBe(ProfileAudience.DRIVER);
  });

  it('falls back to organization type when no role decides it', () => {
    expect(
      resolveProfileAudience({ roles: [], organizationType: OrganizationType.MOBILITY_PROVIDER }),
    ).toBe(ProfileAudience.MOBILITY);
  });

  it('gives a fleet owner the fleet blueprint', () => {
    expect(resolveProfileAudience({ roles: [RoleName.FLEET_OWNER] })).toBe(ProfileAudience.FLEET);
  });
});

// ---------------------------------------------------------------------------
// Return loads
// ---------------------------------------------------------------------------

describe('return-load matching', () => {
  // Bengaluru -> Delhi outbound: the truck is free in Delhi and wants Bengaluru.
  const delhi = { latitude: 28.6139, longitude: 77.209 };
  const bengaluru = { latitude: 12.9716, longitude: 77.5946 };
  const jaipur = { latitude: 26.9124, longitude: 75.7873 };
  const chennai = { latitude: 13.0827, longitude: 80.2707 };

  const supply: ReturnLoadSupply = {
    freePoint: delhi,
    homePoint: bengaluru,
    availableFrom: new Date('2026-09-01T08:00:00Z'),
    availableUntil: new Date('2026-09-03T08:00:00Z'),
    capacityTons: 20,
    truckType: TruckType.OPEN_BODY,
    detourToleranceKm: 300,
    acceptsPartialLoad: true,
    minimumPrice: null,
  };

  const homewardLoad: ReturnLoadDemand = {
    orderId: 'homeward',
    origin: delhi,
    destination: bengaluru,
    requiredCapacityTons: 18,
    requiredTruckType: null,
    pickupAt: new Date('2026-09-01T10:00:00Z'),
    deliverBy: new Date('2026-09-04T10:00:00Z'),
    price: 90_000,
    customerRating: 4.6,
  };

  it('reports no detour for a load running exactly homeward', () => {
    expect(computeDetourKm(supply, homewardLoad)).toBe(0);
  });

  it('aligns a homeward load at 1 and a reverse load at -1', () => {
    expect(computeDirectionAlignment(supply, homewardLoad)).toBeCloseTo(1, 2);
    expect(
      computeDirectionAlignment(supply, {
        ...homewardLoad,
        origin: bengaluru,
        destination: delhi,
      }),
    ).toBeCloseTo(-1, 2);
  });

  it('scores a perfect homeward load highly', () => {
    const score = scoreReturnLoad(supply, homewardLoad);
    expect(score.score).toBeGreaterThan(85);
    expect(score.reasons.length).toBeGreaterThan(3);
  });

  it('blocks a load that exceeds the payload', () => {
    const blocker = findHardBlockers(supply, { ...homewardLoad, requiredCapacityTons: 30 });
    expect(blocker).toContain('30');
  });

  it('blocks a load needing a different body type', () => {
    expect(
      findHardBlockers(supply, { ...homewardLoad, requiredTruckType: TruckType.TANKER }),
    ).toContain('tanker');
  });

  it('blocks a pickup beyond the search radius', () => {
    expect(findHardBlockers(supply, { ...homewardLoad, origin: chennai })).toContain('radius');
  });

  it('blocks a load whose detour exceeds the tolerance', () => {
    // A Delhi -> Chennai load overshoots Bengaluru substantially.
    const blocker = findHardBlockers(
      { ...supply, detourToleranceKm: 50 },
      { ...homewardLoad, destination: chennai },
    );
    expect(blocker).toContain('detour');
  });

  it('blocks a collection time outside the availability window', () => {
    expect(
      findHardBlockers(supply, {
        ...homewardLoad,
        pickupAt: new Date('2026-09-20T10:00:00Z'),
      }),
    ).toContain('after');
  });

  it('rejects a price below the stated minimum', () => {
    expect(findHardBlockers({ ...supply, minimumPrice: 100_000 }, homewardLoad)).toContain(
      'minimum',
    );
  });

  it('ranks a homeward load above a sideways one', () => {
    const sideways: ReturnLoadDemand = {
      ...homewardLoad,
      orderId: 'sideways',
      destination: jaipur,
      requiredCapacityTons: 8,
    };
    const { matches } = matchReturnLoads(supply, [sideways, homewardLoad], { minScore: 0 });
    expect(matches[0]?.orderId).toBe('homeward');
  });

  it('separates impossible loads from merely low-scoring ones', () => {
    const impossible: ReturnLoadDemand = {
      ...homewardLoad,
      orderId: 'impossible',
      requiredCapacityTons: 99,
    };
    const { matches, rejected } = matchReturnLoads(supply, [homewardLoad, impossible], {
      minScore: 0,
    });
    expect(matches).toHaveLength(1);
    expect(rejected[0]?.orderId).toBe('impossible');
    expect(rejected[0]?.reason).toContain('99');
  });

  it('scores monotonically as the pickup gets further away', () => {
    const near = scoreReturnLoad(supply, homewardLoad).score;
    const far = scoreReturnLoad(supply, {
      ...homewardLoad,
      origin: { latitude: 27.5, longitude: 77.0 },
    }).score;
    expect(near).toBeGreaterThan(far);
  });

  it('reports the empty kilometres a match avoids', () => {
    expect(emptyKilometresSaved(supply, homewardLoad)).toBeGreaterThan(1500);
  });
});

// ---------------------------------------------------------------------------
// City access
// ---------------------------------------------------------------------------

describe('time window matching', () => {
  it('handles a normal daytime window', () => {
    expect(isWithinWindow(9 * 60, 6 * 60, 22 * 60)).toBe(true);
    expect(isWithinWindow(23 * 60, 6 * 60, 22 * 60)).toBe(false);
  });

  it('handles a window that crosses midnight', () => {
    // 22:00 to 06:00 — the classic case a naive comparison gets backwards.
    expect(isWithinWindow(23 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isWithinWindow(2 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isWithinWindow(12 * 60, 22 * 60, 6 * 60)).toBe(false);
  });

  it('treats a null window as always in force', () => {
    expect(isWithinWindow(3 * 60, null, null)).toBe(true);
  });
});

describe('point in polygon', () => {
  const square = [
    [77.0, 12.0],
    [78.0, 12.0],
    [78.0, 13.0],
    [77.0, 13.0],
  ];

  it('detects a point inside', () => {
    expect(isPointInPolygon({ latitude: 12.5, longitude: 77.5 }, square)).toBe(true);
  });

  it('detects a point outside', () => {
    expect(isPointInPolygon({ latitude: 14, longitude: 77.5 }, square)).toBe(false);
  });

  it('refuses a degenerate ring', () => {
    expect(isPointInPolygon({ latitude: 12.5, longitude: 77.5 }, [[77, 12]])).toBe(false);
  });
});

describe('city access check', () => {
  const drop = { latitude: 12.9716, longitude: 77.5946 };

  const heavyTruck: VehicleAccessProfile = {
    vehicleType: VehicleType.TRUCK,
    truckType: TruckType.MULTI_AXLE,
    capacityTons: 25,
    heightMetres: 4.1,
    axles: 4,
    permits: [],
  };

  const baseRule: CityRestrictionRule = {
    id: 'rule-1',
    name: 'Bengaluru core no-entry (heavy goods)',
    kind: CityRestrictionKind.TIME_WINDOW,
    city: 'Bengaluru',
    state: 'Karnataka',
    center: drop,
    radiusKm: 10,
    polygon: null,
    vehicleTypes: [],
    truckTypes: [],
    minCapacityTons: 12,
    maxHeightMetres: null,
    maxAxles: null,
    daysOfWeek: [],
    startTimeMinutes: 6 * 60,
    endTimeMinutes: 22 * 60,
    permitAuthority: 'BBMP',
    permitUrl: null,
    penaltyNote: null,
    effectiveFrom: null,
    effectiveTo: null,
    active: true,
  };

  it('allows entry outside the restricted window', () => {
    const result = checkCityAccess(drop, heavyTruck, [baseRule], {
      at: new Date('2026-09-01T23:30:00'),
    });
    expect(result.recommendation).toBe(CityAccessRecommendation.ALLOWED);
    // The rule still matched, so the dispatcher is told it exists.
    expect(result.restrictions).toHaveLength(1);
  });

  it('recommends waiting when the window closes soon enough', () => {
    const result = checkCityAccess(drop, heavyTruck, [baseRule], {
      at: new Date('2026-09-01T20:00:00'),
      maxWaitMinutes: 240,
    });
    expect(result.recommendation).toBe(CityAccessRecommendation.WAIT_FOR_WINDOW);
    expect(result.enterAfterMinutes).toBe(120);
    expect(result.requiresLastMile).toBe(false);
  });

  it('recommends a relay when the wait is longer than the delivery can bear', () => {
    const result = checkCityAccess(drop, heavyTruck, [baseRule], {
      at: new Date('2026-09-01T08:00:00'),
      maxWaitMinutes: 60,
    });
    expect(result.recommendation).toBe(CityAccessRecommendation.RELAY);
    expect(result.requiresLastMile).toBe(true);
  });

  it('recommends a relay for a permanent ban regardless of the hour', () => {
    const permanent: CityRestrictionRule = {
      ...baseRule,
      kind: CityRestrictionKind.NO_ENTRY,
      startTimeMinutes: null,
      endTimeMinutes: null,
    };
    const result = checkCityAccess(drop, heavyTruck, [permanent], {
      at: new Date('2026-09-01T03:00:00'),
    });
    expect(result.recommendation).toBe(CityAccessRecommendation.RELAY);
    expect(result.requiresLastMile).toBe(true);
  });

  it('does not apply a payload rule to a vehicle below its threshold', () => {
    const pickup: VehicleAccessProfile = {
      vehicleType: VehicleType.PICKUP,
      truckType: TruckType.MINI_TRUCK,
      capacityTons: 1.2,
      heightMetres: 2.2,
      axles: 2,
      permits: [],
    };
    const result = checkCityAccess(drop, pickup, [baseRule], {
      at: new Date('2026-09-01T10:00:00'),
    });
    expect(result.restricted).toBe(false);
    expect(result.recommendation).toBe(CityAccessRecommendation.ALLOWED);
  });

  it('ignores a rule whose zone does not contain the drop', () => {
    const faraway: CityRestrictionRule = {
      ...baseRule,
      center: { latitude: 28.6139, longitude: 77.209 },
      radiusKm: 5,
    };
    const result = checkCityAccess(drop, heavyTruck, [faraway], {
      at: new Date('2026-09-01T10:00:00'),
    });
    expect(result.restrictions).toHaveLength(0);
  });

  it('asks for a permit when one is required and not held', () => {
    const permitRule: CityRestrictionRule = {
      ...baseRule,
      kind: CityRestrictionKind.PERMIT_REQUIRED,
      startTimeMinutes: null,
      endTimeMinutes: null,
    };
    const result = checkCityAccess(drop, heavyTruck, [permitRule], {
      at: new Date('2026-09-01T10:00:00'),
    });
    expect(result.recommendation).toBe(CityAccessRecommendation.PERMIT_REQUIRED);
  });

  it('allows entry when the operator holds the required permit', () => {
    const permitRule: CityRestrictionRule = {
      ...baseRule,
      kind: CityRestrictionKind.PERMIT_REQUIRED,
      startTimeMinutes: null,
      endTimeMinutes: null,
    };
    const result = checkCityAccess(
      drop,
      { ...heavyTruck, permits: ['BBMP entry permit 2026'] },
      [permitRule],
      { at: new Date('2026-09-01T10:00:00') },
    );
    expect(result.recommendation).not.toBe(CityAccessRecommendation.PERMIT_REQUIRED);
  });

  it('does not assume a height when none is recorded', () => {
    const heightRule: CityRestrictionRule = {
      ...baseRule,
      kind: CityRestrictionKind.HEIGHT_LIMIT,
      minCapacityTons: null,
      maxHeightMetres: 3.5,
      startTimeMinutes: null,
      endTimeMinutes: null,
    };
    const unknownHeight = { ...heavyTruck, heightMetres: null };
    const result = checkCityAccess(drop, unknownHeight, [heightRule], {
      at: new Date('2026-09-01T10:00:00'),
    });
    // Unchecked rather than assumed either way.
    expect(result.restrictions).toHaveLength(0);
  });
});

describe('last-mile capability and hub ranking', () => {
  it('accepts small vehicles and rejects heavy ones', () => {
    expect(isLastMileCapable(VehicleType.PICKUP, TruckType.MINI_TRUCK, 1.2)).toBe(true);
    expect(isLastMileCapable(VehicleType.TRUCK, TruckType.MULTI_AXLE, 25)).toBe(false);
  });

  it('ranks a close, open hub above a distant one', () => {
    const approach = { latitude: 13.5, longitude: 77.6 };
    const drop = { latitude: 12.9716, longitude: 77.5946 };
    const ranked = rankTransferHubs(
      [
        {
          id: 'near',
          name: 'Nelamangala yard',
          location: { latitude: 13.1, longitude: 77.4 },
          openFromMinutes: 0,
          openToMinutes: null,
          active: true,
          verified: true,
        },
        {
          id: 'far',
          name: 'Tumkur yard',
          location: { latitude: 13.34, longitude: 77.1 },
          openFromMinutes: null,
          openToMinutes: null,
          active: true,
          verified: false,
        },
      ],
      { approachFrom: approach, drop, at: new Date('2026-09-01T10:00:00') },
    );
    expect(ranked[0]?.id).toBe('near');
  });

  it('prices a relay leg from published rates, honouring the minimum', () => {
    const rates = { minimumCharge: 800, perKmRate: 30, perTonRate: 200 };
    expect(estimateRelayPrice(rates, { distanceKm: 5, weightTons: 1 })).toBe(800);
    expect(estimateRelayPrice(rates, { distanceKm: 40, weightTons: 2 })).toBe(1600);
  });
});

// ---------------------------------------------------------------------------
// Route intelligence
// ---------------------------------------------------------------------------

describe('signal phase prediction', () => {
  const reference = new Date('2026-09-01T00:00:00Z');

  it('returns UNKNOWN when the cycle is not modelled', () => {
    const result = predictSignalPhase({
      cycleSeconds: null,
      greenSeconds: null,
      offsetSeconds: null,
      referenceAt: null,
    });
    expect(result.phase).toBe(SignalPhase.UNKNOWN);
    expect(result.secondsToChange).toBeNull();
    // Even the unknown answer is labelled predicted, so the UI cannot show it
    // as a live reading.
    expect(result.predicted).toBe(true);
  });

  it('computes green early in the cycle', () => {
    const result = predictSignalPhase(
      { cycleSeconds: 120, greenSeconds: 60, offsetSeconds: 0, referenceAt: reference },
      new Date('2026-09-01T00:00:10Z'),
    );
    expect(result.phase).toBe(SignalPhase.GREEN);
    expect(result.secondsToChange).toBe(50);
  });

  it('computes red late in the cycle', () => {
    const result = predictSignalPhase(
      { cycleSeconds: 120, greenSeconds: 60, offsetSeconds: 0, referenceAt: reference },
      new Date('2026-09-01T00:01:40Z'),
    );
    expect(result.phase).toBe(SignalPhase.RED);
  });

  it('wraps correctly across many cycles', () => {
    const result = predictSignalPhase(
      { cycleSeconds: 120, greenSeconds: 60, offsetSeconds: 0, referenceAt: reference },
      new Date('2026-09-01T02:00:10Z'),
    );
    expect(result.phase).toBe(SignalPhase.GREEN);
  });

  it('refuses a green longer than the cycle', () => {
    const result = predictSignalPhase({
      cycleSeconds: 60,
      greenSeconds: 90,
      offsetSeconds: 0,
      referenceAt: reference,
    });
    expect(result.phase).toBe(SignalPhase.UNKNOWN);
  });
});

describe('hazard confidence', () => {
  it('starts a driver report below an authority record', () => {
    expect(initialConfidence(RouteHazardSource.DRIVER_REPORT)).toBeLessThan(
      initialConfidence(RouteHazardSource.AUTHORITY),
    );
  });

  it('halves live confidence over one half-life', () => {
    const decayed = decayConfidence({
      confidence: 0.8,
      tier: RouteHazardTier.LIVE,
      source: RouteHazardSource.DRIVER_REPORT,
      lastConfirmedAt: new Date('2026-09-01T00:00:00Z'),
      now: new Date('2026-09-01T00:45:00Z'),
      halfLifeMinutes: 45,
    });
    expect(decayed).toBeCloseTo(0.4, 2);
  });

  it('never decays a static hazard', () => {
    expect(
      decayConfidence({
        confidence: 1,
        tier: RouteHazardTier.STATIC,
        source: RouteHazardSource.PLATFORM,
        lastConfirmedAt: new Date('2020-01-01T00:00:00Z'),
        now: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toBe(1);
  });

  it('never decays an authority-sourced hazard', () => {
    expect(
      decayConfidence({
        confidence: 1,
        tier: RouteHazardTier.LIVE,
        source: RouteHazardSource.AUTHORITY,
        lastConfirmedAt: new Date('2020-01-01T00:00:00Z'),
        now: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toBe(1);
  });

  it('raises confidence on confirmation and drops it on a clearance', () => {
    expect(applyVote({ confidence: 0.4, vote: 'CONFIRM', confirmingOrganizations: 1 })).toBe(0.6);
    expect(applyVote({ confidence: 0.8, vote: 'CLEARED', confirmingOrganizations: 0 })).toBeCloseTo(
      0.3,
      5,
    );
    expect(applyVote({ confidence: 0.8, vote: 'REJECT', confirmingOrganizations: 0 })).toBeCloseTo(
      0.5,
      5,
    );
  });

  it('caps confidence at 1', () => {
    expect(applyVote({ confidence: 0.95, vote: 'CONFIRM', confirmingOrganizations: 3 })).toBe(1);
  });

  it('requires two organizations as well as a threshold to promote', () => {
    expect(shouldPromote(0.9, 1)).toBe(false);
    expect(shouldPromote(0.9, 2)).toBe(true);
    expect(shouldPromote(0.5, 5)).toBe(false);
  });

  it('retires a hazard below the floor', () => {
    expect(shouldRetire(0.1)).toBe(true);
    expect(shouldRetire(0.2)).toBe(false);
  });
});

describe('hazard active windows', () => {
  it('honours a recurring weekday morning pattern', () => {
    const hazard = {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTimeMinutes: 8 * 60,
      endTimeMinutes: 11 * 60,
      validFrom: null,
      validUntil: null,
    };
    // 2026-09-01 is a Tuesday.
    expect(isHazardActiveNow(hazard, new Date('2026-09-01T09:00:00'))).toBe(true);
    expect(isHazardActiveNow(hazard, new Date('2026-09-01T14:00:00'))).toBe(false);
    // 2026-09-06 is a Sunday.
    expect(isHazardActiveNow(hazard, new Date('2026-09-06T09:00:00'))).toBe(false);
  });

  it('respects a validity range', () => {
    const hazard = {
      daysOfWeek: [],
      startTimeMinutes: null,
      endTimeMinutes: null,
      validFrom: new Date('2026-09-01T00:00:00Z'),
      validUntil: new Date('2026-09-02T00:00:00Z'),
    };
    expect(isHazardActiveNow(hazard, new Date('2026-09-01T12:00:00Z'))).toBe(true);
    expect(isHazardActiveNow(hazard, new Date('2026-09-03T12:00:00Z'))).toBe(false);
  });
});

describe('corridor matching', () => {
  const route = [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 13.5, longitude: 77.6 },
    { latitude: 14.5, longitude: 77.7 },
    { latitude: 15.5, longitude: 77.8 },
  ];

  const hazard = (
    id: string,
    latitude: number,
    longitude: number,
    heading: number | null = null,
  ) => ({
    id,
    kind: RouteHazardKind.SPEED_CAMERA,
    location: { latitude, longitude },
    headingDegrees: heading,
    headingToleranceDegrees: 60,
    radiusMeters: 100,
    severity: 'WARNING' as const,
    confidence: 1,
  });

  it('thins a dense polyline', () => {
    const dense = Array.from({ length: 500 }, (_, index) => ({
      latitude: 12.9 + index * 0.00005,
      longitude: 77.5,
    }));
    const thinned = decimatePath(dense, 50);
    expect(thinned.length).toBeLessThan(dense.length);
    // Endpoints are always preserved.
    expect(thinned[0]).toEqual(dense[0]);
    expect(thinned[thinned.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('finds hazards near the line and orders them along the route', () => {
    const matches = hazardsOnRoute(
      route,
      [hazard('far-along', 15.4, 77.79), hazard('near-start', 13.0, 77.596)],
      { corridorMeters: 2000 },
    );
    expect(matches.map((match) => match.hazard.id)).toEqual(['near-start', 'far-along']);
    expect(matches[0]!.distanceAlongRouteKm).toBeLessThan(matches[1]!.distanceAlongRouteKm);
  });

  it('excludes a hazard well off the corridor', () => {
    const matches = hazardsOnRoute(route, [hazard('off-route', 13.5, 80.0)], {
      corridorMeters: 300,
    });
    expect(matches).toHaveLength(0);
  });

  it('excludes a hazard facing the opposite carriageway', () => {
    // The route runs roughly north; a south-facing camera does not apply.
    const matches = hazardsOnRoute(route, [hazard('southbound', 13.0, 77.596, 180)], {
      corridorMeters: 2000,
    });
    expect(matches).toHaveLength(0);
  });

  it('computes an ETA when an average speed is supplied', () => {
    const matches = hazardsOnRoute(route, [hazard('near-start', 13.4, 77.6)], {
      corridorMeters: 5000,
      averageSpeedKph: 50,
    });
    expect(matches[0]?.etaSeconds).toBeGreaterThan(0);
  });

  it('drops hazards below the confidence floor', () => {
    const faint = { ...hazard('faint', 13.0, 77.596), confidence: 0.1 };
    expect(
      hazardsOnRoute(route, [faint], { corridorMeters: 2000, minConfidence: 0.25 }),
    ).toHaveLength(0);
  });
});

describe('live look-ahead', () => {
  const position = { latitude: 12.9716, longitude: 77.5946 };

  const hazard = (id: string, latitude: number, longitude: number) => ({
    id,
    kind: RouteHazardKind.POLICE_CHECKPOINT,
    location: { latitude, longitude },
    headingDegrees: null,
    headingToleranceDegrees: 60,
    radiusMeters: 100,
    severity: 'WARNING' as const,
    confidence: 1,
  });

  it('reports a hazard ahead and ignores one behind', () => {
    // Heading due north.
    const results = hazardsAhead(
      position,
      0,
      [hazard('ahead', 12.9766, 77.5946), hazard('behind', 12.9666, 77.5946)],
      { lookaheadMeters: 1000 },
    );
    expect(results.map((entry) => entry.hazard.id)).toEqual(['ahead']);
  });

  it('orders by distance', () => {
    const results = hazardsAhead(
      position,
      0,
      [hazard('further', 12.9796, 77.5946), hazard('closer', 12.9756, 77.5946)],
      { lookaheadMeters: 2000 },
    );
    expect(results.map((entry) => entry.hazard.id)).toEqual(['closer', 'further']);
  });

  it('does not suppress a hazard the vehicle is almost on top of', () => {
    // 30 m away but off-axis: bearing is noise at that range, so it still alerts.
    const results = hazardsAhead(position, 0, [hazard('imminent', 12.9714, 77.5949)], {
      lookaheadMeters: 800,
    });
    expect(results).toHaveLength(1);
  });

  it('respects the confidence floor', () => {
    const faint = { ...hazard('faint', 12.9766, 77.5946), confidence: 0.1 };
    expect(hazardsAhead(position, 0, [faint], { minConfidence: 0.25 })).toHaveLength(0);
  });
});

describe('speed violation', () => {
  it('returns null rather than a verdict when there is no limit to compare', () => {
    expect(isSpeedViolation(80, null)).toBeNull();
    expect(isSpeedViolation(null, 60)).toBeNull();
  });

  it('allows a small tolerance over the limit', () => {
    expect(isSpeedViolation(62, 60, 5)).toBe(false);
    expect(isSpeedViolation(70, 60, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resale
// ---------------------------------------------------------------------------

describe('listing publish gates', () => {
  const ready = {
    vehicleBelongsToSeller: true,
    vehicleIsVerified: true,
    vehicleOnActiveTrip: false,
    vehicleHasActiveAssignment: false,
    sellerOrganizationVerified: true,
    exteriorPhotoCount: 3,
    hasOdometerPhoto: true,
    askingPrice: 950_000,
    odometerKm: 320_000,
  };

  it('passes a complete listing', () => {
    expect(checkListingPublishGates(ready)).toEqual({ ready: true, blockers: [] });
  });

  it('reports every blocker at once rather than the first', () => {
    const result = checkListingPublishGates({
      ...ready,
      vehicleOnActiveTrip: true,
      vehicleHasActiveAssignment: true,
      exteriorPhotoCount: 1,
      hasOdometerPhoto: false,
      askingPrice: 0,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBe(5);
  });

  it('blocks a vehicle that is not the seller-s', () => {
    const result = checkListingPublishGates({ ...ready, vehicleBelongsToSeller: false });
    expect(result.blockers[0]).toContain('not registered to your organization');
  });

  it('requires the minimum photo set', () => {
    expect(checkListingPublishGates({ ...ready, exteriorPhotoCount: 2 }).ready).toBe(false);
  });
});

describe('resale helpers', () => {
  it('computes the discount an offer represents', () => {
    expect(offerDiscountPercent(1_000_000, 900_000)).toBe(10);
  });

  it('returns null for an unknown manufacture year rather than guessing', () => {
    expect(vehicleAgeYears(null)).toBeNull();
    expect(vehicleAgeYears(2020, new Date('2026-01-01T00:00:00Z'))).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

describe('media purposes', () => {
  it('restricts a purpose to the owners it makes sense for', () => {
    expect(isMediaPurposeValidForOwner(MediaPurpose.AVATAR, MediaOwnerType.USER)).toBe(true);
    expect(isMediaPurposeValidForOwner(MediaPurpose.AVATAR, MediaOwnerType.VEHICLE)).toBe(false);
  });

  it('allows unrestricted purposes on any owner', () => {
    expect(isMediaPurposeValidForOwner(MediaPurpose.GALLERY, MediaOwnerType.TRIP)).toBe(true);
  });

  it('treats an avatar as singular and a gallery as a set', () => {
    expect(mediaPurposeDefinition(MediaPurpose.AVATAR).singular).toBe(true);
    expect(mediaPurposeDefinition(MediaPurpose.GALLERY).singular).toBe(false);
  });

  it('matches cache policy to visibility', () => {
    expect(mediaCacheControl(MediaVisibility.PUBLIC)).toContain('public');
    expect(mediaCacheControl(MediaVisibility.ORGANIZATION)).toContain('private');
    expect(mediaCacheControl(MediaVisibility.PRIVATE)).toContain('no-store');
  });
});
