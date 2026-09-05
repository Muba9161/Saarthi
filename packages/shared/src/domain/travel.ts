/**
 * Travel and tour pricing rules.
 *
 * Freight and passenger travel deliberately do **not** share business logic —
 * a freight order is priced per tonne against a quote from a carrier, while a
 * tour is priced per package or per seat and paid up front. What they share is
 * infrastructure (organizations, vehicles, drivers, trips, tracking, payments),
 * which is why travel lives inside Saarthi rather than beside it.
 */

import { CancelledBy, PricingModel, ServiceType, TravelServiceKind } from './enums';
import { distanceKm, type LatLng } from './geo';

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface PackagePricingInput {
  pricingModel: PricingModel;
  /** Base price in INR, meaning depends on the pricing model. */
  basePrice: number;
  /** Package duration in days. */
  durationDays: number;
  /** Approximate route distance, used only by the PER_KM model. */
  distanceKm: number | null;
}

/**
 * The distance a fare is quoted on.
 *
 * A package carries a nominal distance, and for a fixed tour that is the right
 * figure. A per-kilometre package is not sold against it: a taxi charges for
 * the journey the passenger actually asks for, so once both ends are known the
 * journey wins.
 *
 * Measured straight-line, which is how a freight order sizes itself before a
 * routing provider refines it. An estimate that is honest about being one
 * beats a road distance nobody has paid a routing call for on every keystroke
 * of a fare preview.
 *
 * Shared so the quote endpoint, the booking and the customer's live preview
 * all arrive at the same number — a fare that changes between the screen and
 * the invoice is the one thing a passenger will never forgive.
 */
export function journeyDistanceKm(
  pickup: LatLng | null | undefined,
  dropoff: LatLng | null | undefined,
  packageDistanceKm: number | null | undefined,
): number | null {
  if (pickup && dropoff) return Math.round(distanceKm(pickup, dropoff) * 10) / 10;
  return packageDistanceKm ?? null;
}

export interface PriceQuote {
  /** Price before platform fee, in INR. */
  subtotal: number;
  /** Saarthi booking fee. */
  platformFee: number;
  total: number;
  /** How the subtotal was arrived at, shown to the customer verbatim. */
  breakdown: string;
}

/**
 * Saarthi takes a booking fee on travel rather than folding travel into the
 * fleet subscription — a taxi operator with three cars should not need a fleet
 * plan to sell a tour.
 */
export const TRAVEL_PLATFORM_FEE_PERCENT = 5;
export const TRAVEL_PLATFORM_FEE_MIN = 49;
export const TRAVEL_PLATFORM_FEE_MAX = 2_500;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function platformFeeFor(subtotal: number): number {
  const raw = (subtotal * TRAVEL_PLATFORM_FEE_PERCENT) / 100;
  return round2(Math.min(TRAVEL_PLATFORM_FEE_MAX, Math.max(TRAVEL_PLATFORM_FEE_MIN, raw)));
}

/**
 * Price a package for a given party size.
 *
 * Every model is stated explicitly rather than falling through to a default, so
 * a new pricing model cannot silently be charged as a fixed package.
 */
export function quotePackage(input: PackagePricingInput, passengers: number): PriceQuote {
  const heads = Math.max(1, Math.floor(passengers));
  const days = Math.max(1, Math.floor(input.durationDays));

  let subtotal: number;
  let breakdown: string;

  switch (input.pricingModel) {
    case PricingModel.FIXED_PACKAGE:
      subtotal = input.basePrice;
      breakdown = `Fixed package price for up to the stated capacity`;
      break;
    case PricingModel.PER_PERSON:
      subtotal = input.basePrice * heads;
      breakdown = `₹${input.basePrice.toLocaleString('en-IN')} per person × ${heads}`;
      break;
    case PricingModel.PER_DAY:
      subtotal = input.basePrice * days;
      breakdown = `₹${input.basePrice.toLocaleString('en-IN')} per day × ${days}`;
      break;
    case PricingModel.PER_KM: {
      const distance = input.distanceKm ?? 0;
      subtotal = input.basePrice * distance;
      breakdown = `₹${input.basePrice.toLocaleString('en-IN')} per km × ${distance} km`;
      break;
    }
  }

  subtotal = round2(subtotal);
  const platformFee = platformFeeFor(subtotal);
  return { subtotal, platformFee, total: round2(subtotal + platformFee), breakdown };
}

