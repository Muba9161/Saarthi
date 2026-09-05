import { z } from 'zod';
import {
  BookingStatus,
  CancelledBy,
  PaymentMethod,
  PricingModel,
  ProviderStatus,
  ServiceType,
  TravelPackageStatus,
  TravelServiceKind,
  VehicleType,
} from '../domain/enums';
import { MAX_BOOKING_HORIZON_DAYS, MIN_BOOKING_LEAD_HOURS } from '../domain/travel';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  phoneSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Travel, tour and mobility contracts.
 *
 * A provider profile is a *capability* on an existing organization, not a new
 * account: a fleet owner who buys two SUVs to run Ayodhya tours adds TRAVEL to
 * their service types and keeps one login, one vehicle list and one dashboard.
 */

// ---------------------------------------------------------------------------
// Provider profile
// ---------------------------------------------------------------------------

export const serviceAreaSchema = z.object({
  city: trimmedString(2, 120),
  state: trimmedString(2, 120),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  /** How far from this city the provider will travel. */
  radiusKm: z.coerce.number().min(5).max(2000).default(150),
});
export type ServiceAreaInput = z.infer<typeof serviceAreaSchema>;

export const upsertProviderProfileSchema = z.object({
  displayName: trimmedString(3, 160),
  serviceTypes: z
    .array(z.nativeEnum(ServiceType))
    .min(1, 'Choose at least one service you offer.')
    .max(4),
  about: optionalTrimmedString(3000),
  contactPhone: phoneSchema,
  contactEmail: optionalTrimmedString(254),
  whatsappPhone: optionalPhoneSchema,
  logoUrl: optionalTrimmedString(500),
  bannerUrl: optionalTrimmedString(500),
  /** GST or business registration, shown to customers as a trust signal. */
  businessRegistrationNumber: optionalTrimmedString(80),
  yearsInBusiness: z.coerce.number().int().min(0).max(150).optional(),
  languages: z.array(trimmedString(2, 40)).max(10).default([]),
  serviceAreas: z
    .array(serviceAreaSchema)
    .min(1, 'Add at least one city you operate from.')
    .max(25),
  /** Whether the provider is currently accepting new bookings. */
  status: z.nativeEnum(ProviderStatus).default(ProviderStatus.ACTIVE),
});
export type UpsertProviderProfileInput = z.infer<typeof upsertProviderProfileSchema>;

export const providerListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  serviceType: csvEnum([
    ServiceType.FREIGHT,
    ServiceType.TAXI,
    ServiceType.TRAVEL,
    ServiceType.TOUR,
  ]),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  minRating: z.coerce.number().min(0).max(5).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
});
export type ProviderListQuery = z.infer<typeof providerListQuerySchema>;

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export const itineraryDaySchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(60),
  title: trimmedString(2, 160),
  description: optionalTrimmedString(2000),
  /** Free-text stops for the day, e.g. "Ram Janmabhoomi, Hanuman Garhi". */
  highlights: z.array(trimmedString(1, 160)).max(20).default([]),
  overnightAt: optionalTrimmedString(120),
  approxDistanceKm: z.coerce.number().min(0).max(3000).optional(),
});
export type ItineraryDayInput = z.infer<typeof itineraryDaySchema>;

export const cancellationTierSchema = z.object({
  hoursBefore: z.coerce.number().int().min(0).max(2160),
  refundPercent: z.coerce.number().int().min(0).max(100),
});

