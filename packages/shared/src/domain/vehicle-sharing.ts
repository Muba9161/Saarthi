/**
 * Vehicle sharing — one account's vehicle, seen and used from another's.
 *
 * The owner shares; the person it is shared with accepts. From then on they can
 * track the vehicle and add its trips, fuel and maintenance — and nothing more:
 * no editing the vehicle, no driver assignment, no documents, no finance, no
 * resale, and the RC stays masked, because it is the owner's personal data.
 *
 * Billing stays with the owner. A shared vehicle is still one vehicle, on the
 * account that holds it; the person it is shared with pays nothing for it, so
 * nobody is tempted to hand over their password instead of sharing properly.
 *
 * Everything the shared person adds is filed on the owner's account, with them
 * recorded as the author, so the vehicle's history stays in one place.
 */

import type { VehicleShareStatus, VehicleType } from './enums';

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
  manufacturer: string | null;
  model: string | null;
  status: string;
  odometerKm: number;
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
