import type {
  DocumentOwnerType,
  EmiFrequency,
  FinanceDataSource,
  FinanceVerificationStatus,
  InstallmentStatus,
  InterestType,
  LoanStatus,
  FastagStatus,
  ServiceCategory,
  ServiceDataSource,
  ServiceVerificationStatus,
  TollDataSource,
  TollDirection,
  TollPaymentMode,
  DocumentValidity,
  DocumentVerificationStatus,
  HireBasis,
  MaterialUnit,
  OrderStatus,
  PaginationMeta,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  TruckType,
  VehicleType,
  SosStatus,
  SosType,
  TripStatus,
  VerificationStatus,
} from '@saarthi/shared';

/**
 * Response shapes returned by the VorldX Saarthi API.
 *
 * These mirror the service-layer return types on the server. Keeping them in
 * one file means a backend change surfaces as a compile error in every screen
 * that consumed the old shape.
 */

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface TruckSummary {
  id: string;
  registrationNumber: string;
  truckType: string;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  capacityTons: number;
  fuelType: string;
  status: string;
  verificationStatus: VerificationStatus;
  odometerKm: number;
  currentDriver: { id: string; name: string; overallScore: number | null } | null;
  currentTripId: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  createdAt: string;
  archivedAt: string | null;
}

export interface DriverSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  licenseNumber: string;
  licenseExpiryDate: string | null;
  licenseClass: string | null;
  experienceYears: number;
  verificationStatus: VerificationStatus;
  availability: string;
  currentTruck: { id: string; registrationNumber: string } | null;
  overallScore: number | null;
  totalTrips: number;
  totalDistanceKm: number;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  createdAt: string;
  archivedAt: string | null;
}

export interface DriverScoreDetail {
  driverId: string;
  overall: number;
  categories: {
    SAFETY: number;
    RELIABILITY: number;
    TIMELINESS: number;
    COMPLIANCE: number;
    VEHICLE_CARE: number;
  };
  band: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  calculatedAt: string;
  history: { date: string; overall: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    category: string;
    points: number;
    reason: string;
    createdAt: string;
  }[];
}

