import { z } from 'zod';
import { NearbyCategory, SosStatus, SosType, TrackingSource, TripStatus } from '../domain/enums';
import {
  addressSchema,
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Trip, tracking, nearby, SOS and simulation contracts.
 */

export const createTripSchema = z.object({
  orderId: uuidSchema.optional(),
  truckId: uuidSchema,
  driverId: uuidSchema.optional(),
  origin: addressSchema,
  destination: addressSchema,
  plannedStartAt: z.coerce.date().optional(),
  plannedArrivalAt: z.coerce.date().optional(),
  price: moneySchema.optional(),
  notes: optionalTrimmedString(2000),
  /** Optional explicit route; otherwise the routing provider generates one. */
  plannedRoute: z
    .array(z.object({ latitude: latitudeSchema, longitude: longitudeSchema }))
    .min(2)
    .max(2000)
    .optional(),
});
export type CreateTripInput = z.infer<typeof createTripSchema>;

export const updateTripSchema = z.object({
  /**
   * Move the job to a different vehicle.
   *
   * A dispatch is a plan, and plans change before the wheels turn — the lorry
   * that was going to take it is in the workshop, or a bigger one came free.
   * Allowed only while the trip has not started, for the same reason the
   * driver is: re-pointing a moving trip at another vehicle would orphan the
   * telemetry already recorded against the first.
   */
  truckId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  plannedStartAt: z.coerce.date().optional(),
  plannedArrivalAt: z.coerce.date().optional(),
  price: moneySchema.optional(),
  notes: optionalTrimmedString(2000),
});
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

export const tripTransitionSchema = z.object({
  status: z.nativeEnum(TripStatus),
  note: optionalTrimmedString(500),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});
export type TripTransitionInput = z.infer<typeof tripTransitionSchema>;

export const tripListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  status: csvEnum([
    TripStatus.DRAFT,
    TripStatus.ASSIGNED,
    TripStatus.LOADING,
    TripStatus.STARTED,
    TripStatus.IN_TRANSIT,
    TripStatus.DELAYED,
    TripStatus.ARRIVED,
    TripStatus.UNLOADING,
    TripStatus.COMPLETED,
    TripStatus.CANCELLED,
    TripStatus.EMERGENCY,
    TripStatus.SUSPENDED,
  ]),
  activeOnly: z.coerce.boolean().default(false),
  truckId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  orderId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'plannedStartAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type TripListQuery = z.infer<typeof tripListQuerySchema>;

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/**
 * Normalised location ingestion. Every GPS source — the local simulator, a
 * driver's phone, or a hardware tracker in production — posts this exact shape.
 */
export const trackingLocationSchema = z.object({
  truckId: uuidSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  speedKph: z.coerce.number().min(0).max(200).default(0),
  heading: z.coerce.number().min(0).max(360).default(0),
  accuracy: z.coerce.number().min(0).max(10_000).optional(),
  altitude: z.coerce.number().min(-500).max(10_000).optional(),
  timestamp: z.coerce.date().optional(),
  source: z.nativeEnum(TrackingSource).default(TrackingSource.MOCK),
  tripId: uuidSchema.optional(),
});
export type TrackingLocationInput = z.infer<typeof trackingLocationSchema>;

export const trackingBatchSchema = z.object({
  locations: z.array(trackingLocationSchema).min(1).max(200),
});
export type TrackingBatchInput = z.infer<typeof trackingBatchSchema>;

export const trackingHistoryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tripId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  /** Keep every Nth point — keeps long replays light in the browser. */
  simplify: z.coerce.boolean().default(true),
});
export type TrackingHistoryQuery = z.infer<typeof trackingHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Nearby
// ---------------------------------------------------------------------------

export const nearbySearchSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  category: csvEnum([
    NearbyCategory.FUEL,
    NearbyCategory.FOOD,
    NearbyCategory.PARKING,
    NearbyCategory.WORKSHOP,
    NearbyCategory.TYRE_SHOP,
    NearbyCategory.HOSPITAL,
    NearbyCategory.PHARMACY,
    NearbyCategory.POLICE,
    NearbyCategory.REST_AREA,
    NearbyCategory.CHARGING,
    NearbyCategory.WEIGHBRIDGE,
    NearbyCategory.OTHER,
  ]),
  radiusKm: z.coerce.number().min(0.5).max(200).default(25),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  openNow: z.coerce.boolean().optional(),
});
export type NearbySearchInput = z.infer<typeof nearbySearchSchema>;

