/**
 * Canonical Saarthi domain enumerations.
 *
 * These are declared as frozen const objects (rather than TypeScript `enum`s)
 * so that the exact same string literals are shared by the Prisma schema, the
 * Fastify API, the React client and the test-suite without any runtime bridge.
 *
 * Every value here MUST stay in sync with `apps/api/prisma/schema.prisma`.
 */

function asEnum<const T extends Record<string, string>>(values: T): Readonly<T> {
  return Object.freeze(values);
}

/** Values of a const-object enum as a string union. */
export type EnumValue<T extends Record<string, string>> = T[keyof T];

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const RoleName = asEnum({
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  FLEET_OWNER: 'FLEET_OWNER',
  FLEET_MANAGER: 'FLEET_MANAGER',
  DISPATCHER: 'DISPATCHER',
  DRIVER: 'DRIVER',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  /** Truck-association representative with full control of the association. */
  ASSOCIATION_ADMIN: 'ASSOCIATION_ADMIN',
  /** Association member who works the emergency queue but cannot administer it. */
  ASSOCIATION_RESPONDER: 'ASSOCIATION_RESPONDER',
  /**
   * Taxi / travel / tour operator. Holds the passenger-transport surface —
   * provider profile, packages and bookings — which a freight fleet does not.
   */
  MOBILITY_PROVIDER: 'MOBILITY_PROVIDER',
});
export type RoleName = EnumValue<typeof RoleName>;
export const ROLE_NAMES = Object.values(RoleName) as RoleName[];

export const UserStatus = asEnum({
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
});
export type UserStatus = EnumValue<typeof UserStatus>;

export const OrganizationType = asEnum({
  PLATFORM: 'PLATFORM',
  FLEET_OWNER: 'FLEET_OWNER',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  ENTERPRISE: 'ENTERPRISE',
  /** A district/area truck association coordinating roadside assistance. */
  TRUCK_ASSOCIATION: 'TRUCK_ASSOCIATION',
  /**
   * A taxi / travel / tour business. Note that a FLEET_OWNER can *also* offer
   * mobility services by adding service types to its provider profile — this
   * type is for operators whose only business is passenger transport.
   */
  MOBILITY_PROVIDER: 'MOBILITY_PROVIDER',
});
export type OrganizationType = EnumValue<typeof OrganizationType>;

export const MembershipStatus = asEnum({
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
  REMOVED: 'REMOVED',
});
export type MembershipStatus = EnumValue<typeof MembershipStatus>;

// ---------------------------------------------------------------------------
// Verification & documents
// ---------------------------------------------------------------------------

export const VerificationStatus = asEnum({
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED',
});
export type VerificationStatus = EnumValue<typeof VerificationStatus>;

export const VerificationSubjectType = asEnum({
  USER: 'USER',
  DRIVER: 'DRIVER',
  TRUCK: 'TRUCK',
  ORGANIZATION: 'ORGANIZATION',
});
export type VerificationSubjectType = EnumValue<typeof VerificationSubjectType>;

export const DocumentOwnerType = asEnum({
  USER: 'USER',
  DRIVER: 'DRIVER',
  TRUCK: 'TRUCK',
  ORGANIZATION: 'ORGANIZATION',
  ORDER: 'ORDER',
  TRIP: 'TRIP',
});
export type DocumentOwnerType = EnumValue<typeof DocumentOwnerType>;

/** Persisted review state of an uploaded document. */
export const DocumentVerificationStatus = asEnum({
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
});
export type DocumentVerificationStatus = EnumValue<typeof DocumentVerificationStatus>;

/** Derived (never stored) document health used by dashboards and alerts. */
export const DocumentValidity = asEnum({
  VALID: 'VALID',
  EXPIRING_SOON: 'EXPIRING_SOON',
  EXPIRED: 'EXPIRED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  REJECTED: 'REJECTED',
  NO_EXPIRY: 'NO_EXPIRY',
});
export type DocumentValidity = EnumValue<typeof DocumentValidity>;

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export const TruckStatus = asEnum({
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  ON_TRIP: 'ON_TRIP',
  LOADING: 'LOADING',
  UNLOADING: 'UNLOADING',
  IDLE: 'IDLE',
  MAINTENANCE: 'MAINTENANCE',
  OFFLINE: 'OFFLINE',
  EMERGENCY: 'EMERGENCY',
  SUSPENDED: 'SUSPENDED',
});
export type TruckStatus = EnumValue<typeof TruckStatus>;

export const TruckType = asEnum({
  OPEN_BODY: 'OPEN_BODY',
  CLOSED_CONTAINER: 'CLOSED_CONTAINER',
  TIPPER: 'TIPPER',
  TRAILER: 'TRAILER',
  TANKER: 'TANKER',
  FLATBED: 'FLATBED',
  REFRIGERATED: 'REFRIGERATED',
  MINI_TRUCK: 'MINI_TRUCK',
  MULTI_AXLE: 'MULTI_AXLE',
  OTHER: 'OTHER',
});
export type TruckType = EnumValue<typeof TruckType>;

export const FuelType = asEnum({
  DIESEL: 'DIESEL',
  PETROL: 'PETROL',
  CNG: 'CNG',
  LNG: 'LNG',
  ELECTRIC: 'ELECTRIC',
  HYBRID: 'HYBRID',
});
export type FuelType = EnumValue<typeof FuelType>;

export const AssignmentStatus = asEnum({
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
});
export type AssignmentStatus = EnumValue<typeof AssignmentStatus>;

export const DriverAvailability = asEnum({
  AVAILABLE: 'AVAILABLE',
  ON_TRIP: 'ON_TRIP',
  OFF_DUTY: 'OFF_DUTY',
  ON_LEAVE: 'ON_LEAVE',
  SUSPENDED: 'SUSPENDED',
});
export type DriverAvailability = EnumValue<typeof DriverAvailability>;

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export const MaterialUnit = asEnum({
  TON: 'TON',
  KG: 'KG',
  CUBIC_METER: 'CUBIC_METER',
  LITRE: 'LITRE',
  PIECE: 'PIECE',
  BAG: 'BAG',
  TRIP: 'TRIP',
});
export type MaterialUnit = EnumValue<typeof MaterialUnit>;

export const MaterialStatus = asEnum({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
});
export type MaterialStatus = EnumValue<typeof MaterialStatus>;

export const OrderStatus = asEnum({
  DRAFT: 'DRAFT',
  REQUESTED: 'REQUESTED',
  QUOTED: 'QUOTED',
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  PICKUP: 'PICKUP',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});
export type OrderStatus = EnumValue<typeof OrderStatus>;

export const OrderEventType = asEnum({
  CREATED: 'CREATED',
  QUOTE_ADDED: 'QUOTE_ADDED',
  QUOTE_WITHDRAWN: 'QUOTE_WITHDRAWN',
  QUOTE_ACCEPTED: 'QUOTE_ACCEPTED',
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  TRIP_CREATED: 'TRIP_CREATED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  RATED: 'RATED',
  NOTE: 'NOTE',
});
export type OrderEventType = EnumValue<typeof OrderEventType>;

export const QuoteStatus = asEnum({
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
});
export type QuoteStatus = EnumValue<typeof QuoteStatus>;

// ---------------------------------------------------------------------------
// Requirements — the customer's single front door
// ---------------------------------------------------------------------------

/**
 * What the customer actually needs.
 *
 * A customer arrives with a need, not with a table name. This enum is the
 * first question the requirement wizard asks, and it decides three things at
 * once: which fields the form collects, which kind of business is shown the
 * requirement, and which fulfilment record an awarded bid turns into.
 */
export const RequirementKind = asEnum({
  /** Goods sourced from a supplier, optionally delivered. */
  MATERIAL_SUPPLY: 'MATERIAL_SUPPLY',
  /** The customer already owns the goods and needs a truck. */
  FREIGHT_TRANSPORT: 'FREIGHT_TRANSPORT',
  /** A vehicle with a driver, point-to-point or by the hour/day. */
  CAB_HIRE: 'CAB_HIRE',
  /** A multi-day itinerary priced as a package. */
  TOUR_PACKAGE: 'TOUR_PACKAGE',
});
export type RequirementKind = EnumValue<typeof RequirementKind>;
export const REQUIREMENT_KINDS = Object.values(RequirementKind) as RequirementKind[];

/**
 * What a bidder is offering to supply.
 *
 * Deliberately separate from the requirement kind: one MATERIAL_SUPPLY
 * requirement can attract a supplier quoting for the goods and a fleet quoting
 * to move them, and the customer awards each half on its own merits.
 */
export const RequirementBidScope = asEnum({
  /** The goods themselves, priced ex-yard unless the bid includes delivery. */
  MATERIAL: 'MATERIAL',
  /** Moving the goods. Offered by a freight fleet. */
  TRANSPORT: 'TRANSPORT',
  /** A passenger journey or tour, offered by a mobility provider. */
  TRAVEL: 'TRAVEL',
});
export type RequirementBidScope = EnumValue<typeof RequirementBidScope>;

export const RequirementStatus = asEnum({
  /** Published and visible to the businesses that can serve it. */
  OPEN: 'OPEN',
  /** At least one bid has been received. */
  BIDDING: 'BIDDING',
  /** One half is settled — material awarded, transport still open. */
  PARTIALLY_AWARDED: 'PARTIALLY_AWARDED',
  /** Every half is settled and the fulfilment record has been created. */
  AWARDED: 'AWARDED',
  /** The order or booking it produced reached its end state. */
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
  /** The bidding window closed with nothing awarded. */
  EXPIRED: 'EXPIRED',
});
export type RequirementStatus = EnumValue<typeof RequirementStatus>;

export const RequirementBidStatus = asEnum({
  OFFERED: 'OFFERED',
  /** The customer is considering it. Visible to the bidder as interest. */
  SHORTLISTED: 'SHORTLISTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
});
export type RequirementBidStatus = EnumValue<typeof RequirementBidStatus>;