export interface DocumentSummary {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel: string | null;
  organizationId: string | null;
  documentType: string;
  documentTypeLabel: string;
  documentNumber: string | null;
  title: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  validity: DocumentValidity;
  daysRemaining: number | null;
  verificationStatus: DocumentVerificationStatus;
  rejectionReason: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  currentVersion: number;
  uploadedById: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceSummary {
  total: number;
  valid: number;
  expiringSoon: number;
  expired: number;
  pendingVerification: number;
  rejected: number;
  missingMandatory: {
    ownerType: DocumentOwnerType;
    ownerId: string;
    ownerLabel: string;
    documentType: string;
    label: string;
  }[];
}

export interface OrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  customerOrganizationId: string;
  customerName: string;
  supplierOrganizationId: string | null;
  supplierName: string | null;
  fleetOrganizationId: string | null;
  fleetName: string | null;
  materialId: string | null;
  materialName: string;
  quantity: number;
  unit: string;
  materialPrice: number | null;
  transportPrice: number | null;
  totalPrice: number | null;
  budget: number | null;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  distanceKm: number | null;
  requiredCapacityTons: number;
  requiredTruckType: string | null;
  pickupAt: string | null;
  deliverBy: string | null;
  assignedTruck: { id: string; registrationNumber: string } | null;
  assignedDriver: { id: string; name: string; overallScore: number | null } | null;
  tripId: string | null;
  quoteCount: number;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteSummary {
  id: string;
  orderId: string;
  fleetOrganizationId: string;
  fleetName: string;
  price: number;
  estimatedPickupAt: string | null;
  estimatedArrivalAt: string | null;
  distanceToPickupKm: number | null;
  message: string | null;
  status: string;
  expiresAt: string | null;
  truck: {
    id: string;
    registrationNumber: string;
    truckType: string;
    capacityTons: number;
    verificationStatus: VerificationStatus;
  } | null;
  driver: { id: string; name: string; overallScore: number | null } | null;
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  events: {
    id: string;
    type: string;
    description: string;
    metadata: unknown;
    createdAt: string;
  }[];
  quotes: QuoteSummary[];
  rating: {
    rating: number;
    punctuality: number | null;
    communication: number | null;
    cargoCondition: number | null;
    comment: string | null;
    createdAt: string;
  } | null;
}

export interface TripSummary {
  id: string;
  reference: string;
  organizationId: string;
  status: TripStatus;
  truck: { id: string; registrationNumber: string; truckType: string; capacityTons: number } | null;
  driver: { id: string; name: string; phone: string | null; overallScore: number | null } | null;
  order: { id: string; reference: string; materialName: string; customerName: string } | null;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  plannedDistanceKm: number | null;
  actualDistanceKm: number;
  plannedDurationMin: number | null;
  actualDurationMin: number | null;
  plannedStartAt: string | null;
  actualStartAt: string | null;
  plannedArrivalAt: string | null;
  actualArrivalAt: string | null;
  etaAt: string | null;
  delayMinutes: number;
  progressPercent: number;
  price: number | null;
  expenses: number | null;
  /**
   * A journey the vehicle made on its own account.
   *
   * True for a run to a petrol pump, a workshop or a weighbridge that the
   * terminal opened because the driver navigated there with no dispatched trip
   * against the vehicle. Surfaced rather than hidden: a fleet reporting on
   * delivered work needs to leave these out, and an owner looking at an
   * unexplained forty kilometres needs to find them.
   */
  adHoc: boolean;
  /** Driving summary, written when the trip closed. Null while it is open. */
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  harshBrakingCount: number;
  harshAccelerationCount: number;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  currentLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripDetail extends TripSummary {
  plannedRoute: { latitude: number; longitude: number }[];
  allowedTransitions: TripStatus[];
  stops: {
    id: string;
    type: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    sequence: number;
    plannedArrival: string | null;
    actualArrival: string | null;
    actualDeparture: string | null;
    status: string;
  }[];
  events: {
    id: string;
    type: string;
    description: string | null;
    latitude: number | null;
    longitude: number | null;
    metadata: unknown;
    createdAt: string;
  }[];
}

export interface LiveTruckPosition {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  status: string;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  driver: { id: string; name: string } | null;
  trip: { id: string; reference: string; status: string; progressPercent: number } | null;
  stale: boolean;
  /** Whether this vehicle's position came from a simulator rather than a device. */
  simulated: boolean;
}

export interface DashboardMetrics {
  fleet: {
    totalTrucks: number;
    available: number;
    onTrip: number;
    idle: number;
    maintenance: number;
    emergency: number;
    utilizationPercent: number;
  };
  drivers: {
    total: number;
    available: number;
    onTrip: number;
    verified: number;
    averageScore: number | null;
  };
  trips: {
    active: number;
    completedThisMonth: number;
    delayed: number;
    onTimePercent: number | null;
    totalDistanceThisMonthKm: number;
  };
  orders: {
    open: number;
    inTransit: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
  };
  financial: {
    revenueThisMonth: number;
    revenuePreviousMonth: number;
    fuelCostThisMonth: number;
    maintenanceCostThisMonth: number;
    grossMarginThisMonth: number;
  };
  compliance: {
    documentsExpiringSoon: number;
    documentsExpired: number;
    pendingVerification: number;
    maintenanceOverdue: number;
  };
  safety: {
    activeSosIncidents: number;
    sosThisMonth: number;
    safetyEventsThisMonth: number;
  };
}

export interface MaterialSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierVerified: boolean;
  supplierRating: number | null;
  organizationId: string;
  name: string;
  category: string | null;
  description: string | null;
  unit: string;
  pricePerUnit: number;
  availableQuantity: number;
  minimumOrderQty: number;
  status: string;
  pickupAddress: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  distanceKm: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransportMatch {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  verificationStatus: VerificationStatus;
  organizationId: string;
  fleetName: string;
  driver: { id: string; name: string; overallScore: number | null } | null;
  distanceToPickupKm: number;
  estimatedPickupMinutes: number;
  estimatedTripMinutes: number;
  estimatedPrice: number;
  matchScore: number;
  reasons: string[];
}

export interface SosIncidentSummary {
  id: string;
  reference: string;
  organizationId: string;
  organizationName: string | null;
  type: SosType;
  status: SosStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  contactPhone: string | null;
  searchRadiusMeters: number;
  driver: { id: string; name: string; phone: string | null } | null;
  truck: { id: string; registrationNumber: string } | null;
  tripId: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  assignedAt: string | null;
  arrivedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  responderCount: number;
  acknowledgedCount: number;
  updatedAt: string;
}

export interface SosIncidentDetail extends SosIncidentSummary {
  responders: {
    id: string;
    truckId: string;
    registrationNumber: string;
    driverId: string;
    driverName: string;
    driverPhone: string | null;
    organizationId: string;
    sameFleet: boolean;
    distanceKm: number;
    status: string;
    notifiedAt: string;
    acknowledgedAt: string | null;
    arrivedAt: string | null;
    note: string | null;
  }[];
  events: {
    id: string;
    eventType: string;
    description: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
}

export interface NearbyPlaceResult {
  id: string;
  category: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  rating: number | null;
  open24Hours: boolean;
  /** Opening hours exactly as the directory publishes them. */
  openingHours: string | null;
  attributes: unknown;
  distanceKm: number;
  direction: string;
  /** `osm` for OpenStreetMap, `local` for Saarthi's own corridor dataset. */
  source: string;
  /** True when the live directory could not be reached and the mirror answered. */
  stale: boolean;
}

export interface NearbyTruckResult {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  status: string;
  sameFleet: boolean;
  fleetName: string | null;
  driverName: string | null;
  driverScore: number | null;
  contactPhone: string | null;
  distanceKm: number;
  direction: string;
  latitude: number;
  longitude: number;
  lastSeenAt: string;
}

export interface SimulationSummary {
  id: string;
  truckId: string;
  registrationNumber: string;
  tripId: string | null;
  tripReference: string | null;
  status: string;
  progressPercent: number;
  progressMeters: number;
  routeDistanceKm: number;
  baseSpeedKph: number;
  speedMultiplier: number;
  deviationActive: boolean;
  behaviours: Record<string, unknown>;
  startedAt: string | null;
  lastTickAt: string | null;
  completedAt: string | null;
}

export interface MaintenanceSummary {
  id: string;
  truckId: string;
  registrationNumber: string;
  type: string;
  title: string;
  description: string | null;
  odometerKm: number | null;
  cost: number | null;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  serviceProvider: string | null;
  nextDueAt: string | null;
  nextDueOdometerKm: number | null;
  overdue: boolean;
  createdAt: string;
}

export interface MaintenanceRisk {
  truckId: string;
  registrationNumber: string;
  riskScore: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  odometerKm: number;
  kmSinceLastService: number | null;
  daysSinceLastService: number | null;
  overdueCount: number;
  reasons: string[];
  basis: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  data: unknown;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface VerificationCaseSummary {
  id: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  organizationId: string | null;
  organizationName: string | null;
  status: VerificationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewerNotes: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TruckPassport {
  truck: {
    id: string;
    registrationNumber: string;
    truckType: string;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    capacityTons: number;
    fuelType: string;
    odometerKm: number;
    status: string;
    verificationStatus: VerificationStatus;
    createdAt: string;
  };
  lifetime: {
    completedTrips: number;
    totalOrders: number;
    totalDistanceKm: number;
    revenue: number;
    fuelCost: number;
    maintenanceCost: number;
    profit: number;
    servicesCompleted: number;
    incidents: number;
    fuelEfficiencyL100Km: number | null;
    costPerKm: number | null;
  };
  documents: {
    id: string;
    documentType: string;
    title: string | null;
    documentNumber: string | null;
    expiryDate: string | null;
    verificationStatus: DocumentVerificationStatus;
    validity: DocumentValidity;
    daysRemaining: number | null;
  }[];
  driverHistory: {
    driverId: string;
    name: string;
    status: string;
    assignedAt: string;
    unassignedAt: string | null;
  }[];
  recentTrips: {
    id: string;
    reference: string;
    status: string;
    originAddress: string;
    destinationAddress: string;
    actualDistanceKm: number;
    actualArrivalAt: string | null;
    delayMinutes: number;
    price: number | null;
  }[];
  maintenance: MaintenanceSummary[] | Record<string, unknown>[];
  fuel: {
    id: string;
    quantityLitres: number;
    totalCost: number;
    odometerKm: number | null;
    stationName: string | null;
    recordedAt: string;
  }[];
  events: { id: string; type: string; description: string | null; createdAt: string }[];
}

// --- Analytics -------------------------------------------------------------
// Mirrors the shapes returned by the analytics module. Every figure is
// aggregated from database rows by the API; nothing here is computed for display.

export interface TimeSeriesPoint {
  date: string;
  trips: number;
  distanceKm: number;
  revenue: number;
  fuelCost: number;
}

export interface TruckPerformance {
  truckId: string;
  registrationNumber: string;
  trips: number;
  distanceKm: number;
  revenue: number;
  fuelCost: number;
  maintenanceCost: number;
  profit: number;
  utilizationPercent: number;
  fuelEfficiencyL100Km: number | null;
}

export interface DriverPerformance {
  driverId: string;
  name: string;
  trips: number;
  distanceKm: number;
  onTimePercent: number | null;
  overallScore: number | null;
  safetyEvents: number;
  averageRating: number | null;
}

export interface RoutePerformance {
  route: string;
  trips: number;
  averageDistanceKm: number;
  averageDurationMin: number | null;
  averageRevenue: number;
  onTimePercent: number | null;
}

// ---------------------------------------------------------------------------
// Vehicle finance — loans and EMI
// ---------------------------------------------------------------------------

export interface LoanInstallmentView {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  totalDue: number;
  openingBalance: number | null;
  closingBalance: number | null;
  status: InstallmentStatus;
  amountPaid: number;
  penaltyPaid: number;
  outstanding: number;
  paidAt: string | null;
  paymentReference: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  conflictNote: string | null;
}

export interface LoanPaymentView {
  id: string;
  installmentId: string | null;
  installmentNumber: number | null;
  amount: number;
  penalty: number;
  kind: string;
  method: string;
  paidAt: string;
  reference: string | null;
  notes: string | null;
  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  reversedAt: string | null;
  reverseReason: string | null;
}

export interface LoanSummary {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  /**
   * Masked unless the caller holds `LOANS_SENSITIVE`. `loanNumberMasked` says
   * which of the two you are looking at, so the UI can label a partial value
   * honestly instead of presenting it as the real reference.
   */
  loanNumber: string | null;
  loanNumberMasked: boolean;
  lenderName: string;
  lenderBranch: string | null;
  borrowerName: string | null;
  loanType: string;
  status: LoanStatus;

  principal: number;
  disbursedAmount: number | null;
  annualRatePercent: number;
  interestType: InterestType;
  tenureMonths: number;
  frequency: EmiFrequency;
  startDate: string;
  endDate: string | null;
  firstDueDate: string;
  emiAmount: number;
  emiFromLender: boolean;

  autoDebitDay: number | null;
  mandateReference: string | null;
  mandateReferenceMasked: boolean;

  outstandingPrincipal: number;
  outstandingInterest: number;
  totalOutstanding: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  unknownInstallments: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
  completionPercent: number;
  hasUnknownState: boolean;

  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  providerName: string | null;
  lastSyncedAt: string | null;
  remindersEnabled: boolean;
  reminderOffsets: number[];
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanDetail extends LoanSummary {
  installments: LoanInstallmentView[];
  payments: LoanPaymentView[];
  scheduleTotals: { installments: number; principal: number; interest: number; total: number };
}

export interface LoanListTotals {
  loans: number;
  activeLoans: number;
  totalOutstanding: number;
  monthlyObligation: number;
  overdueAmount: number;
  overdueLoans: number;
}

export interface FleetLoanSummary {
  activeLoans: number;
  financedVehicles: number;
  totalOutstanding: number;
  monthlyObligation: number;
  dueThisMonth: number;
  overdueInstallments: number;
  overdueAmount: number;
  unknownInstallments: number;
  nextDueDate: string | null;
  attention: {
    loanId: string;
    vehicleId: string;
    registrationNumber: string;
    lenderName: string;
    dueDate: string;
    amount: number;
    status: InstallmentStatus;
  }[];
  basis: 'calculated';
}

export interface UpcomingEmi {
  installmentId: string;
  loanId: string;
  vehicleId: string;
  registrationNumber: string;
  lenderName: string;
  number: number;
  dueDate: string;
  totalDue: number;
  amountPaid: number;
  outstanding: number;
  status: InstallmentStatus;
  daysUntilDue: number;
}

export interface UpcomingEmiResult {
  items: UpcomingEmi[];
  totalDue: number;
  overdueAmount: number;
}

export interface SchedulePreview {
  emiAmount: number;
  installments: {
    number: number;
    dueDate: string;
    principal: number;
    interest: number;
    totalDue: number;
    closingBalance: number;
  }[];
  totals: { installments: number; principal: number; interest: number; total: number };
  basis: 'calculated';
}

export interface LoanSyncResult {
  provider: string;
  retrievedAt: string;
  simulated: boolean;
  applied: boolean;
  differences: { field: string; saarthi: string | number | null; provider: string | number | null }[];
  installmentsReported: number;
  undisclosedInstallments: number;
}

export interface LoanEventView {
  id: string;
  eventType: string;
  description: string | null;
  metadata: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Service history
// ---------------------------------------------------------------------------

export interface ServicePartView {
  name: string;
  partNumber: string | null;
  component: string | null;
  quantity: number;
  unitCost: number | null;
  warrantyMonths: number | null;
}

export interface ServiceRecordView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  type: string;
  category: ServiceCategory | null;
  title: string;
  description: string | null;
  status: string;

  serviceDate: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  odometerKm: number | null;
  engineHours: number | null;

  workshopName: string | null;
  workshopAddress: string | null;
  workshopPhone: string | null;
  mechanicName: string | null;

  labourCost: number | null;
  partsCost: number | null;
  taxAmount: number | null;
  totalCost: number | null;

  invoiceNumber: string | null;
  parts: ServicePartView[];
  replacedComponents: string[];
  diagnosticCodes: string[];
  warrantyUntil: string | null;
  warrantyActive: boolean;

  nextServiceDate: string | null;
  nextServiceOdometerKm: number | null;

  source: ServiceDataSource;
  verificationStatus: ServiceVerificationStatus;
  providerName: string | null;
  retrievedAt: string | null;
  conflictNote: string | null;
  /** True while the record still needs a person to confirm it. */
  needsReview: boolean;

  mediaUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceTimeline {
  vehicleId: string;
  registrationNumber: string;
  records: ServiceRecordView[];
  health: { health: string; reasons: string[]; basis: 'calculated' };
  spend: {
    total: number;
    labour: number;
    parts: number;
    recordCount: number;
    costPerKm: number | null;
    unverifiedRecords: number;
  };
  costTrend: {
    recentCost: number;
    previousCost: number;
    changePercent: number | null;
    direction: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
    windowDays: number;
  };
  repeated: {
    component: string;
    label: string;
    occurrences: number;
    firstAt: string;
    lastAt: string;
    kmBetween: number | null;
    daysBetween: number;
    totalCost: number;
  }[];
  lastServiceAt: string | null;
  nextDueAt: string | null;
  nextDueOdometerKm: number | null;
  /** What this history does not cover, stated rather than implied. */
  coverageNote: string;
  basis: 'calculated';
}

export interface ServiceSyncResult {
  provider: string;
  retrievedAt: string;
  simulated: boolean;
  coverageNote: string;
  applied: boolean;
  imported: number;
  duplicates: number;
  conflicts: { recordId: string; externalId: string; fields: string[] }[];
}

// ---------------------------------------------------------------------------
// AI — daily brief, tools and provenance
// ---------------------------------------------------------------------------

export interface BriefItem {
  kind:
    | 'SERVICE_OVERDUE'
    | 'SERVICE_DUE'
    | 'EMI_OVERDUE'
    | 'EMI_DUE'
    | 'DOCUMENT_EXPIRED'
    | 'DOCUMENT_EXPIRING'
    | 'DEVICE_OFFLINE'
    | 'INCIDENT_OPEN'
    | 'TELEMETRY_ALERT'
    | 'CAPACITY';
  severity: 'CRITICAL' | 'HIGH' | 'NORMAL';
  count: number;
  headline: string;
  detail: string;
  actionUrl: string;
}

export interface DailyBrief {
  organizationId: string;
  generatedAt: string;
  activeVehicles: number;
  activeTrips: number;
  items: BriefItem[];
  priorities: { label: string; reason: string; actionUrl: string }[];
  allClear: boolean;
  basis: 'calculated';
}

/** One tool invocation, as recorded for provenance. */
export interface RecordedToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  basis: 'SOURCE_DATA' | 'RULE_RESULT' | 'PROVIDER_REPORTED' | null;
  recordCount: number;
  references: { type: string; id: string; label: string }[];
  caveats: string[];
  durationMs: number;
  cached: boolean;
  error: string | null;
}

export interface CopilotAnswer {
  answer: string;
  toolCalls: RecordedToolCall[];
  references: { type: string; id: string; label: string }[];
  caveats: string[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  iterations: number;
  truncated: boolean;
  generatedAt: string;
  /** "Based on 42 trips, 18 fuel transactions…" */
  provenance: string;
}

export interface AiToolListing {
  name: string;
  description: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Cameras and live video
// ---------------------------------------------------------------------------

export interface CameraView {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  channel: number;
  position: string;
  label: string | null;
  status: string;
  enabled: boolean;
  continuousRecording: boolean;
  resolution: string | null;
  frameRate: number | null;
  lastFrameAt: string | null;
  thumbnailUrl: string | null;
  /** The vehicle this camera's recorder is fitted to right now, if any. */
  vehicleId: string | null;
  registrationNumber: string | null;
}

export interface LiveViewResult {
  sessionId: string;
  gatewayUrl: string;
  /** Returned once and never again — the server keeps only a hash. */
  token: string;
  protocol: string;
  expiresAt: string;
  iceServers: { urls: string; username?: string; credential?: string }[];
  posterUrl: string | null;
  simulated: boolean;
  camera: CameraView;
}

export interface CameraAccessLogEntry {
  sessionId: string;
  watchedBy: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// FASTag & toll
// ---------------------------------------------------------------------------

export interface FastagHealthResult {
  health: 'OK' | 'LOW_BALANCE' | 'BLOCKED' | 'EXPIRING' | 'UNKNOWN';
  reasons: string[];
  /** Days since the balance was reported. `null` when never reported. */
  balanceAgeDays: number | null;
  basis: 'calculated';
}

export interface FastagView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  /** Masked unless the caller holds `FASTAG_SENSITIVE`. */
  tagId: string | null;
  tagIdMasked: boolean;
  issuerBank: string;
  issuerCode: string | null;
  vehicleClass: string | null;
  status: FastagStatus;

  /** `null` means nobody has reported one. Never render as zero. */
  balance: number | null;
  balanceUpdatedAt: string | null;
  lowBalanceThreshold: number;
  health: FastagHealthResult;

  linkedAccountRef: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;

  source: TollDataSource;
  providerName: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the configured provider can do — the UI hides what it cannot. */
export interface FastagCapabilities {
  provider: string;
  supportsLookup: boolean;
  supportsBalance: boolean;
  supportsRecharge: boolean;
  supportsTransactions: boolean;
  unavailableReason: string;
  defaultLowBalanceThreshold: number;
}

/** The result of looking a vehicle up on NETC by its registration number. */
export interface FastagDiscoveryResult {
  provider: string;
  registrationNumber: string;
  /** NETC holds a tag against this vehicle. `false` is an answer, not a failure. */
  found: boolean;
  /** Why nothing was recorded, when nothing was. */
  reason: string | null;
  applied: boolean;
  alreadyKnown: boolean;
  replacedPreviousTag: boolean;
  /** The provider named the issuing bank rather than serving only a code. */
  issuerNamed: boolean;
  balanceServed: boolean;
  crossingsImported: number;
  coverageNote: string | null;
  retrievedAt: string;
  simulated: boolean;
  fastag: FastagView | null;
}

export interface FastagListTotals {
  tags: number;
  needsAttention: number;
  blocked: number;
  lowBalance: number;
  unknownBalance: number;
  knownBalanceTotal: number;
}

export interface TollTransactionView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  tripId: string | null;
  plazaName: string;
  plazaCode: string | null;
  highway: string | null;
  laneId: string | null;
  latitude: number | null;
  longitude: number | null;
  direction: TollDirection;
  paymentMode: TollPaymentMode;
  amount: number;
  balanceAfter: number | null;
  crossedAt: string;
  source: TollDataSource;
  verificationStatus: FinanceVerificationStatus;
  conflictNote: string | null;
  notes: string | null;
  createdAt: string;
}

export interface TollSummaryResult {
  total: number;
  crossings: number;
  averagePerCrossing: number | null;
  byMode: Partial<Record<TollPaymentMode, number>>;
  topPlazas: { plazaName: string; crossings: number; total: number }[];
  windowDays: number;
  /** Crossings a network feed reported without a fare. */
  unpricedCrossings: number;
  vehiclesWithTolls: number;
  basis: 'calculated';
}

export interface TripCostSummary {
  tripReference: string;
  revenue: number | null;
  fuelCost: number;
  tollCost: number;
  otherExpenses: number;
  totalCost: number;
  margin: number | null;
  marginPercent: number | null;
  costPerKm: number | null;
  tollSharePercent: number | null;
  tollCrossings: number;
  basis: 'calculated';
}

export interface TollVarianceResult {
  tripReference: string;
  corridor: string;
  actual: number;
  expected: number | null;
  variance: number | null;
  variancePercent: number | null;
  sampleSize: number;
  verdict: 'NORMAL' | 'HIGH' | 'LOW' | 'INSUFFICIENT_DATA';
  basis: 'calculated';
}


// ---------------------------------------------------------------------------
// Requirements & bidding
// ---------------------------------------------------------------------------

/**
 * A customer requirement.
 *
 * One shape carries all four kinds, with the fields that do not apply left
 * null — the same compromise the table makes, for the same reason: the board
 * shows material, freight, cab and tour side by side, and a discriminated
 * union would mean every list rendered through a switch.
 */
export interface RequirementSummary {
  id: string;
  reference: string;
  kind: RequirementKind;
  status: RequirementStatus;
  title: string;
  description: string | null;

  customerOrganizationId: string;
  customerName: string;

  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  originCity: string | null;
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationCity: string | null;
  distanceKm: number | null;

  startAt: string;
  endAt: string | null;
  scheduleNotes: string | null;
  bidsCloseAt: string;
  biddingClosed: boolean;

  /** Null unless the customer published it, or the caller raised it. */
  budgetAmount: number | null;
  budgetIsPublic: boolean;
  /** Released to a bidder only once they have won. */
  contactName: string | null;
  contactPhone: string | null;

  materialId: string | null;
  materialName: string | null;
  materialCategory: string | null;
  specification: string | null;
  quantity: number | null;
  unit: MaterialUnit | null;
  needsTransport: boolean;

  goodsDescription: string | null;
  requiredCapacityTons: number | null;
  requiredTruckType: TruckType | null;
  handlingNotes: string | null;

  hireBasis: HireBasis | null;
  passengers: number | null;
  preferredVehicleType: VehicleType | null;
  durationHours: number | null;
  durationDays: number | null;
  durationNights: number | null;
  luggageCount: number | null;
  acRequired: boolean | null;
  destinations: string[];
  requiredInclusions: string[];
  accommodationNeeded: boolean | null;
  mealsNeeded: boolean | null;

  bidCount: number;
  lowestBid: number | null;
  awardedMaterialBidId: string | null;
  awardedTransportBidId: string | null;
  awardedTravelBidId: string | null;
  orderId: string | null;
  bookingId: string | null;

  cancellationReason: string | null;
  awardedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementBidSummary {
  id: string;
  requirementId: string;
  scope: RequirementBidScope;
  status: RequirementBidStatus;

  bidderOrganizationId: string;
  bidderName: string;
  bidderVerified: boolean;
  bidderRating: number | null;
  bidderRatingCount: number;

  price: number;
  priceBreakdown: string | null;
  message: string | null;
  validUntil: string | null;
  expired: boolean;

  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    capacityTons: number;
    verificationStatus: string;
  } | null;
  driver: { id: string; name: string; overallScore: number | null } | null;
  estimatedPickupAt: string | null;
  estimatedArrivalAt: string | null;
  distanceToPickupKm: number | null;

  materialId: string | null;
  includesDelivery: boolean;
  availableQuantity: number | null;
  leadTimeDays: number | null;

  offeredVehicleType: VehicleType | null;
  inclusions: string[];
  exclusions: string[];
  itinerarySummary: string | null;
  driverIncluded: boolean;
  fuelIncluded: boolean;

  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row on the provider board. */
export interface BoardRequirement extends RequirementSummary {
  distanceToOriginKm: number | null;
  /** Scopes this organization may still offer against it. */
  availableScopes: RequirementBidScope[];
  myBid: RequirementBidSummary | null;
}

export interface RequirementTimelineEvent {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

export interface AwardResult {
  requirement: RequirementSummary;
  orderId: string | null;
  tripId: string | null;
  bookingId: string | null;
  /** What the customer has to do next, in their own terms. */
  nextStep: string;
}
