import { z } from 'zod';
import {
  FuelType,
  TruckType,
  VehicleCondition,
  VehicleInspectionStatus,
  VehicleListingStatus,
  VehicleListingVisibility,
  VehicleType,
} from '../domain/enums';
import { EvidenceBlock } from '../domain/resale';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalTrimmedString,
  paginationSchema,
  sortOrderSchema,
  trimmedString,
  uuidSchema,
} from './common';

/** Evidence blocks a seller chooses to share. */
export const evidenceBlockSchema = z.nativeEnum(EvidenceBlock);

export const createVehicleListingSchema = z.object({
  vehicleId: uuidSchema,
  title: trimmedString(6, 160),
  description: optionalTrimmedString(4000),
  askingPrice: moneySchema,
  negotiable: z.boolean().default(true),
  /**
   * The seller's walk-away figure. Never serialised to a buyer — see
   * SELLER_ONLY_LISTING_FIELDS.
   */
  minimumPrice: moneySchema.optional(),
  visibility: z
    .nativeEnum(VehicleListingVisibility)
    .default(VehicleListingVisibility.PLATFORM),
  condition: z.nativeEnum(VehicleCondition).default(VehicleCondition.GOOD),
  odometerKm: z.number().min(0).max(5_000_000),
  ownershipCount: z.number().int().min(1).max(20).default(1),
  accidentHistory: z.boolean().default(false),
  accidentNote: optionalTrimmedString(1000),
  majorRepairsNote: optionalTrimmedString(1000),
  tyreConditionPercent: z.number().int().min(0).max(100).optional(),
  engineConditionNote: optionalTrimmedString(1000),
  insuranceValidTill: z.coerce.date().optional(),
  fitnessValidTill: z.coerce.date().optional(),
  permitType: optionalTrimmedString(80),
  permitValidTill: z.coerce.date().optional(),
  loanOutstanding: z.boolean().default(false),
  hypothecationNote: optionalTrimmedString(500),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  availableFrom: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  sharedEvidence: z.array(evidenceBlockSchema).optional(),
});
export type CreateVehicleListingInput = z.infer<typeof createVehicleListingSchema>;

/** The vehicle cannot be swapped after creation — that would be a new listing. */
export const updateVehicleListingSchema = createVehicleListingSchema.omit({ vehicleId: true }).partial();
export type UpdateVehicleListingInput = z.infer<typeof updateVehicleListingSchema>;

export const listingListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    VehicleListingStatus.DRAFT,
    VehicleListingStatus.PENDING_REVIEW,
    VehicleListingStatus.PUBLISHED,
    VehicleListingStatus.RESERVED,
    VehicleListingStatus.SOLD,
    VehicleListingStatus.WITHDRAWN,
    VehicleListingStatus.REJECTED,
    VehicleListingStatus.EXPIRED,
  ]),
  vehicleType: csvEnum([
    VehicleType.TRUCK,
    VehicleType.TAXI,
    VehicleType.CAR,
    VehicleType.BUS,
    VehicleType.VAN,
    VehicleType.SUV,
    VehicleType.TEMPO,
    VehicleType.AUTO_RICKSHAW,
    VehicleType.PICKUP,
    VehicleType.OTHER,
  ]),
  truckType: csvEnum([
    TruckType.OPEN_BODY,
    TruckType.CLOSED_CONTAINER,
    TruckType.TIPPER,
    TruckType.TRAILER,
    TruckType.TANKER,
    TruckType.FLATBED,
    TruckType.REFRIGERATED,
    TruckType.MINI_TRUCK,
    TruckType.MULTI_AXLE,
    TruckType.OTHER,
  ]),
  fuelType: csvEnum([
    FuelType.DIESEL,
    FuelType.PETROL,
    FuelType.CNG,
    FuelType.LNG,
    FuelType.ELECTRIC,
    FuelType.HYBRID,
  ]),
  condition: csvEnum([
    VehicleCondition.EXCELLENT,
    VehicleCondition.GOOD,
    VehicleCondition.FAIR,
    VehicleCondition.NEEDS_REPAIR,
    VehicleCondition.NON_RUNNING,
  ]),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minYear: z.coerce.number().int().min(1900).max(2100).optional(),
  maxOdometerKm: z.coerce.number().min(0).optional(),
  minCapacityTons: z.coerce.number().min(0).optional(),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  /** Rank by distance from here. */
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(2000).optional(),
  watchedOnly: z.coerce.boolean().optional(),
  search: optionalTrimmedString(160),
  sortBy: z
    .enum(['publishedAt', 'askingPrice', 'odometerKm', 'year', 'distance'])
    .default('publishedAt'),
  sortOrder: sortOrderSchema,
});
export type ListingListQuery = z.infer<typeof listingListQuerySchema>;

