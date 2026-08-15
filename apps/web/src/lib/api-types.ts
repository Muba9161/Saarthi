import type {
  DocumentOwnerType,
  DocumentValidity,
  DocumentVerificationStatus,
  OrderStatus,
  PaginationMeta,
  SosStatus,
  SosType,
  TripStatus,
  VerificationStatus,
} from '@saarthi/shared';

/**
 * Response shapes returned by the Saarthi API.
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
  attributes: unknown;
  distanceKm: number;
  direction: string;
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
