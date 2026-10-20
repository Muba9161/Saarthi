/**
 * Vehicle sharing — one account's vehicle, seen and used from another's.
 *
 * The owner shares; the person it is shared with accepts. From then on they can
 * track the vehicle and add its trips, fuel and maintenance, and look at its
 * papers — and nothing more: no editing the vehicle, no driver assignment, no
 * uploading or changing papers, no finance, no resale, and the RC stays masked,
 * because it is the owner's personal data.
 *
 * Billing stays with the owner. A shared vehicle is still one vehicle, on the
 * account that holds it; the person it is shared with pays nothing for it, so
 * nobody is tempted to hand over their password instead of sharing properly.
 *
 * Everything the shared person adds is filed on the owner's account, with them
 * recorded as the author, so the vehicle's history stays in one place.
 */

import type { TrackRouteState, VehicleShareStatus, VehicleType } from './enums';

/** How many people one vehicle can be shared with at a time, pending invitations included. */
export const MAX_VEHICLE_SHARES = 3;

/** The owner's view of one share of their vehicle. */
export interface VehicleShareView {
  id: string;
  status: VehicleShareStatus;
  sharedWith: { name: string; email: string };
  invitedAt: string;
  respondedAt: string | null;
}

/** The shared person's view of a vehicle — the safe subset, never the owner's own screen. */
export interface SharedVehicleView {
  shareId: string;
  vehicleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  typeLabel: string;
  /** Body type, for goods vehicles; with [category], which picture the vehicle is drawn with. */
  truckType: string;
  category: string | null;
  /** The kind within its class ("SUV", "Tipper"), when the record says. */
  categoryLabel: string | null;
  manufacturer: string | null;
  model: string | null;
  status: string;
  odometerKm: number;
  /** `null` when the vehicle type carries no freight. */
  capacityTons: number | null;
  /** `null` when the vehicle type carries no passengers. */
  passengerCapacity: number | null;
  /** How its papers stand, as counts — the papers themselves are on the read-only papers view. */
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  /** The account that owns the vehicle and is billed for it. */
  ownerName: string;
  currentDriverName: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  sharedSince: string;
}

/** An invitation waiting for the person it was sent to. */
export interface VehicleShareInvitation {
  shareId: string;
  registrationNumber: string;
  typeLabel: string;
  ownerName: string;
  invitedBy: string;
  invitedAt: string;
}

export interface SharedWithMe {
  invitations: VehicleShareInvitation[];
  vehicles: SharedVehicleView[];
}

export interface SharedTripView {
  id: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  plannedStartAt: string | null;
  startedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
}

export interface SharedFuelView {
  id: string;
  quantityLitres: number;
  pricePerUnit: number;
  totalCost: number;
  odometerKm: number | null;
  stationName: string | null;
  recordedAt: string;
}

export interface SharedMaintenanceView {
  id: string;
  type: string;
  title: string;
  status: string;
  cost: number | null;
  odometerKm: number | null;
  serviceProvider: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** One point of road the vehicle covered, with how it stood against its trip's plan. */
export interface SharedTrailPoint {
  latitude: number;
  longitude: number;
  speedKph: number;
  recordedAt: string;
  routeState: TrackRouteState;
}

/** The trip the vehicle is on now: its two ends and the road planned between them. */
export interface SharedLiveTrip {
  id: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  plannedRoute: { latitude: number; longitude: number }[];
  startedAt: string | null;
}

/**
 * The vehicle's latest readings — only figures it measured, never simulated
 * ones, and only those the owner's own plan shows the owner.
 */
export interface SharedReading {
  recordedAt: string;
  speedKph: number | null;
  rpm: number | null;
  engineLoad: number | null;
  coolantTemperature: number | null;
  fuelLevel: number | null;
  batteryVoltage: number | null;
}

/** Following the vehicle: its current trip, the road it has covered, and its readings. */
export interface SharedVehicleLive {
  trip: SharedLiveTrip | null;
  /** Since `from` when asked, else since the trip started, else the last twelve hours. */
  trail: SharedTrailPoint[];
  reading: SharedReading | null;
}