export const submitListingSchema = z.object({
  note: optionalTrimmedString(500),
});
export type SubmitListingInput = z.infer<typeof submitListingSchema>;

export const reviewListingSchema = z
  .object({
    decision: z.enum(['PUBLISH', 'REJECT']),
    rejectionReason: optionalTrimmedString(500),
    note: optionalTrimmedString(500),
  })
  .refine((value) => value.decision !== 'REJECT' || (value.rejectionReason?.length ?? 0) > 0, {
    message: 'Give the seller a reason for the rejection.',
    path: ['rejectionReason'],
  });
export type ReviewListingInput = z.infer<typeof reviewListingSchema>;

export const withdrawListingSchema = z.object({
  reason: trimmedString(3, 500),
});
export type WithdrawListingInput = z.infer<typeof withdrawListingSchema>;

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export const createOfferSchema = z.object({
  amount: moneySchema,
  message: optionalTrimmedString(1000),
  /** Buyer's own expiry on the offer. */
  expiresAt: z.coerce.date().optional(),
  /** Buyer intends to inspect before completing. */
  wantsInspection: z.boolean().default(false),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const counterOfferSchema = z.object({
  counterAmount: moneySchema,
  message: optionalTrimmedString(1000),
  expiresAt: z.coerce.date().optional(),
});
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;

export const rejectOfferSchema = z.object({
  reason: optionalTrimmedString(500),
});
export type RejectOfferInput = z.infer<typeof rejectOfferSchema>;

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

export const requestInspectionSchema = z.object({
  preferredAt: z.coerce.date(),
  alternateAt: z.coerce.date().optional(),
  note: optionalTrimmedString(1000),
  contactPhone: optionalTrimmedString(20),
});
export type RequestInspectionInput = z.infer<typeof requestInspectionSchema>;

export const updateInspectionSchema = z.object({
  status: z.nativeEnum(VehicleInspectionStatus),
  scheduledAt: z.coerce.date().optional(),
  location: optionalTrimmedString(300),
  reportSummary: optionalTrimmedString(2000),
  note: optionalTrimmedString(1000),
});
export type UpdateInspectionInput = z.infer<typeof updateInspectionSchema>;

// ---------------------------------------------------------------------------
// Ownership transfer
// ---------------------------------------------------------------------------

export const advanceTransferSchema = z.object({
  /** Omit to move to the next state in sequence. */
  toStatus: z
    .enum(['DOCUMENTS_PENDING', 'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED'])
    .optional(),
  salePrice: moneySchema.optional(),
  rcTransferReference: optionalTrimmedString(120),
  paymentReference: optionalTrimmedString(120),
  note: optionalTrimmedString(1000),
  /** Required when cancelling. */
  cancellationReason: optionalTrimmedString(500),
});
export type AdvanceTransferInput = z.infer<typeof advanceTransferSchema>;

export const transferListQuerySchema = paginationSchema.extend({
  role: z.enum(['seller', 'buyer', 'any']).default('any'),
  status: csvEnum(['PENDING', 'DOCUMENTS_PENDING', 'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED']),
});
export type TransferListQuery = z.infer<typeof transferListQuerySchema>;