export const nearbyTrucksSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.coerce.number().min(1).max(200).default(50),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Include trucks from other fleets that have opted in to visibility. */
  includeOtherFleets: z.coerce.boolean().default(true),
});
export type NearbyTrucksInput = z.infer<typeof nearbyTrucksSchema>;

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

export const triggerSosSchema = z.object({
  type: z.nativeEnum(SosType),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  description: optionalTrimmedString(1000),
  address: optionalTrimmedString(300),
  truckId: uuidSchema.optional(),
  tripId: uuidSchema.optional(),
  contactPhone: optionalTrimmedString(20),
});
export type TriggerSosInput = z.infer<typeof triggerSosSchema>;

export const sosUpdateSchema = z.object({
  status: z.nativeEnum(SosStatus),
  note: optionalTrimmedString(1000),
});
export type SosUpdateInput = z.infer<typeof sosUpdateSchema>;

export const sosResponseSchema = z.object({
  action: z.enum(['ACKNOWLEDGE', 'DECLINE', 'ARRIVED', 'COMPLETE']),
  note: optionalTrimmedString(500),
});
export type SosResponseInput = z.infer<typeof sosResponseSchema>;

export const resolveSosSchema = z.object({
  resolutionNote: trimmedString(5, 1000),
});
export type ResolveSosInput = z.infer<typeof resolveSosSchema>;

export const sosListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    SosStatus.TRIGGERED,
    SosStatus.BROADCASTING,
    SosStatus.ACKNOWLEDGED,
    SosStatus.HELP_ASSIGNED,
    SosStatus.ASSISTANCE_ARRIVED,
    SosStatus.RESOLVED,
    SosStatus.CANCELLED,
  ]),
  type: csvEnum([
    SosType.MEDICAL,
    SosType.ACCIDENT,
    SosType.BREAKDOWN,
    SosType.TYRE,
    SosType.FUEL,
    SosType.SECURITY,
    SosType.OTHER,
  ]),
  activeOnly: z.coerce.boolean().default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type SosListQuery = z.infer<typeof sosListQuerySchema>;

// ---------------------------------------------------------------------------
// Simulation (demo mode only)
// ---------------------------------------------------------------------------

export const startSimulationSchema = z.object({
  truckId: uuidSchema,
  tripId: uuidSchema.optional(),
  /** Explicit route; otherwise the trip's planned route is used. */
  route: z
    .array(z.object({ latitude: latitudeSchema, longitude: longitudeSchema }))
    .min(2)
    .max(2000)
    .optional(),
  baseSpeedKph: z.coerce.number().min(5).max(120).default(45),
  speedMultiplier: z.coerce.number().min(1).max(100).default(1),
  behaviours: z
    .object({
      randomStops: z.boolean().default(false),
      stopProbability: z.coerce.number().min(0).max(1).default(0.02),
      speedVariance: z.coerce.number().min(0).max(1).default(0.2),
      gpsNoiseMeters: z.coerce.number().min(0).max(200).default(8),
      poorConnectivity: z.boolean().default(false),
    })
    .partial()
    .optional(),
});
export type StartSimulationInput = z.infer<typeof startSimulationSchema>;

export const simulationControlSchema = z.object({
  action: z.enum(['PAUSE', 'RESUME', 'STOP', 'RESET']),
});
export type SimulationControlInput = z.infer<typeof simulationControlSchema>;

export const simulationTuneSchema = z.object({
  baseSpeedKph: z.coerce.number().min(5).max(120).optional(),
  speedMultiplier: z.coerce.number().min(1).max(100).optional(),
  /** Push the truck off its planned route to exercise deviation alerts. */
  deviate: z.boolean().optional(),
  /** Inject a delay by holding position for this many simulated minutes. */
  delayMinutes: z.coerce.number().min(1).max(240).optional(),
});
export type SimulationTuneInput = z.infer<typeof simulationTuneSchema>;

// ---------------------------------------------------------------------------
// Analytics & AI
// ---------------------------------------------------------------------------

export const analyticsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Bucket size for time series. */
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const aiChatSchema = z.object({
  conversationId: uuidSchema.optional(),
  message: trimmedString(2, 2000),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

export const aiRecommendationSchema = z.object({
  kind: z.enum([
    'TRUCK_ASSIGNMENT',
    'DRIVER_ASSIGNMENT',
    'MAINTENANCE',
    'ROUTE',
    'FUEL',
    'REST_STOP',
  ]),
  orderId: uuidSchema.optional(),
  tripId: uuidSchema.optional(),
  truckId: uuidSchema.optional(),
});
export type AiRecommendationInput = z.infer<typeof aiRecommendationSchema>;
