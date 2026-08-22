/**
 * Vehicle resale marketplace rules.
 *
 * What separates this from a classifieds board is that the vehicle is already on
 * Saarthi: its odometer, service history, fuel economy, compliance documents and
 * incident record are records the platform holds, not claims the seller types.
 * The listing therefore ships with an *evidence pack* assembled from those
 * records — and every block of it is something the seller can decline to share,
 * which then reads as "not shared by the seller" rather than a fabricated value.
 */

import { VehicleCondition, VehicleListingStatus, VehicleListingVisibility } from './enums';

// ---------------------------------------------------------------------------
// Publish gates
// ---------------------------------------------------------------------------

/**
 * Minimum photo requirements before a listing may be published.
 *
 * Three exteriors and an odometer shot is the floor at which a buyer can form a
 * real opinion. Below it the listing wastes everyone's time.
 */
export const LISTING_MEDIA_REQUIREMENTS = {
  minExteriorPhotos: 3,
  requiresOdometerPhoto: true,
  maxPhotos: 24,
} as const;

export interface ListingPublishContext {
  /** The vehicle belongs to the seller's tenant. */
  vehicleBelongsToSeller: boolean;
  vehicleIsVerified: boolean;
  /** The vehicle is on a live trip right now. */
  vehicleOnActiveTrip: boolean;
  /** A driver is still assigned to it. */
  vehicleHasActiveAssignment: boolean;
  sellerOrganizationVerified: boolean;
  exteriorPhotoCount: number;
  hasOdometerPhoto: boolean;
  askingPrice: number;
  odometerKm: number;
}

export interface GateResult {
  ready: boolean;
  /** Every unmet requirement, so the seller fixes them in one pass. */
  blockers: string[];
}

/**
 * Can this listing go live?
 *
 * Returns every blocker rather than the first, because a seller who has to
 * resubmit four times to discover four problems stops selling.
 */
