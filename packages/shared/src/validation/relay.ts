import { z } from 'zod';
import {
  CityRestrictionKind,
  MaterialUnit,
  RelayReason,
  RelayStatus,
  TruckType,
  VehicleType,
} from '../domain/enums';
import {
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
 * City access and last-mile relay validation.
 *
 * Time windows are minutes from local midnight, and a window that crosses
 * midnight (a 22:00-06:00 night ban) is legal — start may be greater than end.
 * The matcher handles the wrap; the schema must not reject it.
 */

const minutesOfDaySchema = z.coerce.number().int().min(0).max(1439);
const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);

// ---------------------------------------------------------------------------
// City access restrictions
// ---------------------------------------------------------------------------

/** GeoJSON-style ring: [[lng, lat], ...]. */
const polygonSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(3, 'A zone needs at least three points.')
  .max(500, 'That zone has too many points.');

export const createCityRestrictionSchema = z
  .object({
    name: trimmedString(3, 200),
    description: optionalTrimmedString(1000),
    kind: z.nativeEnum(CityRestrictionKind),
    city: trimmedString(2, 120),
    district: optionalTrimmedString(120),
    state: trimmedString(2, 120),
    centerLatitude: latitudeSchema,
    centerLongitude: longitudeSchema,
    radiusKm: z.number().min(0.1).max(200).optional(),
    polygon: polygonSchema.optional(),
    vehicleTypes: z.array(z.nativeEnum(VehicleType)).max(12).default([]),
    truckTypes: z.array(z.nativeEnum(TruckType)).max(12).default([]),
    minCapacityTons: z.number().min(0).max(200).optional(),
    maxHeightMetres: z.number().min(0).max(10).optional(),
    maxAxles: z.number().int().min(2).max(20).optional(),
    daysOfWeek: z.array(dayOfWeekSchema).max(7).default([]),
    startTimeMinutes: minutesOfDaySchema.optional(),
    endTimeMinutes: minutesOfDaySchema.optional(),
    permitAuthority: optionalTrimmedString(160),
    permitUrl: z.string().trim().url().max(500).optional(),
    penaltyNote: optionalTrimmedString(500),
    source: optionalTrimmedString(200),
    sourceUrl: z.string().trim().url().max(500).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    active: z.boolean().default(true),
  })
  .refine((value) => value.radiusKm !== undefined || value.polygon !== undefined, {
    message: 'Give the zone either a radius or a boundary.',
    path: ['radiusKm'],
  })
  .refine(
    (value) =>
      (value.startTimeMinutes === undefined) === (value.endTimeMinutes === undefined),
    { message: 'Set both a start and an end time, or neither.', path: ['endTimeMinutes'] },
  );
export type CreateCityRestrictionInput = z.infer<typeof createCityRestrictionSchema>;

