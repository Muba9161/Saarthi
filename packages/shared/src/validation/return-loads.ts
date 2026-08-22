import { z } from 'zod';
import { ReturnLoadMatchStatus, ReturnLoadStatus, TruckType } from '../domain/enums';
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

/**
 * Return-load validation.
 *
 * The availability window is a real constraint, not decoration: a request whose
 * window has already closed cannot be matched, so the schema refuses to create
 * one that is inverted or zero-length.
 */

export const createReturnLoadSchema = z
  .object({
    truckId: uuidSchema,
    driverId: uuidSchema.optional(),
    /** The outbound trip this return is planned against. */
    outboundTripId: uuidSchema.optional(),

    /** Where the truck becomes free. Defaults to the outbound destination. */
    originAddress: trimmedString(3, 300),
    originLatitude: latitudeSchema,
    originLongitude: longitudeSchema,

    /** Where it wants to end up. Defaults to the truck's home base. */
    destinationAddress: trimmedString(3, 300),
    destinationLatitude: latitudeSchema,
    destinationLongitude: longitudeSchema,

    availableFrom: z.coerce.date(),
    availableUntil: z.coerce.date(),

    capacityTons: z.number().min(0).max(200),
    truckType: z.nativeEnum(TruckType).optional(),
    detourToleranceKm: z.number().min(0).max(500).default(50),
    acceptsPartialLoad: z.boolean().default(true),
    minimumPrice: moneySchema.optional(),
    autoMatch: z.boolean().default(true),
    notes: optionalTrimmedString(1000),
  })
  .refine((value) => value.availableUntil > value.availableFrom, {
    message: 'The availability window must end after it starts.',
    path: ['availableUntil'],
  });
export type CreateReturnLoadInput = z.infer<typeof createReturnLoadSchema>;

export const updateReturnLoadSchema = z
  .object({
    destinationAddress: optionalTrimmedString(300),
    destinationLatitude: latitudeSchema.optional(),
    destinationLongitude: longitudeSchema.optional(),
    availableFrom: z.coerce.date().optional(),
    availableUntil: z.coerce.date().optional(),
    capacityTons: z.number().min(0).max(200).optional(),
    truckType: z.nativeEnum(TruckType).nullable().optional(),
    detourToleranceKm: z.number().min(0).max(500).optional(),
    acceptsPartialLoad: z.boolean().optional(),
    minimumPrice: moneySchema.nullable().optional(),
    autoMatch: z.boolean().optional(),
    notes: optionalTrimmedString(1000),
  })
  .refine(
    (value) =>
      !value.availableFrom ||
      !value.availableUntil ||
      value.availableUntil > value.availableFrom,
    { message: 'The availability window must end after it starts.', path: ['availableUntil'] },
  );
export type UpdateReturnLoadInput = z.infer<typeof updateReturnLoadSchema>;

export const returnLoadListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    ReturnLoadStatus.OPEN,
    ReturnLoadStatus.MATCHED,
    ReturnLoadStatus.BOOKED,
    ReturnLoadStatus.EXPIRED,
    ReturnLoadStatus.CANCELLED,
    ReturnLoadStatus.COMPLETED,
  ]),
  truckId: uuidSchema.optional(),
  /** Requests whose free point is near here. */
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(1000).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(['availableFrom', 'createdAt', 'matchCount']).default('availableFrom'),
  sortOrder: sortOrderSchema,
});
export type ReturnLoadListQuery = z.infer<typeof returnLoadListQuerySchema>;

export const cancelReturnLoadSchema = z.object({
  reason: optionalTrimmedString(300),
});
export type CancelReturnLoadInput = z.infer<typeof cancelReturnLoadSchema>;

export const matchListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    ReturnLoadMatchStatus.SUGGESTED,
    ReturnLoadMatchStatus.OFFERED,
    ReturnLoadMatchStatus.ACCEPTED,
    ReturnLoadMatchStatus.REJECTED,
    ReturnLoadMatchStatus.EXPIRED,
  ]),
  minScore: z.coerce.number().min(0).max(100).optional(),
});
export type MatchListQuery = z.infer<typeof matchListQuerySchema>;

/** Turn a match into a real quote on the order. */
export const quoteFromMatchSchema = z.object({
  price: moneySchema,
  estimatedPickupAt: z.coerce.date().optional(),
  estimatedArrivalAt: z.coerce.date().optional(),
  message: optionalTrimmedString(1000),
  expiresAt: z.coerce.date().optional(),
});
export type QuoteFromMatchInput = z.infer<typeof quoteFromMatchSchema>;

export const rejectMatchSchema = z.object({
  reason: optionalTrimmedString(300),
});
export type RejectMatchInput = z.infer<typeof rejectMatchSchema>;

/** Open orders near trucks that are about to be free. */
export const opportunityQuerySchema = paginationSchema.extend({
  truckId: uuidSchema.optional(),
  /** Look this far ahead for trucks that will be free. */
  horizonHours: z.coerce.number().int().min(1).max(168).default(48),
  minScore: z.coerce.number().min(0).max(100).optional(),
});
export type OpportunityQuery = z.infer<typeof opportunityQuerySchema>;

/** Trips arriving soon with no return load lined up. */
export const emptyRiskQuerySchema = z.object({
  horizonHours: z.coerce.number().int().min(1).max(168).default(48),
});
export type EmptyRiskQuery = z.infer<typeof emptyRiskQuerySchema>;

/** Trucks that could carry a given order as a return leg. */
export const returnCandidateQuerySchema = z.object({
  minScore: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ReturnCandidateQuery = z.infer<typeof returnCandidateQuerySchema>;