const packageFields = {
  title: trimmedString(5, 200),
  summary: trimmedString(10, 400),
  description: optionalTrimmedString(6000),
  serviceKind: z.nativeEnum(TravelServiceKind),
  imageUrls: z.array(trimmedString(3, 500)).max(12).default([]),
  /** Ordered list of places visited, used by search. */
  destinations: z.array(trimmedString(2, 120)).min(1, 'List at least one destination.').max(30),
  startLocation: trimmedString(2, 160),
  startLatitude: latitudeSchema,
  startLongitude: longitudeSchema,
  endLocation: trimmedString(2, 160),
  durationDays: z.coerce.number().int().min(1).max(60),
  durationNights: z.coerce.number().int().min(0).max(59).optional(),
  approxDistanceKm: z.coerce.number().min(0).max(20_000).optional(),
  /** The vehicle type sold with the package; a specific vehicle is optional. */
  vehicleType: z.nativeEnum(VehicleType),
  vehicleId: uuidSchema.optional(),
  minPassengers: z.coerce.number().int().min(1).max(80).default(1),
  maxPassengers: z.coerce.number().int().min(1).max(80),
  pricingModel: z.nativeEnum(PricingModel),
  basePrice: moneySchema,
  inclusions: z.array(trimmedString(2, 160)).max(30).default([]),
  exclusions: z.array(trimmedString(2, 160)).max(30).default([]),
  itinerary: z.array(itineraryDaySchema).max(60).default([]),
  cancellationPolicy: z.array(cancellationTierSchema).max(6).default([]),
  /** Days of notice the provider needs. */
  advanceBookingDays: z.coerce.number().int().min(0).max(180).default(1),
  availableFrom: z.coerce.date().optional(),
  availableTo: z.coerce.date().optional(),
  /** Weekdays the package runs, 0 = Sunday. Empty means every day. */
  availableWeekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
  driverIncluded: z.boolean().default(true),
  fuelIncluded: z.boolean().default(true),
  status: z.nativeEnum(TravelPackageStatus).default(TravelPackageStatus.DRAFT),
};

export const createTravelPackageSchema = z.object(packageFields).superRefine((value, ctx) => {
  if (value.maxPassengers < value.minPassengers) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPassengers'],
      message: 'Maximum passengers cannot be below the minimum.',
    });
  }
  if (value.availableFrom && value.availableTo && value.availableFrom > value.availableTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableTo'],
      message: 'The availability window ends before it starts.',
    });
  }
  if (value.itinerary.length > 0) {
    const days = value.itinerary.map((day) => day.dayNumber);
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itinerary'],
        message: 'Each itinerary day number must be unique.',
      });
    }
    if (Math.max(...days) > value.durationDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itinerary'],
        message: 'The itinerary runs past the stated duration.',
      });
    }
  }
  // PER_KM without a distance would price every booking at zero.
  if (value.pricingModel === PricingModel.PER_KM && !value.approxDistanceKm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approxDistanceKm'],
      message: 'Per-kilometre pricing needs an approximate route distance.',
    });
  }
});
export type CreateTravelPackageInput = z.infer<typeof createTravelPackageSchema>;

export const updateTravelPackageSchema = z.object(packageFields).partial();
export type UpdateTravelPackageInput = z.infer<typeof updateTravelPackageSchema>;

