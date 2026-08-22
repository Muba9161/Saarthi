import { z } from 'zod';
import {
  AlertSeverity,
  HazardVote,
  RouteHazardKind,
  RouteHazardSource,
  RouteHazardStatus,
  RouteHazardTier,
} from '../domain/enums';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Route intelligence validation.
 *
 * Two query shapes on purpose. A map needs a bounding box and a hard feature
 * cap; a moving truck needs a corridor along its route. Serving one from the
 * other either floods the browser or misses hazards just off the viewport.
 */

const minutesOfDaySchema = z.coerce.number().int().min(0).max(1439);
const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);
const headingSchema = z.coerce.number().int().min(0).max(359);

const hazardKindsCsv = csvEnum([
  RouteHazardKind.TRAFFIC_SIGNAL,
  RouteHazardKind.SPEED_CAMERA,
  RouteHazardKind.RED_LIGHT_CAMERA,
  RouteHazardKind.AVERAGE_SPEED_ZONE,
  RouteHazardKind.POLICE_CHECKPOINT,
  RouteHazardKind.RTO_CHECKPOST,
  RouteHazardKind.TOLL_PLAZA,
  RouteHazardKind.WEIGHBRIDGE,
  RouteHazardKind.BORDER_CHECKPOST,
  RouteHazardKind.SPEED_BREAKER,
  RouteHazardKind.SHARP_CURVE,
  RouteHazardKind.STEEP_GRADIENT,
  RouteHazardKind.ACCIDENT_PRONE_ZONE,
  RouteHazardKind.SCHOOL_ZONE,
  RouteHazardKind.RAILWAY_CROSSING,
  RouteHazardKind.NARROW_BRIDGE,
  RouteHazardKind.ROAD_WORK,
  RouteHazardKind.DIVERSION,
  RouteHazardKind.ACCIDENT,
  RouteHazardKind.TRAFFIC_JAM,
  RouteHazardKind.WATERLOGGING,
  RouteHazardKind.LANDSLIDE,
  RouteHazardKind.FOG_ZONE,
  RouteHazardKind.PROTEST_BLOCKADE,
  RouteHazardKind.ANIMAL_CROSSING,
  RouteHazardKind.UNLIT_STRETCH,
]);

/**
 * Viewport query.
 *
 * `bbox` is `west,south,east,north`. Parsed here rather than in the route so the
 * client and API agree on the order — swapping two of the four is the classic
 * bug and it fails silently by returning nothing.
 */
export const hazardViewportQuerySchema = z.object({
  bbox: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parts = value.split(',').map((part) => Number(part.trim()));
      if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Give the viewport as west,south,east,north.',
        });
        return z.NEVER;
      }
      const [west, south, east, north] = parts as [number, number, number, number];
      if (south > north || west > east) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The viewport corners are the wrong way round.',
        });
        return z.NEVER;
      }
      return { west, south, east, north };
    }),
  kinds: hazardKindsCsv,
  tiers: csvEnum([RouteHazardTier.STATIC, RouteHazardTier.PREDICTED, RouteHazardTier.LIVE]),
  /** Only what is in force right now. */
  activeNow: z.coerce.boolean().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export type HazardViewportQuery = z.infer<typeof hazardViewportQuerySchema>;