export const updateCityRestrictionSchema = z.object({
  name: optionalTrimmedString(200),
  description: optionalTrimmedString(1000),
  kind: z.nativeEnum(CityRestrictionKind).optional(),
  radiusKm: z.number().min(0.1).max(200).nullable().optional(),
  polygon: polygonSchema.nullable().optional(),
  vehicleTypes: z.array(z.nativeEnum(VehicleType)).max(12).optional(),
  truckTypes: z.array(z.nativeEnum(TruckType)).max(12).optional(),
  minCapacityTons: z.number().min(0).max(200).nullable().optional(),
  maxHeightMetres: z.number().min(0).max(10).nullable().optional(),
  maxAxles: z.number().int().min(2).max(20).nullable().optional(),
  daysOfWeek: z.array(dayOfWeekSchema).max(7).optional(),
  startTimeMinutes: minutesOfDaySchema.nullable().optional(),
  endTimeMinutes: minutesOfDaySchema.nullable().optional(),
  permitAuthority: optionalTrimmedString(160),
  permitUrl: z.string().trim().url().max(500).nullable().optional(),
  penaltyNote: optionalTrimmedString(500),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateCityRestrictionInput = z.infer<typeof updateCityRestrictionSchema>;

export const cityRestrictionListQuerySchema = paginationSchema.extend({
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  kind: csvEnum([
    CityRestrictionKind.NO_ENTRY,
    CityRestrictionKind.TIME_WINDOW,
    CityRestrictionKind.PERMIT_REQUIRED,
    CityRestrictionKind.WEIGHT_LIMIT,
    CityRestrictionKind.HEIGHT_LIMIT,
    CityRestrictionKind.AXLE_LIMIT,
    CityRestrictionKind.ODD_EVEN,
    CityRestrictionKind.ZONE_BAN,
    CityRestrictionKind.CONGESTION_CHARGE,
  ]),
  activeOnly: z.coerce.boolean().optional(),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(500).optional(),
});
export type CityRestrictionListQuery = z.infer<typeof cityRestrictionListQuerySchema>;

/** The pre-dispatch access check. */
export const cityAccessCheckSchema = z
  .object({
    destinationLatitude: latitudeSchema,
    destinationLongitude: longitudeSchema,
    /** Check a real vehicle, or a hypothetical profile. */
    vehicleId: uuidSchema.optional(),
    vehicleType: z.nativeEnum(VehicleType).optional(),
    truckType: z.nativeEnum(TruckType).optional(),
    capacityTons: z.number().min(0).max(200).optional(),
    heightMetres: z.number().min(0).max(10).optional(),
    axles: z.number().int().min(2).max(20).optional(),
    permits: z.array(trimmedString(1, 80)).max(20).default([]),
    arrivalAt: z.coerce.date().optional(),
    /** How long the delivery can realistically wait outside the zone. */
    maxWaitMinutes: z.number().int().min(0).max(1440).default(240),
    /** Where the truck is coming from, used to rank transfer hubs. */
    approachLatitude: latitudeSchema.optional(),
    approachLongitude: longitudeSchema.optional(),
    orderId: uuidSchema.optional(),
  })
  .refine((value) => value.vehicleId !== undefined || value.vehicleType !== undefined, {
    message: 'Name a vehicle or describe one.',
    path: ['vehicleId'],
  });
export type CityAccessCheckInput = z.infer<typeof cityAccessCheckSchema>;

// ---------------------------------------------------------------------------
// Transfer hubs
// ---------------------------------------------------------------------------

export const createTransferHubSchema = z.object({
  name: trimmedString(3, 160),
  code: trimmedString(2, 32).transform((value) => value.toUpperCase()),
  addressLine: trimmedString(3, 300),
  city: trimmedString(2, 120),
  state: trimmedString(2, 120),
  postalCode: optionalTrimmedString(20),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  facilities: z
    .object({
      forklift: z.boolean().optional(),
      crane: z.boolean().optional(),
      covered: z.boolean().optional(),
      weighbridge: z.boolean().optional(),
      security: z.boolean().optional(),
      overnightParking: z.boolean().optional(),
      restroom: z.boolean().optional(),
    })
    .optional(),
  maxVehicleLengthMetres: z.number().min(0).max(30).optional(),
  parkingSlots: z.number().int().min(0).max(1000).optional(),
  openFromMinutes: minutesOfDaySchema.optional(),
  openToMinutes: minutesOfDaySchema.optional(),
  contactName: optionalTrimmedString(120),
  contactPhone: optionalTrimmedString(20),
  handlingChargePerTon: moneySchema.optional(),
  notes: optionalTrimmedString(1000),
  active: z.boolean().default(true),
});
export type CreateTransferHubInput = z.infer<typeof createTransferHubSchema>;

export const updateTransferHubSchema = createTransferHubSchema.partial().omit({ code: true });
export type UpdateTransferHubInput = z.infer<typeof updateTransferHubSchema>;

export const transferHubListQuerySchema = paginationSchema.extend({
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(300).optional(),
  activeOnly: z.coerce.boolean().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  search: optionalTrimmedString(160),
});
export type TransferHubListQuery = z.infer<typeof transferHubListQuerySchema>;

// ---------------------------------------------------------------------------
// Last-mile partner profile
// ---------------------------------------------------------------------------

export const lastMilePartnerSchema = z.object({
  serviceCities: z.array(trimmedString(2, 120)).min(1).max(50),
  maxWeightTons: z.number().min(0.1).max(20).default(1.5),
  vehicleCount: z.number().int().min(0).max(1000).default(0),
  minimumCharge: moneySchema,
  perKmRate: moneySchema,
  perTonRate: moneySchema.optional(),
  handlesFragile: z.boolean().default(false),
  handlesRefrigerated: z.boolean().default(false),
  openFromMinutes: minutesOfDaySchema.optional(),
  openToMinutes: minutesOfDaySchema.optional(),
  active: z.boolean().default(true),
});
export type LastMilePartnerInput = z.infer<typeof lastMilePartnerSchema>;

export const partnerListQuerySchema = paginationSchema.extend({
  city: optionalTrimmedString(120),
  maxWeightTons: z.coerce.number().min(0).max(20).optional(),
  activeOnly: z.coerce.boolean().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
});
export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;

// ---------------------------------------------------------------------------
// Relay deliveries
// ---------------------------------------------------------------------------

export const createRelaySchema = z.object({
  orderId: uuidSchema,
  parentTripId: uuidSchema.optional(),
  transferHubId: uuidSchema.optional(),
  reason: z.nativeEnum(RelayReason),
  restrictionId: uuidSchema.optional(),
  quantity: z.number().positive().max(1_000_000),
  unit: z.nativeEnum(MaterialUnit),
  weightTons: z.number().min(0).max(200).optional(),
  packageCount: z.number().int().min(0).max(100_000).optional(),
  fragile: z.boolean().default(false),
  dropAddress: trimmedString(3, 300),
  dropLatitude: latitudeSchema,
  dropLongitude: longitudeSchema,
  scheduledAt: z.coerce.date().optional(),
  notes: optionalTrimmedString(1000),
});
export type CreateRelayInput = z.infer<typeof createRelaySchema>;

export const relayListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    RelayStatus.DRAFT,
    RelayStatus.REQUESTED,
    RelayStatus.OFFERED,
    RelayStatus.ASSIGNED,
    RelayStatus.EN_ROUTE_TO_HUB,
    RelayStatus.AT_HUB,
    RelayStatus.LOADED,
    RelayStatus.IN_TRANSIT,
    RelayStatus.DELIVERED,
    RelayStatus.FAILED,
    RelayStatus.CANCELLED,
  ]),
  orderId: uuidSchema.optional(),
  city: optionalTrimmedString(120),
  /** Partner view: legs offered to me. */
  asPartner: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type RelayListQuery = z.infer<typeof relayListQuerySchema>;

