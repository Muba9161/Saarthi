import { z } from 'zod';
import {
  TerminalChecklistItemStatus,
  TerminalIssueCategory,
  TerminalSessionStatus,
} from '../domain/enums';
import { TERMINAL_PAIRING_CODE_PATTERN, normalizeTerminalPairingCode } from '../domain/terminal';
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
 * The Saarthi Terminal wire contract.
 *
 * Two very different callers cross this boundary, and the schemas are split
 * along that line:
 *
 *  * A **terminal** — a tablet bolted to a truck, authenticated as a device.
 *    It never names its vehicle, its driver or its organization. All three are
 *    resolved from its own assignment, so a compromised tablet cannot write
 *    into another fleet's records by editing a field. Nothing below accepts a
 *    `vehicleId`, a `driverId` or an `organizationId` from a terminal.
 *
 *  * A **person** — the driver on their own Saarthi account, and the fleet
 *    owner or mobility provider deciding. Their identity comes from a session
 *    and their authority from the ordinary permission guards.
 *
 * The Android client mirrors these shapes as Kotlin data classes.
 */

// ---------------------------------------------------------------------------
// Pairing (terminal → Saarthi)
// ---------------------------------------------------------------------------

/**
 * What the terminal pairing QR encodes.
 *
 * Its own `kind`, distinct from `saarthi.device.pair`, so a terminal cannot
 * silently redeem a code issued for a test phone and vice versa. The device
 * *type* on the token is what actually enforces that; the marker is so a
 * scanner can refuse an unrelated QR before making a network call.
 */
export const terminalPairingPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('saarthi.terminal.pair'),
  api: z.string().url(),
  token: z.string().min(20).max(200),
});
export type TerminalPairingPayloadInput = z.infer<typeof terminalPairingPayloadSchema>;

/**
 * Redeem a pairing credential.
 *
 * Accepts either the scanned token or the typed `STH-XXXX-XXXX` code, because
 * a terminal with a cracked digitiser still has to pair and reading a
 * 43-character token aloud is not a plan. They are the same credential; the
 * service resolves both to one token hash.
 */
export const pairTerminalSchema = z
  .object({
    token: z.string().min(20).max(200).optional(),
    pairingCode: z
      .string()
      .transform((value) => normalizeTerminalPairingCode(value) ?? value.trim().toUpperCase())
      .pipe(
        z
          .string()
          .regex(TERMINAL_PAIRING_CODE_PATTERN, 'Enter the code as STH-XXXX-XXXX.'),
      )
      .optional(),
    deviceModel: optionalTrimmedString(120),
    osVersion: optionalTrimmedString(60),
    appVersion: optionalTrimmedString(40),
    /** Screen size, so the fleet can see what hardware is actually fitted. */
    screenInches: z.coerce.number().min(3).max(24).nullish(),
  })
  .refine((value) => Boolean(value.token || value.pairingCode), {
    message: 'Scan the pairing QR or enter the pairing code.',
    path: ['pairingCode'],
  });
export type PairTerminalInput = z.infer<typeof pairTerminalSchema>;

/** Issued from the dashboard: Vehicle → Hardware → Connect a terminal. */
export const createTerminalPairingTokenSchema = z.object({
  ttlSeconds: z.coerce.number().int().min(60).max(3_600).optional(),
  note: optionalTrimmedString(300),
});
export type CreateTerminalPairingTokenInput = z.infer<
  typeof createTerminalPairingTokenSchema
>;

// ---------------------------------------------------------------------------
// Driver arrival (person → Saarthi)
// ---------------------------------------------------------------------------

/**
 * A driver asking to be assigned to the vehicle they are standing next to.
 *
 * The proof of presence is the QR token they scanned off the terminal screen —
 * the vehicle's own permanent code, not a per-driver one. There is deliberately
 * no `vehicleId` field: a driver who could name a vehicle could name any
 * vehicle, and this request is supposed to mean "I am at this truck".
 */
export const requestTerminalAssignmentSchema = z.object({
  /** The token from the vehicle QR the driver scanned. */
  qrToken: z.string().min(20).max(200),
  /**
   * The terminal displaying that QR.
   *
   * Optional, and never trusted on its own: the service checks that this
   * terminal is genuinely assigned to the vehicle the token resolves to, and
   * ignores it otherwise. It exists so the right tablet gets the realtime
   * update when a vehicle has more than one device fitted.
   */
  terminalDeviceId: uuidSchema.optional(),
  /** Where the driver was when they scanned. Evidence they were there. */
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  note: optionalTrimmedString(300),
});
export type RequestTerminalAssignmentInput = z.infer<
  typeof requestTerminalAssignmentSchema
