import type {
  AlertSeverity,
  AssociationAlertStatus,
  BookingStatus,
  CancelledBy,
  DeviceProvider,
  DeviceStatus,
  PricingModel,
  ProviderStatus,
  ServiceType,
  SosType,
  TelemetryAlertStatus,
  TelemetryAlertType,
  TelemetryMetric,
  TravelPackageStatus,
  TravelServiceKind,
  VehicleCapability,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';

/**
 * Client-side mirrors of the mobility API responses.
 *
 * Kept in a separate module from `api-types.ts` so the two feature streams do
 * not collide in one file. Every shape here matches a service return type in
 * `apps/api/src/modules/{vehicles,associations,travel,devices,telemetry}`.
 */

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface VehicleDeviceSummary {
  deviceId: string;
  deviceIdentifier: string;
  serialNumber: string;
  provider: string;
  status: string;
  lastSeenAt: string | null;
  assignedAt: string;
}

export interface VehicleSummary {
  id: string;
  organizationId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  truckType: string;
  typeLabel: string;
  capabilities: VehicleCapability[];
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  /** `null` when the vehicle type carries no freight — never a fake zero. */
  capacityTons: number | null;
  /** `null` when the vehicle type carries no passengers. */
  passengerCapacity: number | null;
  airConditioned: boolean | null;
  fuelType: string;
  fuelEfficiency: number | null;
  status: string;
  verificationStatus: string;
  odometerKm: number;
  shareLocation: boolean;
  currentDriver: { id: string; name: string; overallScore: number | null } | null;
  currentTripId: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  device: VehicleDeviceSummary | null;
  openTelemetryAlerts: number;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface VehicleTypeOption {
  type: VehicleType;
  label: string;
  capabilities: VehicleCapability[];
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

export interface AssociationCoverageArea {
  id: string;
  district: string;
  state: string;
  label: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface AssociationSummary {
  id: string;
  organizationId: string;
  name: string;
  district: string;
  state: string;
  addressLine: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  officialEmail: string;
  officialPhone: string;
  emergencyPhone: string;
  representativeName: string;
  representativeDesignation: string | null;
  representativePhone: string;
  representativeEmail: string | null;
  memberTruckCount: number | null;
  about: string | null;
  logoUrl: string | null;
  verificationStatus: VerificationStatus;
  acceptingAlerts: boolean;
  coverageAreas: AssociationCoverageArea[];
  stats: {
    alertsReceived: number;
    alertsAcknowledged: number;
    alertsResolved: number;
    avgResponseMinutes: number | null;
  };
  verifiedAt: string | null;
  createdAt: string;
}

export interface AssociationAlertSummary {
  id: string;
  reference: string;
  associationId: string;
  incidentId: string;
  severity: AlertSeverity;
  status: AssociationAlertStatus;
  incidentType: SosType;
  vehicleRegistration: string | null;
  vehicleType: VehicleType | null;
  fleetName: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  district: string | null;
  state: string | null;
  description: string | null;
  /** Withheld by the API until the alert is acknowledged. */
  driverName: string | null;
  driverPhone: string | null;
  contactPhone: string | null;
  distanceKm: number | null;
  acknowledgedAt: string | null;
  respondingAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  resolvedAt: string | null;
  outcome: string | null;
  assistanceProvided: boolean | null;
  ageMinutes: number;
  overdue: boolean;
  responderCount: number;
  notifiedAt: string;
  updatedAt: string;
}

export interface AssociationResponderSummary {
  id: string;
  kind: 'MEMBER' | 'EXTERNAL';
  status: 'ASSIGNED' | 'EN_ROUTE' | 'ON_SCENE' | 'COMPLETED' | 'CANCELLED';
  userId: string | null;
  name: string | null;
  phone: string | null;
  organisation: string | null;
  etaMinutes: number | null;
  note: string | null;
  assignedAt: string;
  completedAt: string | null;
}

export interface AssociationAlertDetail extends AssociationAlertSummary {
  responders: AssociationResponderSummary[];
  events: { id: string; eventType: string; description: string | null; createdAt: string }[];
}

export interface AssociationOverview {
  open: number;
  critical: number;
  unacknowledged: number;
  overdue: number;
  responding: number;
  resolvedToday: number;
  byType: { type: SosType; count: number }[];
  activeVehiclesInArea: number;
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  serviceTypes: ServiceType[];
  about: string | null;
  contactPhone: string;
  contactEmail: string | null;
  whatsappPhone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  businessRegistrationNumber: string | null;
  yearsInBusiness: number | null;
  languages: string[];
  status: ProviderStatus;
  verificationStatus: VerificationStatus;
  ratingAverage: number;
  ratingCount: number;
  bookingsCompleted: number;
  serviceAreas: {
    id: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    radiusKm: number;
  }[];
  publishedPackages: number;
  createdAt: string;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  description: string | null;
  highlights: string[];
  overnightAt: string | null;
  approxDistanceKm: number | null;
}

export interface PackageSummary {
  id: string;
  providerId: string;
  organizationId: string;
  provider: {
    id: string;
    displayName: string;
    ratingAverage: number;
    ratingCount: number;
    verificationStatus: VerificationStatus;
    logoUrl: string | null;
  } | null;
  title: string;
  summary: string;
  description: string | null;
  serviceKind: TravelServiceKind;
  imageUrls: string[];
  destinations: string[];
  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  durationDays: number;
  durationNights: number | null;
  approxDistanceKm: number | null;
  vehicleType: VehicleType;
  vehicle: { id: string; registrationNumber: string; model: string | null } | null;
  minPassengers: number;
  maxPassengers: number;
  pricingModel: PricingModel;
  basePrice: number;
  /** Indicative total for the smallest party — the "from ₹X" figure. */
  fromPrice: number;
  inclusions: string[];
  exclusions: string[];
  itinerary: ItineraryDay[];
  cancellationPolicy: { hoursBefore: number; refundPercent: number }[] | null;
  advanceBookingDays: number;
  availableFrom: string | null;
  availableTo: string | null;
  availableWeekdays: number[];
  driverIncluded: boolean;
  fuelIncluded: boolean;
  status: TravelPackageStatus;
  ratingAverage: number;
  ratingCount: number;
  bookingCount: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface PriceQuote {
  subtotal: number;
  platformFee: number;
  total: number;
  breakdown: string;
}

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  packageId: string;
  packageTitle: string;
  packageSummary: string;
  packageImageUrl: string | null;
  serviceKind: string;
  destinations: string[];
  providerOrganizationId: string;
  providerName: string | null;
  /** Shared only once the booking is confirmed. */
  providerPhone: string | null;
  customerOrganizationId: string;
  customerName: string | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  passengers: number;
  pickupAddress: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  specialRequests: string | null;
  pricingModel: PricingModel;
  subtotal: number;
  platformFee: number;
  totalAmount: number;
  currency: string;
  priceBreakdown: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: VehicleType;
    model: string | null;
  } | null;
  driver: {
    id: string;
    name: string;
    phone: string | null;
    overallScore: number | null;
  } | null;
  tripId: string | null;
  paymentStatus: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: CancelledBy | null;
  cancellationReason: string | null;
  refundAmount: number | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingDetail extends BookingSummary {
  events: { id: string; eventType: string; description: string | null; createdAt: string }[];
}

/** Simplified, authorised tracking for a travel customer. Never raw telemetry. */
export interface BookingTracking {
  available: boolean;
  reason: string | null;
  vehicleRegistration: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string | null;
  tripStatus: string | null;
  progressPercent: number | null;
  etaAt: string | null;
  driverName: string | null;
}

// ---------------------------------------------------------------------------
// Devices & telemetry
// ---------------------------------------------------------------------------

export interface DeviceSummary {
  id: string;
  organizationId: string;
  deviceIdentifier: string;
  provider: DeviceProvider;
  deviceType: string;
  serialNumber: string;
  imeiMasked: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  simMasked: string | null;
  simOperator: string | null;
  status: DeviceStatus;
  supportedMetrics: TelemetryMetric[];
  /** What Saarthi has actually seen — the honest capability list. */
  observedMetrics: TelemetryMetric[];
  assignedVehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: VehicleType;
    assignedAt: string;
  } | null;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
  silentForSeconds: number | null;
  readingCount: number;
  rejectedCount: number;
  openAlerts: number;
  notes: string | null;
  installedAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface RegisteredDevice {
  device: DeviceSummary;
  /** Shown once, at registration. Not recoverable afterwards. */
  secret: string;
}

export interface DeviceOverview {
  total: number;
  active: number;
  offline: number;
  unassigned: number;
  suspended: number;
  readingsToday: number;
  openAlerts: number;
}

export interface DeviceAssignmentHistory {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  vehicleType: string;
  status: string;
  assignedAt: string;
  installedAt: string | null;
  unassignedAt: string | null;
  note: string | null;
  removalReason: string | null;
}

/**
 * A vehicle's side of the device history. Distinct from
 * `DeviceAssignmentHistory`: that lists the vehicles one device has been fitted
 * to, this lists the devices one vehicle has carried.
 */
export interface VehicleDeviceHistory {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  provider: string;
  model: string | null;
  deviceStatus: string;
  status: string;
  assignedAt: string;
  unassignedAt: string | null;
  lastTelemetryAt: string | null;
}

export interface DeviceEventEntry {
  id: string;
  eventType: string;
  description: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface MockRunSummary {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  vehicleRegistration: string | null;
  status: string;
  scenario: string;
  intervalSeconds: number;
  readingsSent: number;
  maxReadings: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface TelemetryReadingSummary {
  id: string;
  deviceId: string;
  vehicleId: string;
  recordedAt: string;
  receivedAt: string;
  /**
   * Which of the fields below are genuinely present. A field whose metric is
   * absent must be rendered as "not reported", never as its zero value.
   */
  metrics: TelemetryMetric[];
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  heading: number | null;
  altitude: number | null;
  satellites: number | null;
  rpm: number | null;
  engineLoad: number | null;
  coolantTemperature: number | null;
  intakeTemperature: number | null;
  fuelLevel: number | null;
  fuelRate: number | null;
  throttlePosition: number | null;
  batteryVoltage: number | null;
  odometerKm: number | null;
  accelerationX: number | null;
  accelerationY: number | null;
  accelerationZ: number | null;
  harshBraking: boolean;
  harshAcceleration: boolean;
  suddenMovement: boolean;
  deviceTemperature: number | null;
  signalStrength: number | null;
  diagnostics: { code: string; description: string | null; confirmed: boolean }[];
  simulated: boolean;
}

export interface VehicleTelemetryCapabilities {
  hasDevice: boolean;
  deviceStatus: string | null;
  observedMetrics: TelemetryMetric[];
  supportedMetrics: TelemetryMetric[];
  lastReadingAt: string | null;
  readingCount: number;
}

export interface TelemetryAlertSummary {
  id: string;
  organizationId: string;
  vehicleId: string;
  vehicleRegistration: string;
  deviceId: string | null;
  driverId: string | null;
  driverName: string | null;
  type: TelemetryAlertType;
  severity: AlertSeverity;
  status: TelemetryAlertStatus;
  message: string;
  observedValue: number | null;
  threshold: number | null;
  unit: string | null;
  latitude: number | null;
  longitude: number | null;
  scoreEventId: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  note: string | null;
  occurredAt: string;
}

export interface TelemetryRule {
  type: TelemetryAlertType;
  label: string;
  description: string;
  enabled: boolean;
  severity: AlertSeverity;
  threshold: number | null;
  thresholdUnit: string | null;
  cooldownSeconds: number;
  requiresMetric: TelemetryMetric | null;
  customised: boolean;
  vehicleId: string | null;
}

export interface MaintenanceRecommendation {
  code: string;
  vehicleId: string;
  vehicleRegistration: string;
  label: string;
  reason: string;
  recommendation: string;
  occurrences: number;
  windowDays: number;
  severity: AlertSeverity;
}