export const broadcastRelaySchema = z.object({
  radiusKm: z.number().min(1).max(200).default(60),
  /** Offer window before the request is re-broadcast. */
  offerWindowMinutes: z.number().int().min(5).max(720).default(45),
  targetPartnerIds: z.array(uuidSchema).max(50).optional(),
});
export type BroadcastRelayInput = z.infer<typeof broadcastRelaySchema>;

export const createRelayOfferSchema = z.object({
  vehicleId: uuidSchema.optional(),
  price: moneySchema,
  etaMinutes: z.number().int().min(1).max(2880),
  message: optionalTrimmedString(1000),
  expiresAt: z.coerce.date().optional(),
});
export type CreateRelayOfferInput = z.infer<typeof createRelayOfferSchema>;

export const transitionRelaySchema = z.object({
  status: z.nativeEnum(RelayStatus),
  note: optionalTrimmedString(500),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  failureReason: optionalTrimmedString(500),
});
export type TransitionRelayInput = z.infer<typeof transitionRelaySchema>;

/**
 * The custody handover.
 *
 * A count that disagrees with the plan is accepted but flagged — refusing it
 * would leave the driver stuck at a hub with nothing to record, and silently
 * accepting it would lose the discrepancy.
 */
export const relayHandoverSchema = z.object({
  /** QR scan that proved the two vehicles met. */
  qrScanId: uuidSchema.optional(),
  packageCount: z.number().int().min(0).max(100_000).optional(),
  weightTons: z.number().min(0).max(200).optional(),
  /** Media ids of handover photos, already uploaded. */
  mediaIds: z.array(uuidSchema).max(12).default([]),
  discrepancyNote: optionalTrimmedString(1000),
  note: optionalTrimmedString(500),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});
export type RelayHandoverInput = z.infer<typeof relayHandoverSchema>;

export const relayOpportunityQuerySchema = paginationSchema.extend({
  city: optionalTrimmedString(120),
  maxWeightTons: z.coerce.number().min(0).max(20).optional(),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
});
export type RelayOpportunityQuery = z.infer<typeof relayOpportunityQuerySchema>;