/** Corridor query along a route. */
export const routeHazardQuerySchema = z
  .object({
    /** The planned polyline. Preferred — gives the real corridor. */
    route: z
      .array(z.object({ latitude: latitudeSchema, longitude: longitudeSchema }))
      .min(2)
      .max(20_000)
      .optional(),
    /** Fallback when no polyline is available: a straight origin-destination line. */
    originLatitude: latitudeSchema.optional(),
    originLongitude: longitudeSchema.optional(),
    destinationLatitude: latitudeSchema.optional(),
    destinationLongitude: longitudeSchema.optional(),
    tripId: uuidSchema.optional(),
    corridorMeters: z.number().int().min(50).max(2000).default(300),
    averageSpeedKph: z.number().min(1).max(150).optional(),
    kinds: hazardKindsCsv,
    minConfidence: z.number().min(0).max(1).optional(),
    activeNow: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.route !== undefined ||
      value.tripId !== undefined ||
      (value.originLatitude !== undefined && value.destinationLatitude !== undefined),
    { message: 'Give a route, a trip, or an origin and destination.', path: ['route'] },
  );
export type RouteHazardQuery = z.infer<typeof routeHazardQuerySchema>;

export const createHazardSchema = z
  .object({
    kind: z.nativeEnum(RouteHazardKind),
    name: trimmedString(3, 200),
    description: optionalTrimmedString(1000),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    /** Omit to take the kind's default. */
    radiusMeters: z.number().int().min(20).max(5000).optional(),
    headingDegrees: headingSchema.optional(),
    headingToleranceDegrees: z.number().int().min(10).max(180).default(60),
    speedLimitKph: z.number().int().min(5).max(150).optional(),
    severity: z.nativeEnum(AlertSeverity).optional(),
    tier: z.nativeEnum(RouteHazardTier).optional(),
    source: z.nativeEnum(RouteHazardSource).optional(),
    city: optionalTrimmedString(120),
    district: optionalTrimmedString(120),
    state: optionalTrimmedString(120),
    highway: optionalTrimmedString(60),
    landmark: optionalTrimmedString(200),

    /** Signal cycle, for a predicted phase. All or nothing. */
    signalCycleSeconds: z.number().int().min(10).max(600).optional(),
    signalGreenSeconds: z.number().int().min(3).max(599).optional(),
    signalOffsetSeconds: z.number().int().min(0).max(600).optional(),
    signalReferenceAt: z.coerce.date().optional(),

    daysOfWeek: z.array(dayOfWeekSchema).max(7).default([]),
    startTimeMinutes: minutesOfDaySchema.optional(),
    endTimeMinutes: minutesOfDaySchema.optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    /** Restrict to my own fleet rather than sharing platform-wide. */
    privateToOrganization: z.boolean().default(false),
    sourceUrl: z.string().trim().url().max(500).optional(),
    mediaId: uuidSchema.optional(),
  })
  .refine(
    (value) =>
      value.signalGreenSeconds === undefined ||
      (value.signalCycleSeconds !== undefined &&
        value.signalGreenSeconds < value.signalCycleSeconds),
    {
      message: 'Green time must be shorter than the full cycle.',
      path: ['signalGreenSeconds'],
    },
  )
  .refine(
    (value) =>
      value.signalCycleSeconds === undefined || value.signalReferenceAt !== undefined,
    {
      message: 'A signal cycle needs a reference time to be predictable.',
      path: ['signalReferenceAt'],
    },
  )
  .refine(
    (value) => (value.startTimeMinutes === undefined) === (value.endTimeMinutes === undefined),
    { message: 'Set both a start and an end time, or neither.', path: ['endTimeMinutes'] },
  );
export type CreateHazardInput = z.infer<typeof createHazardSchema>;

export const updateHazardSchema = z.object({
  name: optionalTrimmedString(200),
  description: optionalTrimmedString(1000),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  radiusMeters: z.number().int().min(20).max(5000).optional(),
  headingDegrees: headingSchema.nullable().optional(),
  headingToleranceDegrees: z.number().int().min(10).max(180).optional(),
  speedLimitKph: z.number().int().min(5).max(150).nullable().optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  status: z.nativeEnum(RouteHazardStatus).optional(),
  city: optionalTrimmedString(120),
  district: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  highway: optionalTrimmedString(60),
  landmark: optionalTrimmedString(200),
  signalCycleSeconds: z.number().int().min(10).max(600).nullable().optional(),
  signalGreenSeconds: z.number().int().min(3).max(599).nullable().optional(),
  signalOffsetSeconds: z.number().int().min(0).max(600).nullable().optional(),
  signalReferenceAt: z.coerce.date().nullable().optional(),
  daysOfWeek: z.array(dayOfWeekSchema).max(7).optional(),
  startTimeMinutes: minutesOfDaySchema.nullable().optional(),
  endTimeMinutes: minutesOfDaySchema.nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
});
export type UpdateHazardInput = z.infer<typeof updateHazardSchema>;

export const hazardListQuerySchema = paginationSchema.extend({
  kinds: hazardKindsCsv,
  status: csvEnum([
    RouteHazardStatus.UNVERIFIED,
    RouteHazardStatus.ACTIVE,
    RouteHazardStatus.EXPIRED,
    RouteHazardStatus.REMOVED,
    RouteHazardStatus.REJECTED,
  ]),
  source: csvEnum([
    RouteHazardSource.PLATFORM,
    RouteHazardSource.AUTHORITY,
    RouteHazardSource.PARTNER_FEED,
    RouteHazardSource.DRIVER_REPORT,
    RouteHazardSource.ASSOCIATION,
    RouteHazardSource.TELEMETRY_DERIVED,
  ]),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  search: optionalTrimmedString(160),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),
});
export type HazardListQuery = z.infer<typeof hazardListQuerySchema>;

