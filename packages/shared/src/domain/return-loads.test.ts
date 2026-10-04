import { describe, expect, it } from 'vitest';
import { PlanTier, TripLegType, TripStatus } from './enums';
import { backhaulUnavailableReason, type BackhaulTripFacts } from './return-loads';

describe('backhaul offer on a completed trip', () => {
  const completedBusinessTrip: BackhaulTripFacts = {
    planTier: PlanTier.BUSINESS,
    hasReturnLoads: true,
    tripStatus: TripStatus.COMPLETED,
    legType: TripLegType.PRIMARY,
    adHoc: false,
    acceptsReturnLoads: true,
  };

  it('is offered on a completed outbound trip of a Business-plan fleet', () => {
    expect(backhaulUnavailableReason(completedBusinessTrip)).toBeNull();
  });

  it('is kept to the Business plan', () => {
    for (const planTier of [PlanTier.FREE, PlanTier.PERSONAL, PlanTier.SUPPLIER, null]) {
      expect(backhaulUnavailableReason({ ...completedBusinessTrip, planTier })).toMatch(
        /Business plan/,
      );
    }
    // A Business plan narrowed to an account type without freight features.
    expect(backhaulUnavailableReason({ ...completedBusinessTrip, hasReturnLoads: false })).toMatch(
      /Business plan/,
    );
  });

  it('waits for the trip to complete', () => {
    for (const tripStatus of [TripStatus.IN_TRANSIT, TripStatus.ARRIVED, TripStatus.CANCELLED]) {
      expect(backhaulUnavailableReason({ ...completedBusinessTrip, tripStatus })).not.toBeNull();
    }
  });

  it('is never offered on a service run or on a return leg', () => {
    expect(backhaulUnavailableReason({ ...completedBusinessTrip, adHoc: true })).not.toBeNull();
    expect(
      backhaulUnavailableReason({ ...completedBusinessTrip, legType: TripLegType.RETURN }),
    ).toMatch(/already a return leg/);
  });

  it('respects a vehicle the owner opted out of return loads', () => {
    expect(
      backhaulUnavailableReason({ ...completedBusinessTrip, acceptsReturnLoads: false }),
    ).toMatch(/not to accept return loads/);
  });
});
