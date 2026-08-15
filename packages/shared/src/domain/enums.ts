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