// ---------------------------------------------------------------------------
// Cancellation & refunds
// ---------------------------------------------------------------------------

export interface CancellationTier {
  /** Cancel at least this many hours before departure… */
  hoursBefore: number;
  /** …and this percentage of the subtotal is refunded. */
  refundPercent: number;
}

/**
 * Default customer-cancellation ladder. A provider may publish its own policy
 * per package; this is the fallback and the floor the platform advertises.
 */
export const DEFAULT_CANCELLATION_POLICY: CancellationTier[] = [
  { hoursBefore: 168, refundPercent: 100 },
  { hoursBefore: 72, refundPercent: 75 },
  { hoursBefore: 24, refundPercent: 50 },
  { hoursBefore: 0, refundPercent: 0 },
];

export interface RefundOutcome {
  refundPercent: number;
  refundAmount: number;
  /** Shown to the customer before they confirm the cancellation. */
  explanation: string;
}

/**
 * Work out what a cancellation returns.
 *
 * A provider or platform cancellation always refunds in full — the customer did
 * nothing wrong, so the ladder does not apply to them.
 */
export function calculateRefund(
  subtotal: number,
  platformFee: number,
  startDate: Date,
  cancelledAt: Date,
  cancelledBy: CancelledBy,
  policy: CancellationTier[] = DEFAULT_CANCELLATION_POLICY,
): RefundOutcome {
  if (cancelledBy !== CancelledBy.CUSTOMER) {
    const total = round2(subtotal + platformFee);
    return {
      refundPercent: 100,
      refundAmount: total,
      explanation:
        cancelledBy === CancelledBy.PROVIDER
          ? 'The provider cancelled this booking, so the full amount including the booking fee is refunded.'
          : 'Saarthi cancelled this booking, so the full amount including the booking fee is refunded.',
    };
  }

  const hoursBefore = (startDate.getTime() - cancelledAt.getTime()) / 3_600_000;
  const sorted = [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore);
  const tier = sorted.find((entry) => hoursBefore >= entry.hoursBefore) ?? {
    hoursBefore: 0,
    refundPercent: 0,
  };

  const refundAmount = round2((subtotal * tier.refundPercent) / 100);
  const when =
    hoursBefore < 0
      ? 'after the trip was due to start'
      : `${Math.floor(hoursBefore)} hours before departure`;

  return {
    refundPercent: tier.refundPercent,
    refundAmount,
    explanation:
      tier.refundPercent === 0
        ? `Cancelled ${when}, which falls outside the refund window — no refund is due.`
        : `Cancelled ${when}: ${tier.refundPercent}% of ₹${subtotal.toLocaleString('en-IN')} is refunded. The booking fee is not refundable on a customer cancellation.`,
  };
}

// ---------------------------------------------------------------------------
// Service-type helpers
// ---------------------------------------------------------------------------

/** Which provider service types may publish which kinds of offering. */
export const SERVICE_KIND_REQUIREMENTS: Record<TravelServiceKind, ServiceType[]> = {
  [TravelServiceKind.LOCAL_SIGHTSEEING]: [ServiceType.TOUR, ServiceType.TRAVEL],
  [TravelServiceKind.INTERCITY]: [ServiceType.TRAVEL, ServiceType.TAXI],
  [TravelServiceKind.MULTI_DAY_TOUR]: [ServiceType.TOUR],
  [TravelServiceKind.AIRPORT_TRANSFER]: [ServiceType.TAXI, ServiceType.TRAVEL],
  [TravelServiceKind.CUSTOM_TRIP]: [ServiceType.TRAVEL, ServiceType.TOUR, ServiceType.TAXI],
  [TravelServiceKind.PILGRIMAGE]: [ServiceType.TOUR, ServiceType.TRAVEL],
};

export function canOfferServiceKind(
  providerServiceTypes: readonly ServiceType[],
  kind: TravelServiceKind,
): boolean {
  const required = SERVICE_KIND_REQUIREMENTS[kind] ?? [];
  return required.some((serviceType) => providerServiceTypes.includes(serviceType));
}

/** Minimum lead time between booking and departure, in hours. */
export const MIN_BOOKING_LEAD_HOURS = 4;

/** How far ahead a package may be booked, in days. */
export const MAX_BOOKING_HORIZON_DAYS = 365;