export const RequirementEventType = asEnum({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  BID_PLACED: 'BID_PLACED',
  BID_UPDATED: 'BID_UPDATED',
  BID_WITHDRAWN: 'BID_WITHDRAWN',
  BID_SHORTLISTED: 'BID_SHORTLISTED',
  BID_ACCEPTED: 'BID_ACCEPTED',
  BID_REJECTED: 'BID_REJECTED',
  AWARDED: 'AWARDED',
  ORDER_CREATED: 'ORDER_CREATED',
  BOOKING_CREATED: 'BOOKING_CREATED',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  NOTE: 'NOTE',
});
export type RequirementEventType = EnumValue<typeof RequirementEventType>;

/** How a cab or tour requirement is priced and scheduled. */
export const HireBasis = asEnum({
  /** A single run from A to B. */
  ONE_WAY: 'ONE_WAY',
  /** Out and back on the same booking. */
  ROUND_TRIP: 'ROUND_TRIP',
  /** The vehicle is retained for a number of hours. */
  HOURLY: 'HOURLY',
  /** The vehicle is retained for whole days. */
  DAILY: 'DAILY',
});
export type HireBasis = EnumValue<typeof HireBasis>;

// ---------------------------------------------------------------------------
// Trips & tracking
// ---------------------------------------------------------------------------

export const TripStatus = asEnum({
  DRAFT: 'DRAFT',
  ASSIGNED: 'ASSIGNED',
  LOADING: 'LOADING',
  STARTED: 'STARTED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELAYED: 'DELAYED',
  ARRIVED: 'ARRIVED',
  UNLOADING: 'UNLOADING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EMERGENCY: 'EMERGENCY',
  SUSPENDED: 'SUSPENDED',
});
export type TripStatus = EnumValue<typeof TripStatus>;

export const TripEventType = asEnum({
  CREATED: 'CREATED',
  ASSIGNED: 'ASSIGNED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  LOADING_STARTED: 'LOADING_STARTED',
  DEPARTED: 'DEPARTED',
  LOCATION_UPDATE: 'LOCATION_UPDATE',
  STOP_STARTED: 'STOP_STARTED',
  STOP_ENDED: 'STOP_ENDED',
  ROUTE_DEVIATION: 'ROUTE_DEVIATION',
  SPEED_VIOLATION: 'SPEED_VIOLATION',
  HARSH_BRAKING: 'HARSH_BRAKING',
  HARSH_ACCELERATION: 'HARSH_ACCELERATION',
  DELAY_DETECTED: 'DELAY_DETECTED',
  ARRIVED: 'ARRIVED',
  UNLOADING_STARTED: 'UNLOADING_STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EMERGENCY: 'EMERGENCY',
  NOTE: 'NOTE',
});
export type TripEventType = EnumValue<typeof TripEventType>;

export const TripStopType = asEnum({
  ORIGIN: 'ORIGIN',
  DESTINATION: 'DESTINATION',
  WAYPOINT: 'WAYPOINT',
  REST: 'REST',
  FUEL: 'FUEL',
  CHECKPOINT: 'CHECKPOINT',
});
export type TripStopType = EnumValue<typeof TripStopType>;

export const TripStopStatus = asEnum({
  PENDING: 'PENDING',
  ARRIVED: 'ARRIVED',
  DEPARTED: 'DEPARTED',
  SKIPPED: 'SKIPPED',
});
export type TripStopStatus = EnumValue<typeof TripStopStatus>;

export const TrackingSource = asEnum({
  MOCK: 'MOCK',
  DEVICE: 'DEVICE',
  PROVIDER: 'PROVIDER',
  MANUAL: 'MANUAL',
});
export type TrackingSource = EnumValue<typeof TrackingSource>;

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const SosType = asEnum({
  MEDICAL: 'MEDICAL',
  ACCIDENT: 'ACCIDENT',
  BREAKDOWN: 'BREAKDOWN',
  TYRE: 'TYRE',
  FUEL: 'FUEL',
  SECURITY: 'SECURITY',
  OTHER: 'OTHER',
});
export type SosType = EnumValue<typeof SosType>;

export const SosStatus = asEnum({
  TRIGGERED: 'TRIGGERED',
  BROADCASTING: 'BROADCASTING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  HELP_ASSIGNED: 'HELP_ASSIGNED',
  ASSISTANCE_ARRIVED: 'ASSISTANCE_ARRIVED',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
});
export type SosStatus = EnumValue<typeof SosStatus>;

export const SosResponderStatus = asEnum({
  NOTIFIED: 'NOTIFIED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ASSIGNED: 'ASSIGNED',
  DECLINED: 'DECLINED',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
});
export type SosResponderStatus = EnumValue<typeof SosResponderStatus>;

export const SosEventType = asEnum({
  TRIGGERED: 'TRIGGERED',
  BROADCAST_STARTED: 'BROADCAST_STARTED',
  RESPONDER_NOTIFIED: 'RESPONDER_NOTIFIED',
  RESPONDER_ACKNOWLEDGED: 'RESPONDER_ACKNOWLEDGED',
  RESPONDER_DECLINED: 'RESPONDER_DECLINED',
  HELP_ASSIGNED: 'HELP_ASSIGNED',
  ASSISTANCE_ARRIVED: 'ASSISTANCE_ARRIVED',
  RADIUS_EXPANDED: 'RADIUS_EXPANDED',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
  NOTE: 'NOTE',
});
export type SosEventType = EnumValue<typeof SosEventType>;

export const NearbyCategory = asEnum({
  FUEL: 'FUEL',
  FOOD: 'FOOD',
  PARKING: 'PARKING',
  WORKSHOP: 'WORKSHOP',
  TYRE_SHOP: 'TYRE_SHOP',
  HOSPITAL: 'HOSPITAL',
  PHARMACY: 'PHARMACY',
  POLICE: 'POLICE',
  REST_AREA: 'REST_AREA',
  CHARGING: 'CHARGING',
  WEIGHBRIDGE: 'WEIGHBRIDGE',
  OTHER: 'OTHER',
});
export type NearbyCategory = EnumValue<typeof NearbyCategory>;
export const NEARBY_CATEGORIES = Object.values(NearbyCategory) as NearbyCategory[];

// ---------------------------------------------------------------------------
// Maintenance & fuel
// ---------------------------------------------------------------------------

export const MaintenanceType = asEnum({
  PREVENTIVE: 'PREVENTIVE',
  REPAIR: 'REPAIR',
  INSPECTION: 'INSPECTION',
  TYRE: 'TYRE',
  OIL_CHANGE: 'OIL_CHANGE',
  BRAKE: 'BRAKE',
  ENGINE: 'ENGINE',
  ELECTRICAL: 'ELECTRICAL',
  BODYWORK: 'BODYWORK',
  OTHER: 'OTHER',
});
export type MaintenanceType = EnumValue<typeof MaintenanceType>;