>;

/** Metadata sent alongside the selfie upload. The file itself is multipart. */
export const terminalSelfieMetaSchema = z.object({
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  capturedAt: z.coerce.date().optional(),
});
export type TerminalSelfieMetaInput = z.infer<typeof terminalSelfieMetaSchema>;

export const submitTerminalAssignmentSchema = z.object({
  note: optionalTrimmedString(300),
});
export type SubmitTerminalAssignmentInput = z.infer<
  typeof submitTerminalAssignmentSchema
>;

export const cancelTerminalAssignmentSchema = z.object({
  reason: optionalTrimmedString(300),
});
export type CancelTerminalAssignmentInput = z.infer<
  typeof cancelTerminalAssignmentSchema
>;

// ---------------------------------------------------------------------------
// Approval (owner / mobility provider → Saarthi)
// ---------------------------------------------------------------------------

export const approveTerminalAssignmentSchema = z.object({
  note: optionalTrimmedString(500),
  /**
   * Also open a `TruckAssignment`, making this the vehicle's current driver.
   *
   * Defaults to true, because that is what approving somebody onto a truck
   * means everywhere else in Saarthi. A dispatcher who wants the terminal
   * session without disturbing a standing assignment can turn it off.
   */
  assignVehicle: z.boolean().default(true),
});
export type ApproveTerminalAssignmentInput = z.infer<
  typeof approveTerminalAssignmentSchema
>;

export const rejectTerminalAssignmentSchema = z.object({
  /**
   * Required, and shown to the driver.
   *
   * A refusal with no reason is how somebody stands at a truck at 4 a.m. with
   * no idea what to do next. Every error state in this product has to name the
   * next action, and this one is written by a person.
   */
  reason: trimmedString(3, 500),
});
export type RejectTerminalAssignmentInput = z.infer<
  typeof rejectTerminalAssignmentSchema
>;

export const terminalAssignmentListSchema = paginationSchema.extend({
  status: csvEnum([
    TerminalSessionStatus.DRIVER_IDENTIFIED,
    TerminalSessionStatus.SELFIE_SUBMITTED,
    TerminalSessionStatus.PENDING_APPROVAL,
    TerminalSessionStatus.APPROVED,
    TerminalSessionStatus.READY,
    TerminalSessionStatus.TRIP_ACTIVE,
    TerminalSessionStatus.COMPLETED,
    TerminalSessionStatus.REJECTED,
    TerminalSessionStatus.CANCELLED,
    TerminalSessionStatus.EXPIRED,
  ]).optional(),
  vehicleId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  /** Only requests still waiting on a person. The queue's default view. */
  pendingOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === true || value === 'true' || value === '1',
    ),
});
export type TerminalAssignmentListQuery = z.infer<typeof terminalAssignmentListSchema>;

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

/**
 * One line of a submitted checklist.
 *
 * `status` is what the *driver* asserts. Automated verdicts are recomputed
 * server-side from the live reading rather than taken from this payload — a
 * terminal that could post its own coolant verdict could post a passing one.
 */
export const checklistItemResultSchema = z.object({
  code: trimmedString(2, 60),
  status: z.nativeEnum(TerminalChecklistItemStatus),
  note: optionalTrimmedString(500),
});
export type ChecklistItemResultInput = z.infer<typeof checklistItemResultSchema>;

export const submitChecklistSchema = z.object({
  items: z.array(checklistItemResultSchema).min(1).max(50),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  notes: optionalTrimmedString(1_000),
});
export type SubmitChecklistInput = z.infer<typeof submitChecklistSchema>;

