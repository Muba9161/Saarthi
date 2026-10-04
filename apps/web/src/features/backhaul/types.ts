import type { ReturnLoadStatus } from '@saarthi/shared';
import type { BoardRequirement, SellerMatch } from '@/lib/api-types';

/** A return-load request, as `/return-loads` returns it. */
export interface ReturnLoadView {
  id: string;
  reference: string;
  truckId: string;
  truckRegistration: string | null;
  outboundTripId: string | null;
  status: ReturnLoadStatus;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  availableFrom: string;
  availableUntil: string;
  capacityTons: number;
  detourToleranceKm: number;
  matchCount: number;
  matchedOrderId: string | null;
}

/** `GET /return-loads/trips/:id` — backhaul on one completed trip. */
export interface BackhaulOffer {
  tripId: string;
  /** Why "Enable backhaul" is not offered, or null when it is. */
  unavailableReason: string | null;
  commission: { rate: number; ruleVersion: string; ordinaryRate: number };
  request: ReturnLoadView | null;
}

/** A customer requirement on the way home, with sellers near the truck. */
export interface BackhaulRequirement extends BoardRequirement {
  backhaul: {
    score: number;
    detourKm: number;
    emptyKmSaved: number;
    sellerDistanceKm: number;
    reasons: string[];
    sellers: SellerMatch[];
  };
}