export const MaintenanceStatus = asEnum({
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type MaintenanceStatus = EnumValue<typeof MaintenanceStatus>;

// ---------------------------------------------------------------------------
// Scoring & achievements
// ---------------------------------------------------------------------------

export const ScoreCategory = asEnum({
  SAFETY: 'SAFETY',
  RELIABILITY: 'RELIABILITY',
  TIMELINESS: 'TIMELINESS',
  COMPLIANCE: 'COMPLIANCE',
  VEHICLE_CARE: 'VEHICLE_CARE',
});
export type ScoreCategory = EnumValue<typeof ScoreCategory>;
export const SCORE_CATEGORIES = Object.values(ScoreCategory) as ScoreCategory[];

export const ScoreEventType = asEnum({
  TRIP_COMPLETED_ON_TIME: 'TRIP_COMPLETED_ON_TIME',
  TRIP_COMPLETED_LATE: 'TRIP_COMPLETED_LATE',
  TRIP_CANCELLED_BY_DRIVER: 'TRIP_CANCELLED_BY_DRIVER',
  SPEED_VIOLATION: 'SPEED_VIOLATION',
  HARSH_BRAKING: 'HARSH_BRAKING',
  HARSH_ACCELERATION: 'HARSH_ACCELERATION',
  ROUTE_DEVIATION: 'ROUTE_DEVIATION',
  DOCUMENT_EXPIRED: 'DOCUMENT_EXPIRED',
  DOCUMENT_RENEWED: 'DOCUMENT_RENEWED',
  CUSTOMER_POSITIVE_RATING: 'CUSTOMER_POSITIVE_RATING',
  CUSTOMER_NEGATIVE_RATING: 'CUSTOMER_NEGATIVE_RATING',
  INCIDENT: 'INCIDENT',
  MAINTENANCE_REPORTED: 'MAINTENANCE_REPORTED',
  MAINTENANCE_NEGLECTED: 'MAINTENANCE_NEGLECTED',
  SOS_ASSISTANCE_PROVIDED: 'SOS_ASSISTANCE_PROVIDED',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
  /** Raised from connected-hardware telemetry rather than phone GPS. */
  EXCESSIVE_IDLING: 'EXCESSIVE_IDLING',
  TELEMETRY_SAFE_DRIVING: 'TELEMETRY_SAFE_DRIVING',
});
export type ScoreEventType = EnumValue<typeof ScoreEventType>;

export const AchievementCode = asEnum({
  SAFE_DRIVER: 'SAFE_DRIVER',
  ON_TIME_CHAMPION: 'ON_TIME_CHAMPION',
  CENTURY_TRIPS: 'CENTURY_TRIPS',
  ZERO_INCIDENT_STREAK: 'ZERO_INCIDENT_STREAK',
  DOCUMENT_PERFECT: 'DOCUMENT_PERFECT',
  FUEL_EFFICIENT: 'FUEL_EFFICIENT',
  CUSTOMER_FAVOURITE: 'CUSTOMER_FAVOURITE',
  EMERGENCY_HELPER: 'EMERGENCY_HELPER',
  FIRST_TRIP: 'FIRST_TRIP',
  LONG_HAULER: 'LONG_HAULER',
});
export type AchievementCode = EnumValue<typeof AchievementCode>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NotificationChannel = asEnum({
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
});
export type NotificationChannel = EnumValue<typeof NotificationChannel>;

export const NotificationPriority = asEnum({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});
export type NotificationPriority = EnumValue<typeof NotificationPriority>;

export const NotificationType = asEnum({
  DOCUMENT_EXPIRING: 'DOCUMENT_EXPIRING',
  DOCUMENT_EXPIRED: 'DOCUMENT_EXPIRED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  VERIFICATION_RESULT: 'VERIFICATION_RESULT',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_QUOTED: 'ORDER_QUOTED',

  // Requirements & bidding
  REQUIREMENT_POSTED: 'REQUIREMENT_POSTED',
  REQUIREMENT_BID_RECEIVED: 'REQUIREMENT_BID_RECEIVED',
  REQUIREMENT_BID_ACCEPTED: 'REQUIREMENT_BID_ACCEPTED',
  REQUIREMENT_BID_REJECTED: 'REQUIREMENT_BID_REJECTED',
  REQUIREMENT_AWARDED: 'REQUIREMENT_AWARDED',
  REQUIREMENT_CANCELLED: 'REQUIREMENT_CANCELLED',

  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  TRIP_ASSIGNED: 'TRIP_ASSIGNED',
  TRIP_STARTED: 'TRIP_STARTED',
  TRIP_DELAYED: 'TRIP_DELAYED',
  TRIP_COMPLETED: 'TRIP_COMPLETED',
  ROUTE_DEVIATION: 'ROUTE_DEVIATION',
  SOS_TRIGGERED: 'SOS_TRIGGERED',
  SOS_RESPONDER_REQUEST: 'SOS_RESPONDER_REQUEST',
  SOS_UPDATE: 'SOS_UPDATE',
  SOS_RESOLVED: 'SOS_RESOLVED',
  MAINTENANCE_DUE: 'MAINTENANCE_DUE',
  MAINTENANCE_OVERDUE: 'MAINTENANCE_OVERDUE',
  DRIVER_SCORE_CHANGED: 'DRIVER_SCORE_CHANGED',
  ACHIEVEMENT_UNLOCKED: 'ACHIEVEMENT_UNLOCKED',
  SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',
  SECURITY_ALERT: 'SECURITY_ALERT',
  SYSTEM: 'SYSTEM',

  // Association emergency network
  ASSOCIATION_ALERT: 'ASSOCIATION_ALERT',
  ASSOCIATION_ALERT_ESCALATED: 'ASSOCIATION_ALERT_ESCALATED',
  ASSOCIATION_ALERT_RESOLVED: 'ASSOCIATION_ALERT_RESOLVED',

  // Travel & mobility
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',

  // Hardware & telemetry
  DEVICE_ASSIGNED: 'DEVICE_ASSIGNED',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_ONLINE: 'DEVICE_ONLINE',
  TELEMETRY_ALERT: 'TELEMETRY_ALERT',
  DIAGNOSTIC_FAULT: 'DIAGNOSTIC_FAULT',

  // Supplier inventory
  STOCK_LOW: 'STOCK_LOW',
  STOCK_OUT: 'STOCK_OUT',
  STOCK_RESTOCKED: 'STOCK_RESTOCKED',
  STOCK_RESERVATION_EXPIRING: 'STOCK_RESERVATION_EXPIRING',

  // Vehicle resale marketplace
  LISTING_PUBLISHED: 'LISTING_PUBLISHED',
  LISTING_REJECTED: 'LISTING_REJECTED',
  LISTING_OFFER_RECEIVED: 'LISTING_OFFER_RECEIVED',
  LISTING_OFFER_COUNTERED: 'LISTING_OFFER_COUNTERED',
  LISTING_OFFER_ACCEPTED: 'LISTING_OFFER_ACCEPTED',
  LISTING_OFFER_REJECTED: 'LISTING_OFFER_REJECTED',
  LISTING_SOLD: 'LISTING_SOLD',
  LISTING_INSPECTION_REQUESTED: 'LISTING_INSPECTION_REQUESTED',
  LISTING_EXPIRING: 'LISTING_EXPIRING',
  VEHICLE_TRANSFER_UPDATED: 'VEHICLE_TRANSFER_UPDATED',

  // Return loads / backhaul
  RETURN_LOAD_MATCH_FOUND: 'RETURN_LOAD_MATCH_FOUND',
  RETURN_LOAD_BOOKED: 'RETURN_LOAD_BOOKED',
  RETURN_LOAD_EXPIRING: 'RETURN_LOAD_EXPIRING',
  EMPTY_RETURN_RISK: 'EMPTY_RETURN_RISK',

  // City access & last-mile relay
  CITY_ACCESS_BLOCKED: 'CITY_ACCESS_BLOCKED',
  RELAY_REQUESTED: 'RELAY_REQUESTED',
  RELAY_OFFER_RECEIVED: 'RELAY_OFFER_RECEIVED',
  RELAY_ASSIGNED: 'RELAY_ASSIGNED',
  RELAY_HANDOVER_READY: 'RELAY_HANDOVER_READY',
  RELAY_DELIVERED: 'RELAY_DELIVERED',

  // Route intelligence
  ROUTE_HAZARD_AHEAD: 'ROUTE_HAZARD_AHEAD',
  ROUTE_HAZARD_VERIFIED: 'ROUTE_HAZARD_VERIFIED',

  // Profile, media & identity
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  QR_CODE_ROTATED: 'QR_CODE_ROTATED',
  MEDIA_MODERATION_REQUIRED: 'MEDIA_MODERATION_REQUIRED',

  // FASTag & toll
  FASTAG_LOW_BALANCE: 'FASTAG_LOW_BALANCE',
  FASTAG_BLACKLISTED: 'FASTAG_BLACKLISTED',
  TOLL_SYNC_CONFLICT: 'TOLL_SYNC_CONFLICT',

  // Vehicle finance — loans and EMI
  LOAN_EMI_DUE_SOON: 'LOAN_EMI_DUE_SOON',
  LOAN_EMI_DUE_TODAY: 'LOAN_EMI_DUE_TODAY',
  LOAN_EMI_OVERDUE: 'LOAN_EMI_OVERDUE',
  LOAN_PAYMENT_RECORDED: 'LOAN_PAYMENT_RECORDED',
  LOAN_CLOSED: 'LOAN_CLOSED',
  LOAN_SYNC_CONFLICT: 'LOAN_SYNC_CONFLICT',

  // Saarthi Terminal — driver arrival and authorisation
  TERMINAL_DRIVER_REQUEST: 'TERMINAL_DRIVER_REQUEST',
  TERMINAL_DRIVER_REQUEST_REMINDER: 'TERMINAL_DRIVER_REQUEST_REMINDER',
  TERMINAL_DRIVER_REQUEST_ESCALATED: 'TERMINAL_DRIVER_REQUEST_ESCALATED',
  TERMINAL_DRIVER_APPROVED: 'TERMINAL_DRIVER_APPROVED',
  TERMINAL_DRIVER_REJECTED: 'TERMINAL_DRIVER_REJECTED',
  TERMINAL_DRIVER_REQUEST_EXPIRED: 'TERMINAL_DRIVER_REQUEST_EXPIRED',
  TERMINAL_CHECKLIST_FAILED: 'TERMINAL_CHECKLIST_FAILED',
  TERMINAL_ISSUE_REPORTED: 'TERMINAL_ISSUE_REPORTED',
});
export type NotificationType = EnumValue<typeof NotificationType>;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const PlanTier = asEnum({
  BASIC: 'BASIC',
  PRO: 'PRO',
  INTELLIGENCE: 'INTELLIGENCE',
  ENTERPRISE: 'ENTERPRISE',
});
export type PlanTier = EnumValue<typeof PlanTier>;
export const PLAN_TIERS = Object.values(PlanTier) as PlanTier[];

export const SubscriptionStatus = asEnum({
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
});
export type SubscriptionStatus = EnumValue<typeof SubscriptionStatus>;

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const AiInsightType = asEnum({
  SUMMARY: 'SUMMARY',
  RECOMMENDATION: 'RECOMMENDATION',
  WARNING: 'WARNING',
  FORECAST: 'FORECAST',
  EXPLANATION: 'EXPLANATION',
  ACTION_SUGGESTION: 'ACTION_SUGGESTION',
});
export type AiInsightType = EnumValue<typeof AiInsightType>;

export const AiMessageRole = asEnum({
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
  SYSTEM: 'SYSTEM',
});
export type AiMessageRole = EnumValue<typeof AiMessageRole>;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const SimulationStatus = asEnum({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
  COMPLETED: 'COMPLETED',
});
export type SimulationStatus = EnumValue<typeof SimulationStatus>;

// ---------------------------------------------------------------------------
// Generalized vehicles
//
// Saarthi began truck-only. Rather than rename the `trucks` table — which would
// have been a destructive migration across ~120 endpoints — a vehicle *type*
// discriminator was added to it. A truck is `vehicleType = TRUCK`; every
// truck-specific column (payload capacity, body type) stays exactly where it
// was, and passenger columns were added alongside.
// ---------------------------------------------------------------------------

export const VehicleType = asEnum({
  TRUCK: 'TRUCK',
  TAXI: 'TAXI',
  CAR: 'CAR',
  BUS: 'BUS',
  VAN: 'VAN',
  SUV: 'SUV',
  TEMPO: 'TEMPO',
  AUTO_RICKSHAW: 'AUTO_RICKSHAW',
  /**
   * Small goods carrier used for city delivery. Added for the last-mile relay:
   * when a heavy vehicle cannot enter a city, a pickup completes the delivery.
   */
  PICKUP: 'PICKUP',
  OTHER: 'OTHER',
});
export type VehicleType = EnumValue<typeof VehicleType>;
export const VEHICLE_TYPES = Object.values(VehicleType) as VehicleType[];

/**
 * What a vehicle type is *able* to do. Business rules read this instead of
 * branching on the type itself, so adding a vehicle type is a data change
 * rather than a code change.
 */
export const VehicleCapability = asEnum({
  FREIGHT: 'FREIGHT',
  PASSENGER_TRANSPORT: 'PASSENGER_TRANSPORT',
  TRAVEL_PACKAGES: 'TRAVEL_PACKAGES',
  LIVE_TRACKING: 'LIVE_TRACKING',
  CARGO_CAPACITY: 'CARGO_CAPACITY',
  PASSENGER_CAPACITY: 'PASSENGER_CAPACITY',
  HARDWARE: 'HARDWARE',
  TELEMETRY: 'TELEMETRY',
});
export type VehicleCapability = EnumValue<typeof VehicleCapability>;
export const VEHICLE_CAPABILITIES = Object.values(VehicleCapability) as VehicleCapability[];

// ---------------------------------------------------------------------------
// Service provider capabilities
// ---------------------------------------------------------------------------

/** A provider organization may hold several of these at once. */
export const ServiceType = asEnum({
  FREIGHT: 'FREIGHT',
  TAXI: 'TAXI',
  TRAVEL: 'TRAVEL',
  TOUR: 'TOUR',
});
export type ServiceType = EnumValue<typeof ServiceType>;
export const SERVICE_TYPES = Object.values(ServiceType) as ServiceType[];

export const ProviderStatus = asEnum({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  SUSPENDED: 'SUSPENDED',
});
export type ProviderStatus = EnumValue<typeof ProviderStatus>;

// ---------------------------------------------------------------------------
// Truck associations & the emergency network
// ---------------------------------------------------------------------------

export const AssociationAlertStatus = asEnum({
  NOTIFIED: 'NOTIFIED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESPONDING: 'RESPONDING',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});
export type AssociationAlertStatus = EnumValue<typeof AssociationAlertStatus>;

export const AlertSeverity = asEnum({
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});
export type AlertSeverity = EnumValue<typeof AlertSeverity>;
export const ALERT_SEVERITIES = Object.values(AlertSeverity) as AlertSeverity[];

export const AssociationAlertEventType = asEnum({
  CREATED: 'CREATED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESPONDER_ASSIGNED: 'RESPONDER_ASSIGNED',
  RESPONDER_UPDATED: 'RESPONDER_UPDATED',
  NOTE_ADDED: 'NOTE_ADDED',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});
export type AssociationAlertEventType = EnumValue<typeof AssociationAlertEventType>;

export const AssociationResponderStatus = asEnum({
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE: 'EN_ROUTE',
  ON_SCENE: 'ON_SCENE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type AssociationResponderStatus = EnumValue<typeof AssociationResponderStatus>;

/** Who is going to the scene — an association member, or an outside service. */
export const AssociationResponderKind = asEnum({
  MEMBER: 'MEMBER',
  EXTERNAL: 'EXTERNAL',
});
export type AssociationResponderKind = EnumValue<typeof AssociationResponderKind>;

// ---------------------------------------------------------------------------
// Travel & tour packages
// ---------------------------------------------------------------------------

export const TravelServiceKind = asEnum({
  LOCAL_SIGHTSEEING: 'LOCAL_SIGHTSEEING',
  INTERCITY: 'INTERCITY',
  MULTI_DAY_TOUR: 'MULTI_DAY_TOUR',
  AIRPORT_TRANSFER: 'AIRPORT_TRANSFER',
  CUSTOM_TRIP: 'CUSTOM_TRIP',
  PILGRIMAGE: 'PILGRIMAGE',
});
export type TravelServiceKind = EnumValue<typeof TravelServiceKind>;
export const TRAVEL_SERVICE_KINDS = Object.values(TravelServiceKind) as TravelServiceKind[];

export const PricingModel = asEnum({
  /** One price for the whole package, whatever the party size. */
  FIXED_PACKAGE: 'FIXED_PACKAGE',
  PER_PERSON: 'PER_PERSON',
  PER_DAY: 'PER_DAY',
  PER_KM: 'PER_KM',
});
export type PricingModel = EnumValue<typeof PricingModel>;

export const TravelPackageStatus = asEnum({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
});
export type TravelPackageStatus = EnumValue<typeof TravelPackageStatus>;

export const BookingStatus = asEnum({
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  DECLINED: 'DECLINED',
  REFUNDED: 'REFUNDED',
});
export type BookingStatus = EnumValue<typeof BookingStatus>;

export const BookingEventType = asEnum({
  CREATED: 'CREATED',
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  TRIP_CREATED: 'TRIP_CREATED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  RATED: 'RATED',
  NOTE: 'NOTE',
});
export type BookingEventType = EnumValue<typeof BookingEventType>;

/** Who initiated a cancellation — drives the refund percentage. */
export const CancelledBy = asEnum({
  CUSTOMER: 'CUSTOMER',
  PROVIDER: 'PROVIDER',
  PLATFORM: 'PLATFORM',
});
export type CancelledBy = EnumValue<typeof CancelledBy>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PaymentStatus = asEnum({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
});
export type PaymentStatus = EnumValue<typeof PaymentStatus>;

export const PaymentPurpose = asEnum({
  TRAVEL_BOOKING: 'TRAVEL_BOOKING',
  ORDER: 'ORDER',
  SUBSCRIPTION: 'SUBSCRIPTION',
  /** Buying a used vehicle through the resale marketplace. */
  VEHICLE_PURCHASE: 'VEHICLE_PURCHASE',
  /** Paying a last-mile partner for a city relay leg. */
  RELAY_DELIVERY: 'RELAY_DELIVERY',
});
export type PaymentPurpose = EnumValue<typeof PaymentPurpose>;

export const PaymentMethod = asEnum({
  MOCK: 'MOCK',
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  CASH: 'CASH',
});
export type PaymentMethod = EnumValue<typeof PaymentMethod>;

// ---------------------------------------------------------------------------
// Hardware devices
// ---------------------------------------------------------------------------

/**
 * A hardware family, not a product SKU. The value selects the ingestion
 * adapter; everything downstream of the adapter is provider-agnostic.
 */
export const DeviceProvider = asEnum({
  /** Freematics ONE+ Model H — the initial physical target. */
  FREEMATICS: 'FREEMATICS',
  /**
   * YC06 four-channel mobile recorder. Video only — Saarthi does not take
   * position from one even where the unit has a GPS receiver, because a vehicle
   * carrying both a Freematics and a YC06 must have exactly one designated
   * telemetry source.
   */
  YC06: 'YC06',
  /**
   * An Android phone running the Saarthi Device app.
   *
   * A real device with real GPS, a real camera and real motion sensors — but no
   * access to the engine. Its engine block is produced by an on-device
   * simulator and is always marked as such, so a phone reading is never
   * mistaken for CAN data.
   */
  MOBILE: 'MOBILE',
  /** The local simulator. Never conflated with real hardware. */
  MOCK: 'MOCK',
  GENERIC_GPS: 'GENERIC_GPS',
  GENERIC_OBD: 'GENERIC_OBD',
  GENERIC_CAN: 'GENERIC_CAN',
});
export type DeviceProvider = EnumValue<typeof DeviceProvider>;
export const DEVICE_PROVIDERS = Object.values(DeviceProvider) as DeviceProvider[];

export const DeviceType = asEnum({
  OBD_TELEMATICS: 'OBD_TELEMATICS',
  GPS_TRACKER: 'GPS_TRACKER',
  CAN_LOGGER: 'CAN_LOGGER',
  J1939_LOGGER: 'J1939_LOGGER',
  DASHCAM: 'DASHCAM',
  /** A recorder with several camera channels, such as the YC06. */
  MULTI_CAMERA: 'MULTI_CAMERA',
  /** A phone running the Saarthi Device app in place of fitted hardware. */
  MOBILE_TEST_DEVICE: 'MOBILE_TEST_DEVICE',
  /**
   * A vehicle-mounted tablet or phone running Saarthi Terminal.
   *
   * Its own type rather than a MOBILE_TEST_DEVICE, because the two are
   * different products: a test phone is carried in and out of a cab by an
   * engineer, a terminal is fitted to one vehicle and stays there. The type is
   * what lets a fleet tell them apart, and what stops a pairing code issued for
   * one being redeemed by the other.
   */
  VEHICLE_TERMINAL: 'VEHICLE_TERMINAL',
  OTHER: 'OTHER',
});
export type DeviceType = EnumValue<typeof DeviceType>;
export const DEVICE_TYPES = Object.values(DeviceType) as DeviceType[];

export const DeviceStatus = asEnum({
  /** Registered but never seen. */
  REGISTERED: 'REGISTERED',
  /** Provisioned and expected to report. */
  ACTIVE: 'ACTIVE',
  /** Active but past its offline threshold. */
  OFFLINE: 'OFFLINE',
  INACTIVE: 'INACTIVE',
  MAINTENANCE: 'MAINTENANCE',
  RETIRED: 'RETIRED',
  /** Credentials revoked — telemetry is rejected. */
  SUSPENDED: 'SUSPENDED',
});
export type DeviceStatus = EnumValue<typeof DeviceStatus>;

export const DeviceAssignmentStatus = asEnum({
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
});
export type DeviceAssignmentStatus = EnumValue<typeof DeviceAssignmentStatus>;

export const DeviceEventType = asEnum({
  REGISTERED: 'REGISTERED',
  UPDATED: 'UPDATED',
  ASSIGNED: 'ASSIGNED',
  UNASSIGNED: 'UNASSIGNED',
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  SECRET_ROTATED: 'SECRET_ROTATED',
  FIRMWARE_REPORTED: 'FIRMWARE_REPORTED',
  SUSPENDED: 'SUSPENDED',
  REACTIVATED: 'REACTIVATED',
  RETIRED: 'RETIRED',
  REJECTED_PAYLOAD: 'REJECTED_PAYLOAD',
  DIAGNOSTIC: 'DIAGNOSTIC',
  /** A device enrolled itself; it holds no tenant until it pairs. */
  ENROLLED: 'ENROLLED',
  /** A pairing token was redeemed and an assignment opened. */
  PAIRED: 'PAIRED',
  /** The device released its own assignment. */
  UNPAIRED: 'UNPAIRED',
  /** A device access token was issued from the device secret. */
  TOKEN_ISSUED: 'TOKEN_ISSUED',
  /** The heartbeat gap crossed the configured threshold. */
  HEARTBEAT_MISSED: 'HEARTBEAT_MISSED',
  /** The device raised an emergency. */
  SOS_RAISED: 'SOS_RAISED',
  COMMAND_ISSUED: 'COMMAND_ISSUED',
  COMMAND_ACKED: 'COMMAND_ACKED',
});
export type DeviceEventType = EnumValue<typeof DeviceEventType>;

/**
 * What a device *does* on a vehicle, as distinct from what it is.
 *
 * Section 35 of the device specification requires one vehicle to carry a
 * Freematics, a YC06 and a phone at once, while section 10 is equally clear
 * that only one of them may be the position source. The role is what reconciles
 * those: any number of CAMERA and AUXILIARY devices may be fitted, but exactly
 * one TELEMETRY device — because two units reporting slightly different
 * positions for the same truck is a support call nobody can resolve.
 */
export const DeviceRole = asEnum({
  /** The designated position and engine-data source. One per vehicle. */
  TELEMETRY: 'TELEMETRY',
  /** Video only. Contributes no position. */
  CAMERA: 'CAMERA',
  /** Sensors, diagnostics or anything else that is not position or video. */
  AUXILIARY: 'AUXILIARY',
});
export type DeviceRole = EnumValue<typeof DeviceRole>;

/**
 * The role each hardware family plays by default.
 *
 * A phone is a TELEMETRY device: on a test vehicle it *is* the position source.
 * When a Freematics is later fitted to the same truck, the phone is unpaired
 * first — which is the migration the specification describes, not a conflict.
 */
export const DEFAULT_DEVICE_ROLE: Record<DeviceProvider, DeviceRole> = {
  [DeviceProvider.FREEMATICS]: DeviceRole.TELEMETRY,
  [DeviceProvider.YC06]: DeviceRole.CAMERA,
  [DeviceProvider.MOBILE]: DeviceRole.TELEMETRY,
  [DeviceProvider.MOCK]: DeviceRole.TELEMETRY,
  [DeviceProvider.GENERIC_GPS]: DeviceRole.TELEMETRY,
  [DeviceProvider.GENERIC_OBD]: DeviceRole.TELEMETRY,
  [DeviceProvider.GENERIC_CAN]: DeviceRole.TELEMETRY,
};

/** Commands Saarthi may send to a connected device. */
export const DeviceCommandType = asEnum({
  START_CAMERA: 'START_CAMERA',
  STOP_CAMERA: 'STOP_CAMERA',
  CHANGE_REPORTING_INTERVAL: 'CHANGE_REPORTING_INTERVAL',
  REQUEST_LOCATION: 'REQUEST_LOCATION',
  PING: 'PING',
  UPDATE_CONFIGURATION: 'UPDATE_CONFIGURATION',
});
export type DeviceCommandType = EnumValue<typeof DeviceCommandType>;
export const DEVICE_COMMAND_TYPES = Object.values(DeviceCommandType) as DeviceCommandType[];

export const DeviceCommandStatus = asEnum({
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  FAILED: 'FAILED',
  /** Never collected before its deadline. */
  EXPIRED: 'EXPIRED',
});
export type DeviceCommandStatus = EnumValue<typeof DeviceCommandStatus>;

/** Connectivity a device reports about itself. */
export const DeviceNetworkType = asEnum({
  WIFI: 'WIFI',
  CELLULAR: 'CELLULAR',
  ETHERNET: 'ETHERNET',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
});
export type DeviceNetworkType = EnumValue<typeof DeviceNetworkType>;

/**
 * A subsystem's own verdict on itself.
 *
 * Reported by the device rather than inferred, because only the device knows
 * the difference between "the user refused the permission" and "the hardware
 * is not there" — and a dashboard that conflates them sends an engineer to
 * look at a phone whose owner simply tapped Deny.
 */
export const DeviceSubsystemStatus = asEnum({
  OK: 'OK',
  DEGRADED: 'DEGRADED',
  /** Present, but the user has not granted access. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});
export type DeviceSubsystemStatus = EnumValue<typeof DeviceSubsystemStatus>;

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * Every value a normalised telemetry reading *may* carry.
 *
 * A reading records which of these it actually contains. Nothing downstream is
 * allowed to render a metric absent from that list — an unsupported metric must
 * read "not reported", never a plausible-looking zero.
 */
export const TelemetryMetric = asEnum({
  LOCATION: 'LOCATION',
  SPEED: 'SPEED',
  HEADING: 'HEADING',
  ALTITUDE: 'ALTITUDE',
  GPS_ACCURACY: 'GPS_ACCURACY',
  SATELLITES: 'SATELLITES',
  RPM: 'RPM',
  ENGINE_LOAD: 'ENGINE_LOAD',
  COOLANT_TEMPERATURE: 'COOLANT_TEMPERATURE',
  INTAKE_TEMPERATURE: 'INTAKE_TEMPERATURE',
  FUEL_LEVEL: 'FUEL_LEVEL',
  FUEL_RATE: 'FUEL_RATE',
  THROTTLE_POSITION: 'THROTTLE_POSITION',
  BATTERY_VOLTAGE: 'BATTERY_VOLTAGE',
  ODOMETER: 'ODOMETER',
  VIN: 'VIN',
  DTC: 'DTC',
  ACCELEROMETER: 'ACCELEROMETER',
  DEVICE_TEMPERATURE: 'DEVICE_TEMPERATURE',
  SIGNAL_STRENGTH: 'SIGNAL_STRENGTH',
});
export type TelemetryMetric = EnumValue<typeof TelemetryMetric>;
export const TELEMETRY_METRICS = Object.values(TelemetryMetric) as TelemetryMetric[];

export const TelemetryAlertType = asEnum({
  OVERSPEED: 'OVERSPEED',
  HARSH_BRAKING: 'HARSH_BRAKING',
  HARSH_ACCELERATION: 'HARSH_ACCELERATION',
  EXCESSIVE_IDLING: 'EXCESSIVE_IDLING',
  ENGINE_TEMPERATURE: 'ENGINE_TEMPERATURE',
  LOW_VOLTAGE: 'LOW_VOLTAGE',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  ROUTE_DEVIATION: 'ROUTE_DEVIATION',
  GEOFENCE_BREACH: 'GEOFENCE_BREACH',
  DIAGNOSTIC_FAULT: 'DIAGNOSTIC_FAULT',
  FUEL_DROP: 'FUEL_DROP',
  UNUSUAL_BEHAVIOUR: 'UNUSUAL_BEHAVIOUR',
});
export type TelemetryAlertType = EnumValue<typeof TelemetryAlertType>;
export const TELEMETRY_ALERT_TYPES = Object.values(TelemetryAlertType) as TelemetryAlertType[];

export const TelemetryAlertStatus = asEnum({
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
});
export type TelemetryAlertStatus = EnumValue<typeof TelemetryAlertStatus>;

/** Whether a geofence is somewhere the vehicle must stay in, or stay out of. */
export const GeofenceKind = asEnum({
  INCLUSION: 'INCLUSION',
  EXCLUSION: 'EXCLUSION',
});
export type GeofenceKind = EnumValue<typeof GeofenceKind>;

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

/** Every entity an image may be attached to. */
export const MediaOwnerType = asEnum({
  USER: 'USER',
  ORGANIZATION: 'ORGANIZATION',
  DRIVER: 'DRIVER',
  VEHICLE: 'VEHICLE',
  MATERIAL: 'MATERIAL',
  INVENTORY_LOCATION: 'INVENTORY_LOCATION',
  ORDER: 'ORDER',
  TRIP: 'TRIP',
  SOS_INCIDENT: 'SOS_INCIDENT',
  MAINTENANCE_RECORD: 'MAINTENANCE_RECORD',
  FUEL_RECORD: 'FUEL_RECORD',
  VEHICLE_LISTING: 'VEHICLE_LISTING',
  TRAVEL_PACKAGE: 'TRAVEL_PACKAGE',
  ROUTE_HAZARD: 'ROUTE_HAZARD',
  RELAY_DELIVERY: 'RELAY_DELIVERY',
  TRANSFER_HUB: 'TRANSFER_HUB',
  NEARBY_PLACE: 'NEARBY_PLACE',
  PETROL_STATION: 'PETROL_STATION',
  ASSOCIATION: 'ASSOCIATION',
  DEVICE: 'DEVICE',
});
export type MediaOwnerType = EnumValue<typeof MediaOwnerType>;
export const MEDIA_OWNER_TYPES = Object.values(MediaOwnerType) as MediaOwnerType[];

/** What the image is *for*. Drives placement, cropping and default visibility. */
export const MediaPurpose = asEnum({
  AVATAR: 'AVATAR',
  LOGO: 'LOGO',
  COVER: 'COVER',
  GALLERY: 'GALLERY',
  PRODUCT: 'PRODUCT',
  VEHICLE_EXTERIOR: 'VEHICLE_EXTERIOR',
  VEHICLE_INTERIOR: 'VEHICLE_INTERIOR',
  VEHICLE_DAMAGE: 'VEHICLE_DAMAGE',
  ODOMETER: 'ODOMETER',
  PROOF_OF_PICKUP: 'PROOF_OF_PICKUP',
  PROOF_OF_DELIVERY: 'PROOF_OF_DELIVERY',
  HANDOVER: 'HANDOVER',
  INCIDENT: 'INCIDENT',
  HAZARD_EVIDENCE: 'HAZARD_EVIDENCE',
  INSPECTION: 'INSPECTION',
  SIGNATURE: 'SIGNATURE',
  ATTACHMENT: 'ATTACHMENT',
  /**
   * A driver arrival selfie taken at a Saarthi Terminal.
   *
   * Its own purpose rather than reusing HANDOVER: it is a photograph of a
   * person, taken to prove they were physically at a vehicle, and it has to be
   * findable — and deletable — as that rather than folded in with cargo photos.
   */
  DRIVER_VERIFICATION: 'DRIVER_VERIFICATION',
});
export type MediaPurpose = EnumValue<typeof MediaPurpose>;
export const MEDIA_PURPOSES = Object.values(MediaPurpose) as MediaPurpose[];

/**
 * Who may fetch the bytes.
 *
 * PUBLIC is deliberately the narrowest-used value: it exists for marketing
 * imagery only, because anything servable without a session cannot be recalled.
 */
export const MediaVisibility = asEnum({
  PRIVATE: 'PRIVATE',
  ORGANIZATION: 'ORGANIZATION',
  PLATFORM: 'PLATFORM',
  PUBLIC: 'PUBLIC',
});
export type MediaVisibility = EnumValue<typeof MediaVisibility>;

export const MediaModerationStatus = asEnum({
  APPROVED: 'APPROVED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  REJECTED: 'REJECTED',
});
export type MediaModerationStatus = EnumValue<typeof MediaModerationStatus>;

// ---------------------------------------------------------------------------
// Supplier inventory
// ---------------------------------------------------------------------------

export const InventoryLocationKind = asEnum({
  YARD: 'YARD',
  WAREHOUSE: 'WAREHOUSE',
  DEPOT: 'DEPOT',
  QUARRY: 'QUARRY',
  PLANT: 'PLANT',
  RETAIL_COUNTER: 'RETAIL_COUNTER',
  TRANSIT: 'TRANSIT',
});
export type InventoryLocationKind = EnumValue<typeof InventoryLocationKind>;

/**
 * Ledger entry kinds.
 *
 * RESERVE and RELEASE move the *reserved* column and leave on-hand alone;
 * CONSUME is what finally removes goods from the yard. Keeping the three apart
 * is what lets two customers be told the truth about the same 30 tonnes.
 */
export const StockMovementType = asEnum({
  OPENING_BALANCE: 'OPENING_BALANCE',
  RECEIPT: 'RECEIPT',
  ISSUE: 'ISSUE',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
  CONSUME: 'CONSUME',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  RETURN_IN: 'RETURN_IN',
  DAMAGE: 'DAMAGE',
  COUNT_CORRECTION: 'COUNT_CORRECTION',
});
export type StockMovementType = EnumValue<typeof StockMovementType>;
export const STOCK_MOVEMENT_TYPES = Object.values(StockMovementType) as StockMovementType[];

export const StockReservationStatus = asEnum({
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
});
export type StockReservationStatus = EnumValue<typeof StockReservationStatus>;

export const MaterialAvailabilityMode = asEnum({
  IN_STOCK: 'IN_STOCK',
  MADE_TO_ORDER: 'MADE_TO_ORDER',
  ON_REQUEST: 'ON_REQUEST',
});
export type MaterialAvailabilityMode = EnumValue<typeof MaterialAvailabilityMode>;

export const StockAvailabilityStatus = asEnum({
  IN_STOCK: 'IN_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  MADE_TO_ORDER: 'MADE_TO_ORDER',
  ON_REQUEST: 'ON_REQUEST',
  DISCONTINUED: 'DISCONTINUED',
});
export type StockAvailabilityStatus = EnumValue<typeof StockAvailabilityStatus>;
export const STOCK_AVAILABILITY_STATUSES = Object.values(
  StockAvailabilityStatus,
) as StockAvailabilityStatus[];

// ---------------------------------------------------------------------------
// Vehicle resale marketplace
// ---------------------------------------------------------------------------

export const VehicleListingStatus = asEnum({
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PUBLISHED: 'PUBLISHED',
  RESERVED: 'RESERVED',
  SOLD: 'SOLD',
  WITHDRAWN: 'WITHDRAWN',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});
export type VehicleListingStatus = EnumValue<typeof VehicleListingStatus>;
export const VEHICLE_LISTING_STATUSES = Object.values(
  VehicleListingStatus,
) as VehicleListingStatus[];

/**
 * Listing reach.
 *
 * Note what is missing: there is no PUBLIC value. The requirement is explicit
 * that resale has no external user, so the widest reach is every *signed-in*
 * Saarthi organization.
 */
export const VehicleListingVisibility = asEnum({
  ORGANIZATION: 'ORGANIZATION',
  ASSOCIATION: 'ASSOCIATION',
  PLATFORM: 'PLATFORM',
});
export type VehicleListingVisibility = EnumValue<typeof VehicleListingVisibility>;

export const VehicleCondition = asEnum({
  EXCELLENT: 'EXCELLENT',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  NEEDS_REPAIR: 'NEEDS_REPAIR',
  NON_RUNNING: 'NON_RUNNING',
});
export type VehicleCondition = EnumValue<typeof VehicleCondition>;
export const VEHICLE_CONDITIONS = Object.values(VehicleCondition) as VehicleCondition[];

export const VehicleOfferStatus = asEnum({
  OFFERED: 'OFFERED',
  COUNTERED: 'COUNTERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
});
export type VehicleOfferStatus = EnumValue<typeof VehicleOfferStatus>;

export const VehicleInspectionStatus = asEnum({
  REQUESTED: 'REQUESTED',
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
});
export type VehicleInspectionStatus = EnumValue<typeof VehicleInspectionStatus>;

export const VehicleTransferStatus = asEnum({
  PENDING: 'PENDING',
  DOCUMENTS_PENDING: 'DOCUMENTS_PENDING',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type VehicleTransferStatus = EnumValue<typeof VehicleTransferStatus>;

export const VehicleListingEventType = asEnum({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  SUBMITTED: 'SUBMITTED',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_COUNTERED: 'OFFER_COUNTERED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  OFFER_WITHDRAWN: 'OFFER_WITHDRAWN',
  INSPECTION_REQUESTED: 'INSPECTION_REQUESTED',
  INSPECTION_COMPLETED: 'INSPECTION_COMPLETED',
  RESERVED: 'RESERVED',
  SOLD: 'SOLD',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
  TRANSFER_STARTED: 'TRANSFER_STARTED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  NOTE: 'NOTE',
});
export type VehicleListingEventType = EnumValue<typeof VehicleListingEventType>;

// ---------------------------------------------------------------------------
// Profile builder
// ---------------------------------------------------------------------------

export const ProfileVisibility = asEnum({
  PRIVATE: 'PRIVATE',
  PLATFORM: 'PLATFORM',
  PARTNERS: 'PARTNERS',
});
export type ProfileVisibility = EnumValue<typeof ProfileVisibility>;

// ---------------------------------------------------------------------------
// QR identity
// ---------------------------------------------------------------------------

export const QrSubjectType = asEnum({
  DRIVER: 'DRIVER',
  VEHICLE: 'VEHICLE',
  USER: 'USER',
  TRIP: 'TRIP',
  ORDER: 'ORDER',
  VEHICLE_LISTING: 'VEHICLE_LISTING',
  INVENTORY_LOCATION: 'INVENTORY_LOCATION',
  TRANSFER_HUB: 'TRANSFER_HUB',
  RELAY_DELIVERY: 'RELAY_DELIVERY',
});
export type QrSubjectType = EnumValue<typeof QrSubjectType>;
export const QR_SUBJECT_TYPES = Object.values(QrSubjectType) as QrSubjectType[];

export const QrCodeStatus = asEnum({
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
});
export type QrCodeStatus = EnumValue<typeof QrCodeStatus>;

/**
 * What a scan is allowed to disclose.
 *
 * Scopes are stored on the code and then *intersected* with what the scanner is
 * entitled to see, so printing a sticker can never widen disclosure.
 */
export const QrScope = asEnum({
  IDENTITY: 'IDENTITY',
  CONTACT: 'CONTACT',
  VEHICLE_SUMMARY: 'VEHICLE_SUMMARY',
  DRIVER_SUMMARY: 'DRIVER_SUMMARY',
  COMPLIANCE: 'COMPLIANCE',
  ASSIGNMENT: 'ASSIGNMENT',
  TRIP_STATUS: 'TRIP_STATUS',
  ORDER_STATUS: 'ORDER_STATUS',
  EMERGENCY: 'EMERGENCY',
  HANDOVER: 'HANDOVER',
});
export type QrScope = EnumValue<typeof QrScope>;
export const QR_SCOPES = Object.values(QrScope) as QrScope[];

export const QrScanResult = asEnum({
  ALLOWED: 'ALLOWED',
  DENIED: 'DENIED',
  NOT_FOUND: 'NOT_FOUND',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
});
export type QrScanResult = EnumValue<typeof QrScanResult>;

export const QrScanPurpose = asEnum({
  IDENTITY_CHECK: 'IDENTITY_CHECK',
  ASSIGNMENT: 'ASSIGNMENT',
  CHECKPOINT: 'CHECKPOINT',
  PICKUP: 'PICKUP',
  DELIVERY_HANDOVER: 'DELIVERY_HANDOVER',
  INSPECTION: 'INSPECTION',
  EMERGENCY: 'EMERGENCY',
  PUBLIC_VIEW: 'PUBLIC_VIEW',
});
export type QrScanPurpose = EnumValue<typeof QrScanPurpose>;

// ---------------------------------------------------------------------------
// Return loads / backhaul
// ---------------------------------------------------------------------------

export const ReturnLoadStatus = asEnum({
  OPEN: 'OPEN',
  MATCHED: 'MATCHED',
  BOOKED: 'BOOKED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
});
export type ReturnLoadStatus = EnumValue<typeof ReturnLoadStatus>;
export const RETURN_LOAD_STATUSES = Object.values(ReturnLoadStatus) as ReturnLoadStatus[];

export const ReturnLoadMatchStatus = asEnum({
  SUGGESTED: 'SUGGESTED',
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});
export type ReturnLoadMatchStatus = EnumValue<typeof ReturnLoadMatchStatus>;

/** Which leg of a movement a trip represents. */
export const TripLegType = asEnum({
  PRIMARY: 'PRIMARY',
  RETURN: 'RETURN',
  RELAY_LAST_MILE: 'RELAY_LAST_MILE',
});
export type TripLegType = EnumValue<typeof TripLegType>;

// ---------------------------------------------------------------------------
// City access & last-mile relay
// ---------------------------------------------------------------------------

export const CityRestrictionKind = asEnum({
  NO_ENTRY: 'NO_ENTRY',
  TIME_WINDOW: 'TIME_WINDOW',
  PERMIT_REQUIRED: 'PERMIT_REQUIRED',
  WEIGHT_LIMIT: 'WEIGHT_LIMIT',
  HEIGHT_LIMIT: 'HEIGHT_LIMIT',
  AXLE_LIMIT: 'AXLE_LIMIT',
  ODD_EVEN: 'ODD_EVEN',
  ZONE_BAN: 'ZONE_BAN',
  CONGESTION_CHARGE: 'CONGESTION_CHARGE',
});
export type CityRestrictionKind = EnumValue<typeof CityRestrictionKind>;
export const CITY_RESTRICTION_KINDS = Object.values(CityRestrictionKind) as CityRestrictionKind[];

/** What the access check tells the dispatcher to do. */
export const CityAccessRecommendation = asEnum({
  ALLOWED: 'ALLOWED',
  WAIT_FOR_WINDOW: 'WAIT_FOR_WINDOW',
  PERMIT_REQUIRED: 'PERMIT_REQUIRED',
  RELAY: 'RELAY',
  REROUTE: 'REROUTE',
});
export type CityAccessRecommendation = EnumValue<typeof CityAccessRecommendation>;

export const RelayStatus = asEnum({
  DRAFT: 'DRAFT',
  REQUESTED: 'REQUESTED',
  OFFERED: 'OFFERED',
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE_TO_HUB: 'EN_ROUTE_TO_HUB',
  AT_HUB: 'AT_HUB',
  LOADED: 'LOADED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});
export type RelayStatus = EnumValue<typeof RelayStatus>;
export const RELAY_STATUSES = Object.values(RelayStatus) as RelayStatus[];

export const RelayReason = asEnum({
  CITY_NO_ENTRY: 'CITY_NO_ENTRY',
  TIME_WINDOW: 'TIME_WINDOW',
  WEIGHT_LIMIT: 'WEIGHT_LIMIT',
  HEIGHT_LIMIT: 'HEIGHT_LIMIT',
  PERMIT_MISSING: 'PERMIT_MISSING',
  NARROW_ACCESS: 'NARROW_ACCESS',
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  MULTI_DROP_SPLIT: 'MULTI_DROP_SPLIT',
});
export type RelayReason = EnumValue<typeof RelayReason>;
export const RELAY_REASONS = Object.values(RelayReason) as RelayReason[];

export const RelayOfferStatus = asEnum({
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
});
export type RelayOfferStatus = EnumValue<typeof RelayOfferStatus>;

export const RelayEventType = asEnum({
  CREATED: 'CREATED',
  REQUESTED: 'REQUESTED',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  ASSIGNED: 'ASSIGNED',
  ARRIVED_AT_HUB: 'ARRIVED_AT_HUB',
  HANDOVER_STARTED: 'HANDOVER_STARTED',
  HANDOVER_VERIFIED: 'HANDOVER_VERIFIED',
  DISCREPANCY_RAISED: 'DISCREPANCY_RAISED',
  LOADED: 'LOADED',
  DEPARTED: 'DEPARTED',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  NOTE: 'NOTE',
});
export type RelayEventType = EnumValue<typeof RelayEventType>;

// ---------------------------------------------------------------------------
// Route intelligence
// ---------------------------------------------------------------------------

export const RouteHazardKind = asEnum({
  TRAFFIC_SIGNAL: 'TRAFFIC_SIGNAL',
  SPEED_CAMERA: 'SPEED_CAMERA',
  RED_LIGHT_CAMERA: 'RED_LIGHT_CAMERA',
  AVERAGE_SPEED_ZONE: 'AVERAGE_SPEED_ZONE',
  POLICE_CHECKPOINT: 'POLICE_CHECKPOINT',
  RTO_CHECKPOST: 'RTO_CHECKPOST',
  TOLL_PLAZA: 'TOLL_PLAZA',
  WEIGHBRIDGE: 'WEIGHBRIDGE',
  BORDER_CHECKPOST: 'BORDER_CHECKPOST',
  SPEED_BREAKER: 'SPEED_BREAKER',
  SHARP_CURVE: 'SHARP_CURVE',
  STEEP_GRADIENT: 'STEEP_GRADIENT',
  ACCIDENT_PRONE_ZONE: 'ACCIDENT_PRONE_ZONE',
  SCHOOL_ZONE: 'SCHOOL_ZONE',
  RAILWAY_CROSSING: 'RAILWAY_CROSSING',
  NARROW_BRIDGE: 'NARROW_BRIDGE',
  ROAD_WORK: 'ROAD_WORK',
  DIVERSION: 'DIVERSION',
  ACCIDENT: 'ACCIDENT',
  TRAFFIC_JAM: 'TRAFFIC_JAM',
  WATERLOGGING: 'WATERLOGGING',
  LANDSLIDE: 'LANDSLIDE',
  FOG_ZONE: 'FOG_ZONE',
  PROTEST_BLOCKADE: 'PROTEST_BLOCKADE',
  ANIMAL_CROSSING: 'ANIMAL_CROSSING',
  UNLIT_STRETCH: 'UNLIT_STRETCH',
});
export type RouteHazardKind = EnumValue<typeof RouteHazardKind>;
export const ROUTE_HAZARD_KINDS = Object.values(RouteHazardKind) as RouteHazardKind[];

/**
 * How much a hazard value can be trusted.
 *
 * There is no national live traffic-signal feed in India, so a signal phase is
 * PREDICTED from its cycle and labelled as such. Showing a predicted value as
 * live would put a wrong number in front of a driver at 60 km/h.
 */
export const RouteHazardTier = asEnum({
  STATIC: 'STATIC',
  PREDICTED: 'PREDICTED',
  LIVE: 'LIVE',
});
export type RouteHazardTier = EnumValue<typeof RouteHazardTier>;

export const RouteHazardSource = asEnum({
  PLATFORM: 'PLATFORM',
  AUTHORITY: 'AUTHORITY',
  PARTNER_FEED: 'PARTNER_FEED',
  DRIVER_REPORT: 'DRIVER_REPORT',
  ASSOCIATION: 'ASSOCIATION',
  TELEMETRY_DERIVED: 'TELEMETRY_DERIVED',
});
export type RouteHazardSource = EnumValue<typeof RouteHazardSource>;

export const RouteHazardStatus = asEnum({
  UNVERIFIED: 'UNVERIFIED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REMOVED: 'REMOVED',
  REJECTED: 'REJECTED',
});
export type RouteHazardStatus = EnumValue<typeof RouteHazardStatus>;

export const HazardVote = asEnum({
  CONFIRM: 'CONFIRM',
  REJECT: 'REJECT',
  CLEARED: 'CLEARED',
});
export type HazardVote = EnumValue<typeof HazardVote>;

/** Predicted phase of a modelled traffic signal. */
export const SignalPhase = asEnum({
  GREEN: 'GREEN',
  AMBER: 'AMBER',
  RED: 'RED',
  UNKNOWN: 'UNKNOWN',
});
export type SignalPhase = EnumValue<typeof SignalPhase>;

// ---------------------------------------------------------------------------
// Vehicle finance — loans, EMI schedules and repayments
// ---------------------------------------------------------------------------

export const LoanType = asEnum({
  /** Standard vehicle term loan, repaid on a fixed EMI schedule. */
  TERM_LOAN: 'TERM_LOAN',
  /** Financier holds hypothecation on the RC until the loan closes. */
  HYPOTHECATION: 'HYPOTHECATION',
  LEASE: 'LEASE',
  HIRE_PURCHASE: 'HIRE_PURCHASE',
  REFINANCE: 'REFINANCE',
  /** Additional borrowing on an existing vehicle loan. */
  TOP_UP: 'TOP_UP',
  WORKING_CAPITAL: 'WORKING_CAPITAL',
  OTHER: 'OTHER',
});
export type LoanType = EnumValue<typeof LoanType>;

export const InterestType = asEnum({
  /** Interest computed on the original principal for the whole tenure. */
  FLAT: 'FLAT',
  /** Interest computed on the outstanding balance — the usual EMI formula. */
  REDUCING_BALANCE: 'REDUCING_BALANCE',
  /** Reducing balance whose rate may be revised by the lender. */
  FLOATING: 'FLOATING',
});
export type InterestType = EnumValue<typeof InterestType>;

export const EmiFrequency = asEnum({
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  HALF_YEARLY: 'HALF_YEARLY',
  ANNUAL: 'ANNUAL',
});
export type EmiFrequency = EnumValue<typeof EmiFrequency>;

export const LoanStatus = asEnum({
  /** Recorded but not yet disbursed — no schedule is generated. */
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  /** Repayment paused by agreement with the lender. */
  ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED',
  /** Settled ahead of tenure. */
  FORECLOSED: 'FORECLOSED',
  DEFAULTED: 'DEFAULTED',
  CANCELLED: 'CANCELLED',
});
export type LoanStatus = EnumValue<typeof LoanStatus>;

/**
 * Installment lifecycle.
 *
 * `UNKNOWN` is deliberate and not a placeholder: an installment imported from a
 * lender statement whose payment state was not disclosed must not be shown as
 * PAID or as OVERDUE, because both would be an assertion Saarthi cannot make.
 */
export const InstallmentStatus = asEnum({
  UPCOMING: 'UPCOMING',
  DUE_SOON: 'DUE_SOON',
  DUE_TODAY: 'DUE_TODAY',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  WAIVED: 'WAIVED',
  UNKNOWN: 'UNKNOWN',
});
export type InstallmentStatus = EnumValue<typeof InstallmentStatus>;

/** Where a finance record — or a single installment — came from. */
export const FinanceDataSource = asEnum({
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
  PROVIDER_SYNC: 'PROVIDER_SYNC',
  /** Extracted from a statement by AI. Never trusted without verification. */
  DOCUMENT_EXTRACTION: 'DOCUMENT_EXTRACTION',
  /** Produced by Saarthi's own amortisation from the loan terms. */
  CALCULATED: 'CALCULATED',
  SIMULATED: 'SIMULATED',
});
export type FinanceDataSource = EnumValue<typeof FinanceDataSource>;

/**
 * How far a record has been checked.
 *
 * A provider response is not a verified fact: `PROVIDER_REPORTED` says an
 * external system asserted it, `VERIFIED` says a human confirmed it against a
 * document, and `CONFLICT` says two sources disagree and neither wins silently.
 */
export const FinanceVerificationStatus = asEnum({
  UNVERIFIED: 'UNVERIFIED',
  PROVIDER_REPORTED: 'PROVIDER_REPORTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  VERIFIED: 'VERIFIED',
  CONFLICT: 'CONFLICT',
  REJECTED: 'REJECTED',
});
export type FinanceVerificationStatus = EnumValue<typeof FinanceVerificationStatus>;

export const LoanPaymentMethod = asEnum({
  AUTO_DEBIT: 'AUTO_DEBIT',
  NACH: 'NACH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  CASH: 'CASH',
  CARD: 'CARD',
  OTHER: 'OTHER',
});
export type LoanPaymentMethod = EnumValue<typeof LoanPaymentMethod>;

/** What a recorded payment was applied to. */
export const LoanPaymentKind = asEnum({
  INSTALLMENT: 'INSTALLMENT',
  PART_PREPAYMENT: 'PART_PREPAYMENT',
  FORECLOSURE: 'FORECLOSURE',
  PENALTY: 'PENALTY',
  CHARGES: 'CHARGES',
});
export type LoanPaymentKind = EnumValue<typeof LoanPaymentKind>;

export const LoanEventType = asEnum({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  SCHEDULE_GENERATED: 'SCHEDULE_GENERATED',
  SCHEDULE_REGENERATED: 'SCHEDULE_REGENERATED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_REVERSED: 'PAYMENT_REVERSED',
  INSTALLMENT_WAIVED: 'INSTALLMENT_WAIVED',
  REMINDER_SENT: 'REMINDER_SENT',
  MARKED_OVERDUE: 'MARKED_OVERDUE',
  PROVIDER_SYNCED: 'PROVIDER_SYNCED',
  PROVIDER_SYNC_FAILED: 'PROVIDER_SYNC_FAILED',
  CONFLICT_RAISED: 'CONFLICT_RAISED',
  CONFLICT_RESOLVED: 'CONFLICT_RESOLVED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  CLOSED: 'CLOSED',
});
export type LoanEventType = EnumValue<typeof LoanEventType>;

/** Reminder offsets relative to an installment due date. */
export const LoanReminderKind = asEnum({
  /** Default T-4 days. */
  ADVANCE: 'ADVANCE',
  /** Default T-1 day. */
  IMMINENT: 'IMMINENT',
  /** Default T+1 day — the overdue check. */
  OVERDUE: 'OVERDUE',
});
export type LoanReminderKind = EnumValue<typeof LoanReminderKind>;

// ---------------------------------------------------------------------------
// Service history
// ---------------------------------------------------------------------------

export const ServiceCategory = asEnum({
  ROUTINE: 'ROUTINE',
  ENGINE: 'ENGINE',
  TRANSMISSION: 'TRANSMISSION',
  BRAKES: 'BRAKES',
  SUSPENSION: 'SUSPENSION',
  STEERING: 'STEERING',
  TYRES: 'TYRES',
  ELECTRICAL: 'ELECTRICAL',
  BODY: 'BODY',
  HVAC: 'HVAC',
  FUEL_SYSTEM: 'FUEL_SYSTEM',
  COOLING: 'COOLING',
  EXHAUST: 'EXHAUST',
  CHASSIS: 'CHASSIS',
  ACCIDENT_REPAIR: 'ACCIDENT_REPAIR',
  OTHER: 'OTHER',
});
export type ServiceCategory = EnumValue<typeof ServiceCategory>;

export const ServiceDataSource = asEnum({
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
  PROVIDER_SYNC: 'PROVIDER_SYNC',
  /** Extracted from an invoice by AI. A draft until a human confirms it. */
  DOCUMENT_EXTRACTION: 'DOCUMENT_EXTRACTION',
  TELEMETRY_DERIVED: 'TELEMETRY_DERIVED',
  SIMULATED: 'SIMULATED',
});
export type ServiceDataSource = EnumValue<typeof ServiceDataSource>;

export const ServiceVerificationStatus = asEnum({
  UNVERIFIED: 'UNVERIFIED',
  PROVIDER_REPORTED: 'PROVIDER_REPORTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  VERIFIED: 'VERIFIED',
  CONFLICT: 'CONFLICT',
  REJECTED: 'REJECTED',
});
export type ServiceVerificationStatus = EnumValue<typeof ServiceVerificationStatus>;

// ---------------------------------------------------------------------------
// FASTag & toll
// ---------------------------------------------------------------------------

/**
 * FASTag state, as NETC defines it.
 *
 * `LOW_BALANCE` and `BLACKLISTED` both stop a truck at a plaza, but they are
 * different problems: one is fixed by a recharge in under a minute, the other
 * needs a call to the issuing bank. Collapsing them into "inactive" would lose
 * the only part a driver at a barrier can act on.
 */
export const FastagStatus = asEnum({
  ACTIVE: 'ACTIVE',
  LOW_BALANCE: 'LOW_BALANCE',
  BLACKLISTED: 'BLACKLISTED',
  EXCEPTION: 'EXCEPTION',
  HOTLISTED: 'HOTLISTED',
  CLOSED: 'CLOSED',
  /** Nothing has reported a state yet. Not the same as inactive. */
  UNKNOWN: 'UNKNOWN',
});
export type FastagStatus = EnumValue<typeof FastagStatus>;

export const TollDirection = asEnum({
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
  UNKNOWN: 'UNKNOWN',
});
export type TollDirection = EnumValue<typeof TollDirection>;

export const TollDataSource = asEnum({
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
  PROVIDER_SYNC: 'PROVIDER_SYNC',
  DOCUMENT_EXTRACTION: 'DOCUMENT_EXTRACTION',
  SIMULATED: 'SIMULATED',
});
export type TollDataSource = EnumValue<typeof TollDataSource>;

export const TollPaymentMode = asEnum({
  FASTAG: 'FASTAG',
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  EXEMPT: 'EXEMPT',
  UNKNOWN: 'UNKNOWN',
});
export type TollPaymentMode = EnumValue<typeof TollPaymentMode>;

// ---------------------------------------------------------------------------
// Saarthi Terminal
// ---------------------------------------------------------------------------

/**
 * The lifecycle of one driver on one terminal, as persisted.
 *
 * A single explicit state rather than a scatter of booleans, because the rules
 * that matter are statements about which state the session is in: a driver is
 * not active until somebody approved them, and a trip cannot start before the
 * safety check. A pair of booleans can represent "rejected and approved" at
 * once; this cannot.
 */
export const TerminalSessionStatus = asEnum({
  /** The driver scanned the vehicle QR from their own Saarthi account. */
  DRIVER_IDENTIFIED: 'DRIVER_IDENTIFIED',
  SELFIE_SUBMITTED: 'SELFIE_SUBMITTED',
  /** Waiting on the fleet owner or mobility provider. */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** Authorised by a named person. The safety check is still outstanding. */
  APPROVED: 'APPROVED',
  /** Checklist complete. The driver may start driving. */
  READY: 'READY',
  TRIP_ACTIVE: 'TRIP_ACTIVE',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  /** Withdrawn by the driver before a decision. */
  CANCELLED: 'CANCELLED',
  /**
   * Never answered inside the SLA window and closed by the sweep.
   *
   * Expiry closes the request; it never activates the driver. Fifteen minutes
   * is an escalation, not an approval.
   */
  EXPIRED: 'EXPIRED',
});
export type TerminalSessionStatus = EnumValue<typeof TerminalSessionStatus>;
export const TERMINAL_SESSION_STATUSES = Object.values(
  TerminalSessionStatus,
) as TerminalSessionStatus[];

/** Session states that are still live — at most one per terminal at a time. */
export const ACTIVE_TERMINAL_SESSION_STATUSES: TerminalSessionStatus[] = [
  TerminalSessionStatus.DRIVER_IDENTIFIED,
  TerminalSessionStatus.SELFIE_SUBMITTED,
  TerminalSessionStatus.PENDING_APPROVAL,
  TerminalSessionStatus.APPROVED,
  TerminalSessionStatus.READY,
  TerminalSessionStatus.TRIP_ACTIVE,
];

/** States in which the driver is authorised to use the vehicle. */
export const AUTHORIZED_TERMINAL_SESSION_STATUSES: TerminalSessionStatus[] = [
  TerminalSessionStatus.APPROVED,
  TerminalSessionStatus.READY,
  TerminalSessionStatus.TRIP_ACTIVE,
];

export const TerminalSessionEventType = asEnum({
  REQUESTED: 'REQUESTED',
  SELFIE_SUBMITTED: 'SELFIE_SUBMITTED',
  SUBMITTED_FOR_APPROVAL: 'SUBMITTED_FOR_APPROVAL',
  REMINDER_SENT: 'REMINDER_SENT',
  ESCALATED: 'ESCALATED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CHECKLIST_SUBMITTED: 'CHECKLIST_SUBMITTED',
  TRIP_STARTED: 'TRIP_STARTED',
  TRIP_COMPLETED: 'TRIP_COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  NOTE: 'NOTE',
});
export type TerminalSessionEventType = EnumValue<typeof TerminalSessionEventType>;

/**
 * Where a checklist item's verdict comes from.
 *
 * The distinction is the whole point of the intelligent checklist. A driver
 * looking at a tyre and a sensor reporting a coolant temperature are different
 * kinds of evidence, and presenting one as the other is how a vehicle gets
 * signed off on a reading nobody took.
 */
export const TerminalChecklistItemKind = asEnum({
  /** The driver has to look at it. Nothing on the vehicle can answer. */
  MANUAL: 'MANUAL',
  /** Answered from live telemetry, when the metric is genuinely reported. */
  TELEMETRY: 'TELEMETRY',
  MAINTENANCE: 'MAINTENANCE',
  DOCUMENT: 'DOCUMENT',
});
export type TerminalChecklistItemKind = EnumValue<typeof TerminalChecklistItemKind>;

export const TerminalChecklistItemStatus = asEnum({
  OK: 'OK',
  ATTENTION: 'ATTENTION',
  CRITICAL: 'CRITICAL',
  /** No data and no inspection — recorded as unknown, never as a pass. */
  UNAVAILABLE: 'UNAVAILABLE',
  SKIPPED: 'SKIPPED',
});
export type TerminalChecklistItemStatus = EnumValue<typeof TerminalChecklistItemStatus>;

export const TerminalChecklistOutcome = asEnum({
  PASSED: 'PASSED',
  PASSED_WITH_WARNINGS: 'PASSED_WITH_WARNINGS',
  FAILED: 'FAILED',
});
export type TerminalChecklistOutcome = EnumValue<typeof TerminalChecklistOutcome>;

export const TerminalIssueCategory = asEnum({
  ENGINE: 'ENGINE',
  TYRE: 'TYRE',
  BRAKE: 'BRAKE',
  ELECTRICAL: 'ELECTRICAL',
  ACCIDENT: 'ACCIDENT',
  BODY: 'BODY',
  OTHER: 'OTHER',
});
export type TerminalIssueCategory = EnumValue<typeof TerminalIssueCategory>;
export const TERMINAL_ISSUE_CATEGORIES = Object.values(
  TerminalIssueCategory,
) as TerminalIssueCategory[];

export const TerminalIssueStatus = asEnum({
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
});
export type TerminalIssueStatus = EnumValue<typeof TerminalIssueStatus>;