/** A fleet editing its own checklist (specification section 17). */
export const checklistTemplateItemSchema = z.object({
  code: z
    .string()
    .transform((value) => value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
    .pipe(z.string().min(2).max(60)),
  label: trimmedString(2, 120),
  description: optionalTrimmedString(500),
  kind: z.enum(['MANUAL', 'TELEMETRY', 'MAINTENANCE', 'DOCUMENT']).default('MANUAL'),
  /** Only meaningful for TELEMETRY items; ignored otherwise. */
  metric: optionalTrimmedString(60),
  blocking: z.boolean().default(false),
  required: z.boolean().default(true),
});
export type ChecklistTemplateItemInput = z.infer<typeof checklistTemplateItemSchema>;

export const updateChecklistTemplateSchema = z.object({
  name: optionalTrimmedString(120),
  /** Null or absent = applies to every vehicle type in the fleet. */
  vehicleType: optionalTrimmedString(40),
  active: z.boolean().default(true),
  /**
   * Bounded at 30. A pre-trip check a driver cannot finish is a pre-trip check
   * that gets tapped through, which is worse than a shorter honest one.
   */
  items: z.array(checklistTemplateItemSchema).min(1).max(30),
});
export type UpdateChecklistTemplateInput = z.infer<typeof updateChecklistTemplateSchema>;

// ---------------------------------------------------------------------------
// Trip lifecycle (terminal → Saarthi)
// ---------------------------------------------------------------------------

export const terminalTripEventSchema = z.object({
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  note: optionalTrimmedString(300),
});
export type TerminalTripEventInput = z.infer<typeof terminalTripEventSchema>;

export const endTerminalSessionSchema = z.object({
  reason: optionalTrimmedString(300),
});
export type EndTerminalSessionInput = z.infer<typeof endTerminalSessionSchema>;

// ---------------------------------------------------------------------------
// Issue reporting (specification section 27)
// ---------------------------------------------------------------------------

export const reportTerminalIssueSchema = z.object({
  category: z.nativeEnum(TerminalIssueCategory).default(TerminalIssueCategory.OTHER),
  description: trimmedString(3, 2_000),
  /**
   * Photographs already uploaded to the media library.
   *
   * Ids, never bytes: the terminal posts the image through the existing media
   * endpoint and references it here, so there is one copy of the photograph and
   * one set of retention rules.
   */
  mediaIds: z.array(uuidSchema).max(6).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
});
export type ReportTerminalIssueInput = z.infer<typeof reportTerminalIssueSchema>;

export const terminalIssueListSchema = paginationSchema.extend({
  status: csvEnum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional(),
  vehicleId: uuidSchema.optional(),
});
export type TerminalIssueListQuery = z.infer<typeof terminalIssueListSchema>;

export const updateTerminalIssueSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']),
  resolutionNote: optionalTrimmedString(1_000),
});
export type UpdateTerminalIssueInput = z.infer<typeof updateTerminalIssueSchema>;

// ---------------------------------------------------------------------------
// Services and assistance (terminal → Saarthi)
// ---------------------------------------------------------------------------

export const terminalNearbySchema = z.object({
  /**
   * A terminal service key such as FUEL or MECHANIC.
   *
   * Absent means "everything nearby". Unknown keys resolve to an empty
   * category list and therefore an empty result, rather than an error: an older
   * terminal build asking for a key this server has dropped should get no
   * results, not a failure in a truck cab.
   */
  service: optionalTrimmedString(40),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.coerce.number().min(1).max(100).default(15),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /**
   * Prefer places suited to this vehicle.
   *
   * Defaults on, because a 40-tonne truck sent to a car-only forecourt is a
   * driver who has wasted an hour and still has no fuel.
   */
  vehicleAware: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === undefined || value === true || value === 'true' || value === '1'),
});
export type TerminalNearbyQuery = z.infer<typeof terminalNearbySchema>;

/**
 * Route me there (specification sections 29 and 44).
 *
 * The origin is sent by the terminal rather than taken from its last telemetry
 * frame, and the difference matters: a driver standing beside a parked truck
 * asking for a mechanic is asking about where *they* are, and the last frame
 * may be a minute and half a kilometre old.
 *
 * There is no `profile` field. The vehicle decides how it is routed — a
 * terminal that could ask to be routed as a car would be a terminal that could
 * send a 40-tonne truck under a low bridge.
 */
export const terminalRouteSchema = z.object({
  fromLatitude: latitudeSchema,
  fromLongitude: longitudeSchema,
  toLatitude: latitudeSchema,
  toLongitude: longitudeSchema,
  /** Shown on the navigation banner. Display only. */
  destinationName: optionalTrimmedString(160),
  /**
   * Avoid toll roads.
   *
   * Off by default. A toll road is usually the faster and safer route for a
   * lorry, and the fleet — not the terminal — is the party paying for it.
   */
  avoidTolls: z.boolean().default(false),
});
export type TerminalRouteInput = z.infer<typeof terminalRouteSchema>;