/** Customer-facing package search. */
export const travelSearchQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(160),
  /** Matches any destination or the start location. */
  destination: optionalTrimmedString(120),
  from: optionalTrimmedString(120),
  serviceKind: csvEnum([
    TravelServiceKind.LOCAL_SIGHTSEEING,
    TravelServiceKind.INTERCITY,
    TravelServiceKind.MULTI_DAY_TOUR,
    TravelServiceKind.AIRPORT_TRANSFER,
    TravelServiceKind.CUSTOM_TRIP,
    TravelServiceKind.PILGRIMAGE,
  ]),
  vehicleType: csvEnum([
    VehicleType.TAXI,
    VehicleType.CAR,
    VehicleType.SUV,
    VehicleType.VAN,
    VehicleType.BUS,
    VehicleType.TEMPO,
  ]),
  passengers: z.coerce.number().int().min(1).max(80).optional(),
  startDate: z.coerce.date().optional(),
  minDays: z.coerce.number().int().min(1).max(60).optional(),
  maxDays: z.coerce.number().int().min(1).max(60).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  providerId: uuidSchema.optional(),
  sortBy: z.enum(['price', 'rating', 'duration', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type TravelSearchQuery = z.infer<typeof travelSearchQuerySchema>;

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const createBookingSchema = z
  .object({
    packageId: uuidSchema,
    startDate: z.coerce.date(),
    passengers: z.coerce.number().int().min(1).max(80),
    /** Where to collect the party; defaults to the package start location. */
    pickupAddress: optionalTrimmedString(300),
    pickupLatitude: latitudeSchema.optional(),
    pickupLongitude: longitudeSchema.optional(),
    /**
     * Where the party is going, when the customer names it.
     *
     * A multi-day tour ends where the package says it ends. A taxi does not —
     * it goes where the passenger is going, and a per-kilometre fare cannot be
     * quoted until that is known. Optional here because only the second kind
     * of package asks for it; `createBooking` refuses a per-kilometre booking
     * that arrives without one.
     */
    dropoffAddress: optionalTrimmedString(300),
    dropoffLatitude: latitudeSchema.optional(),
    dropoffLongitude: longitudeSchema.optional(),
    contactName: trimmedString(2, 160),
    contactPhone: phoneSchema,
    contactEmail: optionalTrimmedString(254),
    specialRequests: optionalTrimmedString(2000),
  })
  .superRefine((value, ctx) => {
    // A half-given destination is worse than none: an address with no
    // coordinates cannot be measured, and coordinates with no address cannot
    // be read out to a driver.
    const dropoffParts = [
      value.dropoffAddress,
      value.dropoffLatitude,
      value.dropoffLongitude,
    ].filter((part) => part !== undefined && part !== '');
    if (dropoffParts.length > 0 && dropoffParts.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dropoffAddress'],
        message: 'Give the destination as an address and a point on the map.',
      });
    }

    const leadHours = (value.startDate.getTime() - Date.now()) / 3_600_000;
    if (leadHours < MIN_BOOKING_LEAD_HOURS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: `Bookings need at least ${MIN_BOOKING_LEAD_HOURS} hours' notice.`,
      });
    }
    if (leadHours / 24 > MAX_BOOKING_HORIZON_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: `Bookings can be made up to ${MAX_BOOKING_HORIZON_DAYS} days ahead.`,
      });
    }
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    BookingStatus.DRAFT,
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.AWAITING_CONFIRMATION,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.DECLINED,
    BookingStatus.REFUNDED,
  ]),
  activeOnly: z.coerce.boolean().optional(),
  packageId: uuidSchema.optional(),
  search: optionalTrimmedString(120),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

export const payBookingSchema = z.object({
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.MOCK),
  /**
   * Local-only switch that makes the mock provider decline, so the failure path
   * can be exercised without a real gateway. Ignored in production.
   */
  simulateFailure: z.boolean().default(false),
});
export type PayBookingInput = z.infer<typeof payBookingSchema>;

export const confirmBookingSchema = z.object({
  vehicleId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  note: optionalTrimmedString(1000),
});
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

export const declineBookingSchema = z.object({
  reason: trimmedString(3, 1000),
});
export type DeclineBookingInput = z.infer<typeof declineBookingSchema>;

export const cancelBookingSchema = z.object({
  reason: trimmedString(3, 1000),
  cancelledBy: z.nativeEnum(CancelledBy).optional(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const rateBookingSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Choose between 1 and 5 stars.').max(5),
  vehicleRating: z.coerce.number().int().min(1).max(5).optional(),
  driverRating: z.coerce.number().int().min(1).max(5).optional(),
  comment: optionalTrimmedString(2000),
});
export type RateBookingInput = z.infer<typeof rateBookingSchema>;

/** Price preview shown before the customer commits. */
export const quoteQuerySchema = z.object({
  packageId: uuidSchema,
  passengers: z.coerce.number().int().min(1).max(80),
  /**
   * The journey the customer actually intends, for a per-kilometre package.
   *
   * Without these the quote can only price the package's own nominal
   * distance, which is not what a taxi passenger is about to be charged. The
   * booking measures the same way, so the figure quoted here is the figure
   * that gets billed.
   */
  pickupLatitude: latitudeSchema.optional(),
  pickupLongitude: longitudeSchema.optional(),
  dropoffLatitude: latitudeSchema.optional(),
  dropoffLongitude: longitudeSchema.optional(),
});
export type QuoteQuery = z.infer<typeof quoteQuerySchema>;