/**
 * Driver report.
 *
 * `hazardId` is optional: a report near an existing hazard of the same kind is
 * folded into a confirmation vote by the service rather than creating a
 * duplicate pin.
 */
export const reportHazardSchema = z.object({
  hazardId: uuidSchema.optional(),
  kind: z.nativeEnum(RouteHazardKind),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  headingDegrees: headingSchema.optional(),
  note: optionalTrimmedString(500),
  mediaId: uuidSchema.optional(),
  tripId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  speedLimitKph: z.number().int().min(5).max(150).optional(),
  /** How long the reporter expects it to last. */
  expectedDurationMinutes: z.number().int().min(5).max(1440).optional(),
});
export type ReportHazardInput = z.infer<typeof reportHazardSchema>;

export const voteHazardSchema = z.object({
  vote: z.nativeEnum(HazardVote),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  note: optionalTrimmedString(300),
});
export type VoteHazardInput = z.infer<typeof voteHazardSchema>;

export const verifyHazardSchema = z
  .object({
    decision: z.enum(['VERIFY', 'REJECT', 'REMOVE']),
    note: optionalTrimmedString(500),
    /** Promote to an authority-sourced hazard that never decays. */
    markAuthoritative: z.boolean().default(false),
  })
  .refine((value) => value.decision !== 'REJECT' || (value.note?.length ?? 0) > 0, {
    message: 'Say why the report was rejected.',
    path: ['note'],
  });
export type VerifyHazardInput = z.infer<typeof verifyHazardSchema>;

export const hazardReportListQuerySchema = paginationSchema.extend({
  hazardId: uuidSchema.optional(),
  kind: z.nativeEnum(RouteHazardKind).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Reports not yet folded into a hazard. */
  unlinkedOnly: z.coerce.boolean().optional(),
});
export type HazardReportListQuery = z.infer<typeof hazardReportListQuerySchema>;

/** Live look-ahead for a moving vehicle. */
export const lookaheadQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  headingDegrees: headingSchema,
  speedKph: z.coerce.number().min(0).max(200).optional(),
  lookaheadMeters: z.coerce.number().int().min(100).max(5000).default(800),
  tripId: uuidSchema.optional(),
  kinds: hazardKindsCsv,
});
export type LookaheadQuery = z.infer<typeof lookaheadQuerySchema>;

/** Named for hazards specifically — association alerts have their own schema. */
export const acknowledgeHazardAlertSchema = z.object({
  speedKph: z.number().min(0).max(200).optional(),
});
export type AcknowledgeHazardAlertInput = z.infer<typeof acknowledgeHazardAlertSchema>;