/**
 * A question for the assistant.
 *
 * `spokenBy` records how the question arrived. It is not decoration: a spoken
 * question gets a spoken-length answer, and a request that arrived while the
 * vehicle was moving must not be answered with a screen of text.
 */
export const terminalAskSchema = z.object({
  question: trimmedString(2, 1_000),
  spokenBy: z.enum(['VOICE', 'TEXT']).default('TEXT'),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  /** True when the vehicle is in motion, so the answer is kept short. */
  moving: z.boolean().optional(),
});
export type TerminalAskInput = z.infer<typeof terminalAskSchema>;

// ---------------------------------------------------------------------------
// Ad-hoc service runs (terminal → Saarthi)
// ---------------------------------------------------------------------------

/**
 * Open a trip for a journey nobody dispatched.
 *
 * Sent when the driver picks a destination out of the nearby-services list and
 * the vehicle has no assigned trip. Everything here describes *where the driver
 * chose to go*; the vehicle, the driver and the fleet are resolved from the
 * terminal's own assignment as they are everywhere else on this surface.
 *
 * The planned route is sent because the terminal already holds it — the routing
 * call was made a moment ago for the map — and asking the server to route the
 * same pair again would spend a second request on an answer already in hand.
 */
export const startAdHocTripSchema = z.object({
  destinationName: trimmedString(1, 160),
  /** The service category the driver was browsing, e.g. FUEL. Display only. */
  service: optionalTrimmedString(40),
  fromLatitude: latitudeSchema,
  fromLongitude: longitudeSchema,
  toLatitude: latitudeSchema,
  toLongitude: longitudeSchema,
  /** Where the vehicle started, in words, when the terminal knows. */
  originName: optionalTrimmedString(160),
  plannedDistanceKm: z.coerce.number().min(0).max(20_000).optional(),
  plannedDurationMinutes: z.coerce.number().int().min(0).max(20_000).optional(),
  /**
   * The polyline the driver is following.
   *
   * Capped rather than unbounded: a terminal on a bad link should not be able to
   * post a megabyte of geometry, and a route long enough to exceed this is one
   * whose shape the fleet map can approximate from far fewer points.
   */
  route: z
    .array(z.object({ latitude: latitudeSchema, longitude: longitudeSchema }))
    .max(2_000)
    .optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
});
export type StartAdHocTripInput = z.infer<typeof startAdHocTripSchema>;

/**
 * What the run added up to.
 *
 * Sent on arrival, and again — with `cancelled` set — when the driver stops
 * navigating before getting there. A cancelled run is still a real journey with
 * real distance on it, so the figures are kept either way; only the trip's
 * closing status differs.
 */
export const finishAdHocTripSchema = z.object({
  tripId: uuidSchema.optional(),
  distanceKm: z.coerce.number().min(0).max(20_000).optional(),
  topSpeedKph: z.coerce.number().min(0).max(400).optional(),
  averageSpeedKph: z.coerce.number().min(0).max(400).optional(),
  harshBrakingCount: z.coerce.number().int().min(0).max(100_000).default(0),
  harshAccelerationCount: z.coerce.number().int().min(0).max(100_000).default(0),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  /** True when the driver stopped navigating rather than arriving. */
  cancelled: z.boolean().default(false),
  reason: optionalTrimmedString(300),
});
export type FinishAdHocTripInput = z.infer<typeof finishAdHocTripSchema>;

/**
 * The odometer, as the vehicle currently reads it.
 *
 * Posted independently of any trip, because a vehicle accrues distance whether
 * or not anybody opened a movement against it — and because the figure needs to
 * reach the maintenance schedule, the passport and the resale valuation, not
 * just the screen in the cab.
 *
 * The server never lets this move a vehicle's odometer backwards. A terminal
 * reinstalled on a truck, or one whose GPS drifted while parked, must not be
 * able to wind the clock back on a service interval.
 */
export const reportOdometerSchema = z.object({
  odometerKm: z.coerce.number().min(0).max(5_000_000),
  /** How the figure was arrived at, so the fleet can judge it. */
  source: z.enum(['OBD', 'GPS', 'MANUAL']).default('GPS'),
  recordedAt: z.coerce.date().optional(),
});
export type ReportOdometerInput = z.infer<typeof reportOdometerSchema>;