export function checkListingPublishGates(context: ListingPublishContext): GateResult {
  const blockers: string[] = [];

  if (!context.vehicleBelongsToSeller) {
    blockers.push('This vehicle is not registered to your organization.');
  }
  if (context.vehicleOnActiveTrip) {
    blockers.push('The vehicle is on an active trip. Complete or reassign the trip first.');
  }
  if (context.vehicleHasActiveAssignment) {
    blockers.push('A driver is still assigned to this vehicle. End the assignment first.');
  }
  if (!context.vehicleIsVerified) {
    blockers.push('The vehicle must be verified on Saarthi before it can be listed.');
  }
  if (!context.sellerOrganizationVerified) {
    blockers.push('Your organization must be verified before you can list a vehicle for sale.');
  }
  if (context.exteriorPhotoCount < LISTING_MEDIA_REQUIREMENTS.minExteriorPhotos) {
    blockers.push(
      `Add at least ${LISTING_MEDIA_REQUIREMENTS.minExteriorPhotos} exterior photos (${context.exteriorPhotoCount} so far).`,
    );
  }
  if (LISTING_MEDIA_REQUIREMENTS.requiresOdometerPhoto && !context.hasOdometerPhoto) {
    blockers.push('Add a photo of the odometer reading.');
  }
  if (context.askingPrice <= 0) {
    blockers.push('Set an asking price.');
  }
  if (context.odometerKm <= 0) {
    blockers.push('Record the current odometer reading.');
  }

  return { ready: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Evidence pack
// ---------------------------------------------------------------------------

/** Which evidence blocks a seller may share or withhold. */
export const EvidenceBlock = {
  SERVICE_HISTORY: 'SERVICE_HISTORY',
  FUEL_ECONOMY: 'FUEL_ECONOMY',
  DISTANCE_RUN: 'DISTANCE_RUN',
  COMPLIANCE: 'COMPLIANCE',
  TELEMETRY_HEALTH: 'TELEMETRY_HEALTH',
  INCIDENT_RECORD: 'INCIDENT_RECORD',
  RC_SNAPSHOT: 'RC_SNAPSHOT',
} as const;
export type EvidenceBlock = (typeof EvidenceBlock)[keyof typeof EvidenceBlock];

export const EVIDENCE_BLOCK_CATALOGUE: ReadonlyArray<{
  block: EvidenceBlock;
  label: string;
  description: string;
  /** Shared unless the seller turns it off. */
  defaultShared: boolean;
}> = [
  {
    block: EvidenceBlock.SERVICE_HISTORY,
    label: 'Service history',
    description: 'Maintenance records logged on Saarthi: count, last service and total spend.',
    defaultShared: true,
  },
  {
    block: EvidenceBlock.FUEL_ECONOMY,
    label: 'Fuel economy',
    description: 'Litres per 100 km derived from recorded refuelling.',
    defaultShared: true,
  },
  {
    block: EvidenceBlock.DISTANCE_RUN,
    label: 'Distance run',
    description: 'Kilometres covered on Saarthi trips, alongside the odometer.',
    defaultShared: true,
  },
  {
    block: EvidenceBlock.COMPLIANCE,
    label: 'Document validity',
    description: 'Whether RC, insurance, fitness, permit and PUC are currently valid.',
    defaultShared: true,
  },
  {
    block: EvidenceBlock.TELEMETRY_HEALTH,
    label: 'Telemetry health',
    description: 'Latest engine readings and open fault codes from connected hardware.',
    defaultShared: false,
  },
  {
    block: EvidenceBlock.INCIDENT_RECORD,
    label: 'Incident record',
    description: 'Number of emergencies raised on Saarthi involving this vehicle.',
    defaultShared: true,
  },
  {
    block: EvidenceBlock.RC_SNAPSHOT,
    label: 'Registration snapshot',
    description: 'Stored RC lookup for the registration number.',
    defaultShared: true,
  },
];

export function defaultSharedEvidenceBlocks(): EvidenceBlock[] {
  return EVIDENCE_BLOCK_CATALOGUE.filter((entry) => entry.defaultShared).map(
    (entry) => entry.block,
  );
}

/**
 * One block of the pack as the buyer sees it.
 *
 * `shared: false` is a first-class state. The UI must render the withheld
 * message rather than a zero, an empty list or a dash — a buyer reading "0
 * services" when the seller simply declined to share would be misled.
 */
export interface EvidenceBlockView<T> {
  block: EvidenceBlock;
  shared: boolean;
  /** Null whenever `shared` is false, or when Saarthi holds no data. */
  data: T | null;
  /** Why there is no data. Always populated when `data` is null. */
  unavailableReason: string | null;
}

export function withheldBlock<T>(block: EvidenceBlock): EvidenceBlockView<T> {
  return {
    block,
    shared: false,
    data: null,
    unavailableReason: 'Not shared by the seller.',
  };
}

export function emptyBlock<T>(block: EvidenceBlock, reason: string): EvidenceBlockView<T> {
  return { block, shared: true, data: null, unavailableReason: reason };
}

export function sharedBlock<T>(block: EvidenceBlock, data: T): EvidenceBlockView<T> {
  return { block, shared: true, data, unavailableReason: null };
}

// ---------------------------------------------------------------------------
// Condition and pricing helpers
// ---------------------------------------------------------------------------

export const VEHICLE_CONDITION_LABELS: Record<VehicleCondition, string> = {
  [VehicleCondition.EXCELLENT]: 'Excellent — no known faults',
  [VehicleCondition.GOOD]: 'Good — normal wear for its age',
  [VehicleCondition.FAIR]: 'Fair — needs minor attention',
  [VehicleCondition.NEEDS_REPAIR]: 'Needs repair — known defects',
  [VehicleCondition.NON_RUNNING]: 'Not running',
};

export const VISIBILITY_LABELS: Record<VehicleListingVisibility, string> = {
  [VehicleListingVisibility.ORGANIZATION]: 'My organization only',
  [VehicleListingVisibility.ASSOCIATION]: 'My truck association',
  [VehicleListingVisibility.PLATFORM]: 'Every verified Saarthi business',
};

/**
 * Is an offer worth surfacing to the seller as serious?
 *
 * Not a rule, a hint: offers below 70% of ask are usually noise, and flagging
 * that lets the seller triage without hiding anything.
 */
export function isSeriousOffer(askingPrice: number, offerAmount: number): boolean {
  if (askingPrice <= 0) return true;
  return offerAmount >= askingPrice * 0.7;
}

/** Percentage below ask, for the offers list. */
export function offerDiscountPercent(askingPrice: number, offerAmount: number): number {
  if (askingPrice <= 0) return 0;
  return Math.round(((askingPrice - offerAmount) / askingPrice) * 1000) / 10;
}

/**
 * Which statuses accept new offers.
 *
 * RESERVED does: a backup offer is exactly what a seller wants when the first
 * buyer is wavering, and refusing it loses the sale when they walk.
 */
export function acceptsOffers(status: VehicleListingStatus): boolean {
  return (
    status === VehicleListingStatus.PUBLISHED || status === VehicleListingStatus.RESERVED
  );
}

/** Fields a buyer must never receive, whatever the serialiser is asked for. */
export const SELLER_ONLY_LISTING_FIELDS = ['minimumPrice'] as const;

/**
 * Age in years from a manufacture year, or null when the year is unknown.
 * Never guesses — an unknown year renders as "not recorded".
 */
export function vehicleAgeYears(year: number | null, now: Date = new Date()): number | null {
  if (year === null || !Number.isFinite(year) || year < 1900) return null;
  return Math.max(0, now.getFullYear() - year);
}

/** Average kilometres per year, used as a wear indicator on the listing. */
export function averageAnnualKm(odometerKm: number, ageYears: number | null): number | null {
  if (ageYears === null || ageYears <= 0) return null;
  return Math.round(odometerKm / ageYears);
}
