import { z } from 'zod';
import {
  HireBasis,
  MaterialUnit,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  TruckType,
  VehicleType,
} from '../domain/enums';
import {
  BID_SCOPES_BY_KIND,
  MAX_BID_WINDOW_DAYS,
  MIN_BID_WINDOW_HOURS,
} from '../domain/requirements';
import {
  addressSchema,
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  positiveQuantitySchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Requirement contracts — the customer's cross-category request for quotes.
 *
 * One envelope carries four very different needs, so the schema is a common
 * core plus four optional detail blocks, and a `superRefine` insists that the
 * block matching the chosen kind is present and the others are not. That keeps
 * a single endpoint and a single table while making an incomplete cab request
 * as impossible as an incomplete freight one.
 */

// ---------------------------------------------------------------------------
// Detail blocks — one per requirement kind
// ---------------------------------------------------------------------------

/** Goods to be bought, and where they have to end up. */
export const materialDetailSchema = z.object({
  /** An existing marketplace listing, when the customer picked one. */
  materialId: uuidSchema.optional(),
  materialName: trimmedString(2, 160),
  category: optionalTrimmedString(60),
  quantity: positiveQuantitySchema,
  unit: z.nativeEnum(MaterialUnit).default(MaterialUnit.TON),
  /** Grade, brand or specification the customer will accept. */
  specification: optionalTrimmedString(1000),
  /**
   * Whether Saarthi should also find the lorry. False means the customer
   * either collects, or expects the supplier to price delivery into its bid.
   */
  needsTransport: z.boolean().default(true),
});
export type MaterialDetailInput = z.infer<typeof materialDetailSchema>;

/** A load the customer already owns. */
export const freightDetailSchema = z.object({
  goodsDescription: trimmedString(2, 160),
  quantity: positiveQuantitySchema,
  unit: z.nativeEnum(MaterialUnit).default(MaterialUnit.TON),
  requiredCapacityTons: z.coerce
    .number()
    .positive('Enter the truck capacity you need.')
    .max(200),
  requiredTruckType: z.nativeEnum(TruckType).optional(),
  /** Anything that changes how it must be loaded or handled. */
  handlingNotes: optionalTrimmedString(1000),
});
export type FreightDetailInput = z.infer<typeof freightDetailSchema>;

/** A vehicle with a driver. */
export const cabDetailSchema = z.object({
  hireBasis: z.nativeEnum(HireBasis),
  passengers: z.coerce.number().int().min(1).max(80),
  preferredVehicleType: z.nativeEnum(VehicleType).optional(),
  /** Set for HOURLY hire. */
  durationHours: z.coerce.number().int().min(1).max(24).optional(),
  /** Set for DAILY hire, and for a round trip that spans nights. */
  durationDays: z.coerce.number().int().min(1).max(60).optional(),
  luggageCount: z.coerce.number().int().min(0).max(50).optional(),
  acRequired: z.boolean().default(true),
});
export type CabDetailInput = z.infer<typeof cabDetailSchema>;

/** A multi-day itinerary the operator prices as a package. */
export const tourDetailSchema = z.object({
  destinations: z
    .array(trimmedString(2, 120))
    .min(1, 'Name at least one place you want to visit.')
    .max(30),
  passengers: z.coerce.number().int().min(1).max(80),
  durationDays: z.coerce.number().int().min(1).max(60),
  durationNights: z.coerce.number().int().min(0).max(59).optional(),
  preferredVehicleType: z.nativeEnum(VehicleType).optional(),
  /** What the customer expects the price to cover. */
  requiredInclusions: z.array(trimmedString(2, 160)).max(30).default([]),
  accommodationNeeded: z.boolean().default(false),
  mealsNeeded: z.boolean().default(false),
});
export type TourDetailInput = z.infer<typeof tourDetailSchema>;

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

const requirementCore = {
  kind: z.nativeEnum(RequirementKind),
  title: trimmedString(5, 200),
  description: optionalTrimmedString(4000),

  /** Where it starts. Required for every kind. */
  origin: addressSchema,
  /**
   * Where it ends. Optional only for a tour, where the itinerary is the route
   * and naming a single destination would be a fiction.
   */
  destination: addressSchema.optional(),

  /** When the customer needs it to happen. */
  startAt: z.coerce.date(),
  /** The far end of the window, when there is one. */
  endAt: z.coerce.date().optional(),
  /** How flexible those dates are, in the customer's own words. */
  scheduleNotes: optionalTrimmedString(500),

  /** What the customer expects to pay. Shown to bidders only if they allow it. */
  budgetAmount: moneySchema.optional(),
  budgetIsPublic: z.boolean().default(false),

  /** Bidding closes here. Defaults to DEFAULT_BID_WINDOW_HOURS from now. */
  bidsCloseAt: z.coerce.date().optional(),

  contactName: optionalTrimmedString(160),
  contactPhone: optionalPhoneSchema,

  materialDetail: materialDetailSchema.optional(),
  freightDetail: freightDetailSchema.optional(),
  cabDetail: cabDetailSchema.optional(),
  tourDetail: tourDetailSchema.optional(),
};

/** The detail block each kind must carry. */
const DETAIL_KEY_BY_KIND = {
  [RequirementKind.MATERIAL_SUPPLY]: 'materialDetail',
  [RequirementKind.FREIGHT_TRANSPORT]: 'freightDetail',
  [RequirementKind.CAB_HIRE]: 'cabDetail',
  [RequirementKind.TOUR_PACKAGE]: 'tourDetail',
} as const;

const DETAIL_PROMPT_BY_KIND: Record<RequirementKind, string> = {
  [RequirementKind.MATERIAL_SUPPLY]: 'Describe the material you need.',
  [RequirementKind.FREIGHT_TRANSPORT]: 'Describe the load that needs moving.',
  [RequirementKind.CAB_HIRE]: 'Tell us how the vehicle will be used.',
  [RequirementKind.TOUR_PACKAGE]: 'Tell us where you want to go, and for how long.',
};

const KIND_ARTICLE: Record<RequirementKind, string> = {
  [RequirementKind.MATERIAL_SUPPLY]: 'A material supply',
  [RequirementKind.FREIGHT_TRANSPORT]: 'A freight transport',
  [RequirementKind.CAB_HIRE]: 'A cab hire',
  [RequirementKind.TOUR_PACKAGE]: 'A tour package',
};

interface RefinableRequirement {
  kind: RequirementKind;
  startAt: Date;
  endAt?: Date | undefined;
  bidsCloseAt?: Date | undefined;
  destination?: unknown;
  materialDetail?: MaterialDetailInput | undefined;
  freightDetail?: FreightDetailInput | undefined;
  cabDetail?: CabDetailInput | undefined;
  tourDetail?: TourDetailInput | undefined;
}

function refineRequirement(value: RefinableRequirement, ctx: z.RefinementCtx): void {
  const expected = DETAIL_KEY_BY_KIND[value.kind];

  if (!value[expected]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [expected],
      message: DETAIL_PROMPT_BY_KIND[value.kind],
    });
  }

  // A cab request carrying tour fields is almost always a client bug, and
  // storing it silently would show bidders a requirement nobody wrote.
  for (const key of Object.values(DETAIL_KEY_BY_KIND)) {
    if (key !== expected && value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${KIND_ARTICLE[value.kind]} requirement cannot carry these details.`,
      });
    }
  }

  // Everything except a tour goes from somewhere to somewhere.
  if (value.kind !== RequirementKind.TOUR_PACKAGE && !value.destination) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destination'],
      message: 'Enter where it has to arrive.',
    });
  }

  if (value.endAt && value.endAt < value.startAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endAt'],
      message: 'The end of the window is before it starts.',
    });
  }

  if (value.bidsCloseAt) {
    const hoursFromNow = (value.bidsCloseAt.getTime() - Date.now()) / 3_600_000;
    if (hoursFromNow < MIN_BID_WINDOW_HOURS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bidsCloseAt'],
        message: `Leave at least ${MIN_BID_WINDOW_HOURS} hours for bids to arrive.`,
      });
    }
    if (hoursFromNow / 24 > MAX_BID_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bidsCloseAt'],
        message: `Bidding can stay open for at most ${MAX_BID_WINDOW_DAYS} days.`,
      });
    }
    if (value.bidsCloseAt > value.startAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bidsCloseAt'],
        message: 'Bidding has to close before the job starts.',
      });
    }
  }

  const cab = value.cabDetail;
  if (cab) {
    if (cab.hireBasis === HireBasis.HOURLY && !cab.durationHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cabDetail', 'durationHours'],
        message: 'Say how many hours you need the vehicle for.',
      });
    }
    if (cab.hireBasis === HireBasis.DAILY && !cab.durationDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cabDetail', 'durationDays'],
        message: 'Say how many days you need the vehicle for.',
      });
    }
  }

  const tour = value.tourDetail;
  if (tour && tour.durationNights !== undefined && tour.durationNights >= tour.durationDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tourDetail', 'durationNights'],
      message: 'A tour has fewer nights than days.',
    });
  }
}

export const createRequirementSchema = z.object(requirementCore).superRefine(refineRequirement);
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

/**
 * Editing is deliberately narrow. Changing the load or the route after fleets
 * have priced it would invalidate every bid on the board, so those fields are
 * fixed once posted — the customer cancels and reposts instead.
 */
export const updateRequirementSchema = z.object({
  title: trimmedString(5, 200).optional(),
  description: optionalTrimmedString(4000),
  scheduleNotes: optionalTrimmedString(500),
  budgetAmount: moneySchema.optional(),
  budgetIsPublic: z.boolean().optional(),
  bidsCloseAt: z.coerce.date().optional(),
  contactName: optionalTrimmedString(160),
  contactPhone: optionalPhoneSchema,
});
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

export const cancelRequirementSchema = z.object({
  reason: trimmedString(5, 500),
});
export type CancelRequirementInput = z.infer<typeof cancelRequirementSchema>;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

const REQUIREMENT_KIND_VALUES = [
  RequirementKind.MATERIAL_SUPPLY,
  RequirementKind.FREIGHT_TRANSPORT,
  RequirementKind.CAB_HIRE,
  RequirementKind.TOUR_PACKAGE,
] as const;

const REQUIREMENT_STATUS_VALUES = [
  RequirementStatus.OPEN,
  RequirementStatus.BIDDING,
  RequirementStatus.PARTIALLY_AWARDED,
  RequirementStatus.AWARDED,
  RequirementStatus.FULFILLED,
  RequirementStatus.CANCELLED,
  RequirementStatus.EXPIRED,
] as const;

/** The customer's own requirements. */
export const requirementListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(160),
  kind: csvEnum(REQUIREMENT_KIND_VALUES),
  status: csvEnum(REQUIREMENT_STATUS_VALUES),
  activeOnly: z.coerce.boolean().default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'startAt', 'bidsCloseAt', 'bidCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type RequirementListQuery = z.infer<typeof requirementListQuerySchema>;

/**
 * The provider board: open requirements this organization can bid on.
 *
 * `kind` narrows what the caller already qualifies for; it never widens it.
 * The API intersects whatever is asked for with what the caller's organization
 * type is allowed to see, so a filter cannot be used to peer at another
 * market's demand.
 */
export const requirementBoardQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(160),
  kind: csvEnum(REQUIREMENT_KIND_VALUES),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(3000).default(500),
  startingAfter: z.coerce.date().optional(),
  startingBefore: z.coerce.date().optional(),
  minBudget: z.coerce.number().min(0).optional(),
  /** Hide requirements this organization has already priced. */
  excludeBid: z.coerce.boolean().default(false),
  sortBy: z.enum(['createdAt', 'startAt', 'distance', 'bidsCloseAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type RequirementBoardQuery = z.infer<typeof requirementBoardQuerySchema>;

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------

/**
 * A priced offer against a requirement.
 *
 * The scope decides which extra fields matter: a transport bid names the
 * vehicle that will do the work, a travel bid describes what the price covers,
 * and a material bid says whether that price is ex-yard or delivered.
 */
export const placeBidSchema = z
  .object({
    scope: z.nativeEnum(RequirementBidScope),
    price: moneySchema,
    /** Free text explaining what the price covers. */
    priceBreakdown: optionalTrimmedString(1000),
    message: optionalTrimmedString(2000),
    /** After this the bid can no longer be awarded. */
    validUntil: z.coerce.date().optional(),

    // --- Transport ---------------------------------------------------------
    /**
     * The vehicle offered. Required for a transport bid: accepting one creates
     * a trip, and a trip without a lorry is not something the customer can
     * reasonably be asked to agree to.
     */
    vehicleId: uuidSchema.optional(),
    driverId: uuidSchema.optional(),
    estimatedPickupAt: z.coerce.date().optional(),
    estimatedArrivalAt: z.coerce.date().optional(),

    // --- Material ----------------------------------------------------------
    /** The listing this price is drawn from, when there is one. */
    materialId: uuidSchema.optional(),
    /** True when the price already covers getting it there. */
    includesDelivery: z.boolean().default(false),
    availableQuantity: positiveQuantitySchema.optional(),
    /** Days until the supplier can release the goods. */
    leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),

    // --- Travel ------------------------------------------------------------
    offeredVehicleType: z.nativeEnum(VehicleType).optional(),
    /** What the quoted price includes, as the operator would list it. */
    inclusions: z.array(trimmedString(2, 160)).max(30).default([]),
    exclusions: z.array(trimmedString(2, 160)).max(30).default([]),
    /** A day-by-day outline for a tour bid. */
    itinerarySummary: optionalTrimmedString(4000),
    driverIncluded: z.boolean().default(true),
    fuelIncluded: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.scope === RequirementBidScope.TRANSPORT && !value.vehicleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleId'],
        message: 'Name the vehicle you are offering.',
      });
    }
    if (value.scope === RequirementBidScope.TRAVEL && !value.offeredVehicleType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offeredVehicleType'],
        message: 'Say which type of vehicle you are offering.',
      });
    }
    if (
      value.estimatedPickupAt &&
      value.estimatedArrivalAt &&
      value.estimatedPickupAt > value.estimatedArrivalAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedArrivalAt'],
        message: 'Arrival cannot be before pickup.',
      });
    }
    if (value.validUntil && value.validUntil.getTime() < Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'That validity date has already passed.',
      });
    }
  });
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const awardBidSchema = z.object({
  bidId: uuidSchema,
  /** Recorded on the requirement timeline, and shown to the winning bidder. */
  note: optionalTrimmedString(1000),
});
export type AwardBidInput = z.infer<typeof awardBidSchema>;

export const shortlistBidSchema = z.object({
  bidId: uuidSchema,
  shortlisted: z.boolean().default(true),
});
export type ShortlistBidInput = z.infer<typeof shortlistBidSchema>;

export const rejectBidSchema = z.object({
  bidId: uuidSchema,
  reason: optionalTrimmedString(500),
});
export type RejectBidInput = z.infer<typeof rejectBidSchema>;

export const bidListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    RequirementBidStatus.OFFERED,
    RequirementBidStatus.SHORTLISTED,
    RequirementBidStatus.ACCEPTED,
    RequirementBidStatus.REJECTED,
    RequirementBidStatus.WITHDRAWN,
    RequirementBidStatus.EXPIRED,
  ]),
  scope: csvEnum([
    RequirementBidScope.MATERIAL,
    RequirementBidScope.TRANSPORT,
    RequirementBidScope.TRAVEL,
  ]),
  sortBy: z.enum(['price', 'createdAt', 'rating']).default('price'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
export type BidListQuery = z.infer<typeof bidListQuerySchema>;

/** The scopes valid for a kind — re-exported so the UI can filter early. */
export function bidScopesForKind(kind: RequirementKind): RequirementBidScope[] {
  return BID_SCOPES_BY_KIND[kind];
}
