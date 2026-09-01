/**
 * Realtime contract shared by the WebSocket gateway and the React client.
 *
 * Channels are namespaced strings. The server authorises every subscription
 * before adding a socket to a channel — a client asking for
 * `fleet:{otherOrgId}` is rejected, never silently ignored.
 */

import type { LatLng } from '../domain/geo';
import type {
  AlertSeverity,
  AssociationAlertStatus,
  BookingStatus,
  DeviceCommandType,
  DeviceNetworkType,
  DeviceStatus,
  DeviceSubsystemStatus,
  NotificationPriority,
  NotificationType,
  OrderStatus,
  SosStatus,
  SosType,
  TelemetryAlertType,
  TelemetryMetric,
  TrackingSource,
  TripStatus,
  TruckStatus,
  VehicleType,
} from '../domain/enums';

export const RealtimeChannel = {
  fleet: (organizationId: string) => `fleet:${organizationId}`,
  truck: (truckId: string) => `truck:${truckId}`,
  trip: (tripId: string) => `trip:${tripId}`,
  order: (orderId: string) => `order:${orderId}`,
  sos: (incidentId: string) => `sos:${incidentId}`,
  user: (userId: string) => `user:${userId}`,
  driver: (driverId: string) => `driver:${driverId}`,
  /** A truck association's own alert feed, scoped to its organization. */
  association: (organizationId: string) => `association:${organizationId}`,
  /** A single telematics device — used by the device and telemetry screens. */
  device: (deviceId: string) => `device:${deviceId}`,
  /** One travel booking, shared by the customer and the provider. */
  booking: (bookingId: string) => `booking:${bookingId}`,
  admin: () => 'admin:platform',
} as const;

/**
 * The generalized vehicle surface addresses the same rows as the truck surface,
 * so it publishes on the same channel. Broadcasting one entity under two
 * channel names would mean a subscriber to either could miss half its updates.
 */
export const vehicleChannel = (vehicleId: string): string => `truck:${vehicleId}`;

export type ChannelKind =
  | 'fleet'
  | 'truck'
  | 'trip'
  | 'order'
  | 'sos'
  | 'user'
  | 'driver'
  | 'association'
  | 'device'
  | 'booking'
  | 'admin';

export interface ParsedChannel {
  kind: ChannelKind;
  id: string | null;
}

export function parseChannel(channel: string): ParsedChannel | null {
  const separator = channel.indexOf(':');
  if (separator === -1) return null;
  const kind = channel.slice(0, separator) as ChannelKind;
  const id = channel.slice(separator + 1);
  const known: ChannelKind[] = [
    'fleet',
    'truck',
    'trip',
    'order',
    'sos',
    'user',
    'driver',
    'association',
    'device',
    'booking',
    'admin',
  ];
  if (!known.includes(kind)) return null;
  return { kind, id: kind === 'admin' ? null : id };
}

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'ping'; at?: number };

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const RealtimeEvent = {
  CONNECTED: 'connected',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  ERROR: 'error',
  PONG: 'pong',

  TRUCK_LOCATION: 'truck.location',
  TRUCK_STATUS: 'truck.status',

  TRIP_UPDATED: 'trip.updated',
  TRIP_EVENT: 'trip.event',
  TRIP_PROGRESS: 'trip.progress',

  ORDER_UPDATED: 'order.updated',

  SOS_TRIGGERED: 'sos.triggered',
  SOS_UPDATED: 'sos.updated',
  SOS_RESPONDER_REQUEST: 'sos.responder_request',

  NOTIFICATION: 'notification',

  SIMULATION_UPDATED: 'simulation.updated',

  // Hardware & telemetry
  TELEMETRY_UPDATED: 'vehicle.telemetry.updated',
  DEVICE_ONLINE: 'vehicle.device.online',
  DEVICE_OFFLINE: 'vehicle.device.offline',
  TELEMETRY_ALERT_CREATED: 'telemetry.alert.created',

  // Device client (Saarthi Device app and any future connected unit).
  //
  // Heartbeat is separate from DEVICE_ONLINE/OFFLINE because they answer
  // different questions: online is Saarthi's verdict formed from telemetry
  // silence, heartbeat is the unit's own report on its battery, radio and
  // sensors. A parked phone is quiet and perfectly healthy.
  DEVICE_HEARTBEAT: 'vehicle.device.heartbeat',
  DEVICE_PAIRED: 'vehicle.device.paired',
  DEVICE_UNPAIRED: 'vehicle.device.unpaired',
  /** Server → device. Delivered only on the device's own channel. */
  DEVICE_COMMAND: 'device.command',
  /** Server → device. Configuration the unit must adopt. */
  DEVICE_CONFIG_UPDATED: 'device.config.updated',

  // Association emergency network
  ASSOCIATION_ALERT_CREATED: 'association.alert.created',
  ASSOCIATION_ALERT_UPDATED: 'association.alert.updated',

  // Travel bookings
  BOOKING_CREATED: 'booking.created',
  BOOKING_UPDATED: 'booking.updated',
} as const;

export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface TruckLocationPayload extends LatLng {
  truckId: string;
  organizationId: string;
  tripId: string | null;
  driverId: string | null;
  speedKph: number;
  heading: number;
  accuracy: number | null;
  source: TrackingSource;
  recordedAt: string;
  /** True when the point came from the local simulator, never real hardware. */
  simulated: boolean;
}

export interface TruckStatusPayload {
  truckId: string;
  organizationId: string;
  status: TruckStatus;
  driverId: string | null;
  tripId: string | null;
  updatedAt: string;
}

export interface TripUpdatePayload {
  tripId: string;
  organizationId: string;
  orderId: string | null;
  truckId: string;
  driverId: string | null;
  status: TripStatus;
  updatedAt: string;
}

export interface TripProgressPayload {
  tripId: string;
  distanceCoveredKm: number;
  distanceRemainingKm: number;
  progressPercent: number;
  etaAt: string | null;
  delayMinutes: number;
  currentSpeedKph: number;
}

export interface TripEventPayload {
  tripId: string;
  eventId: string;
  type: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

export interface OrderUpdatePayload {
  orderId: string;
  status: OrderStatus;
  tripId: string | null;
  customerOrganizationId: string;
  supplierOrganizationId: string | null;
  fleetOrganizationId: string | null;
  updatedAt: string;
}

export interface SosPayload {
  incidentId: string;
  organizationId: string;
  driverId: string | null;
  truckId: string | null;
  tripId: string | null;
  type: SosType;
  status: SosStatus;
  latitude: number;
  longitude: number;
  description: string | null;
  triggeredAt: string;
  updatedAt: string;
}

export interface SosResponderRequestPayload {
  incidentId: string;
  responderId: string;
  truckId: string;
  driverId: string;
  distanceKm: number;
  incidentType: SosType;
  latitude: number;
  longitude: number;
  notifiedAt: string;
}

export interface NotificationPayload {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  priority: NotificationPriority;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface SimulationUpdatePayload {
  simulationId: string;
  truckId: string;
  tripId: string | null;
  status: string;
  progressPercent: number;
  speedMultiplier: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Hardware & telemetry payloads
// ---------------------------------------------------------------------------

/**
 * Live telemetry pushed to a dashboard.
 *
 * The `metrics` list is what stops the UI inventing data: a field is meaningful
 * only when its metric appears there. A vehicle whose device cannot read
 * coolant temperature sends `coolantTemperature: null` and omits
 * COOLANT_TEMPERATURE, and the gauge shows "not reported" rather than 0 °C.
 *
 * This is a *summary*, not the stored reading. Raw high-frequency telemetry is
 * never broadcast to every client — the gateway throttles per vehicle first.
 */
export interface TelemetryUpdatePayload {
  deviceId: string;
  vehicleId: string;
  organizationId: string;
  recordedAt: string;
  metrics: TelemetryMetric[];
  /**
   * Metrics in this reading that were produced by a simulator, not measured.
   *
   * Always a subset of `metrics`. A phone standing in for fitted hardware sends
   * a real position alongside an invented RPM, and a gauge must be able to say
   * which is which — "SIMULATED" beside the engine figures and nothing beside
   * the speed.
   */
  simulatedMetrics: TelemetryMetric[];
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  heading: number | null;
  rpm: number | null;
  coolantTemperature: number | null;
  fuelLevel: number | null;
  batteryVoltage: number | null;
  engineLoad: number | null;
  harshBraking: boolean;
  harshAcceleration: boolean;
  /** True when produced by the simulator rather than physical hardware. */
  simulated: boolean;
}

export interface DeviceStatusPayload {
  deviceId: string;
  serialNumber: string;
  organizationId: string;
  vehicleId: string | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  /** Seconds of silence that produced an offline verdict. */
  silentForSeconds: number | null;
  updatedAt: string;
}

/**
 * A connected device's own report on itself.
 *
 * Distinct from `DeviceStatusPayload`, which carries Saarthi's verdict about
 * whether a unit is reporting. This carries what the unit says about its own
 * battery, radio and subsystems, which is what a dispatcher needs in order to
 * tell "the driver's phone is on 4%" from "the SIM is dead".
 */
export interface DeviceHeartbeatPayload {
  deviceId: string;
  deviceIdentifier: string;
  organizationId: string;
  vehicleId: string | null;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  networkType: DeviceNetworkType;
  gpsStatus: DeviceSubsystemStatus;
  cameraStatus: DeviceSubsystemStatus;
  /** Events the device is still holding locally because it could not upload. */
  bufferedEvents: number;
  appVersion: string | null;
  reportedAt: string;
}

/** A device joined or left a vehicle. Drives the Hardware tab without a refetch. */
export interface DeviceAssignmentPayload {
  deviceId: string;
  deviceIdentifier: string;
  organizationId: string;
  vehicleId: string;
  registrationNumber: string;
  deviceType: string;
  provider: string;
  assignedAt: string | null;
  unassignedAt: string | null;
  reason: string | null;
}

/**
 * A command addressed to one device.
 *
 * Published only on `device:{deviceId}`, which a device socket joins for itself
 * and nothing else. Dashboards subscribed to the same channel see it too, which
 * is intended: an operator watching a unit should see what was asked of it.
 */
export interface DeviceCommandPayload {
  commandId: string;
  deviceId: string;
  organizationId: string;
  type: DeviceCommandType;
  payload: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string;
}

/** Configuration a device must adopt without waiting for its next poll. */
export interface DeviceConfigPayload {
  deviceId: string;
  reportingIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  videoEnabled: boolean;
  simulationAllowed: boolean;
  updatedAt: string;
}

export interface TelemetryAlertPayload {
  alertId: string;
  organizationId: string;
  vehicleId: string;
  vehicleRegistration: string;
  deviceId: string | null;
  driverId: string | null;
  type: TelemetryAlertType;
  severity: AlertSeverity;
  message: string;
  /** The observed value that tripped the rule, and the rule threshold. */
  observedValue: number | null;
  threshold: number | null;
  unit: string | null;
  latitude: number | null;
  longitude: number | null;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Association payloads
// ---------------------------------------------------------------------------

/**
 * The association-facing view of an emergency.
 *
 * This payload is the privacy boundary expressed in realtime form: location,
 * vehicle registration and severity, and nothing about the customer, the cargo,
 * the finances or the vehicle's telemetry. Driver contact details are withheld
 * until a named association user acknowledges the alert.
 */
export interface AssociationAlertPayload {
  alertId: string;
  associationOrganizationId: string;
  reference: string;
  incidentType: SosType;
  severity: AlertSeverity;
  status: AssociationAlertStatus;
  vehicleRegistration: string | null;
  fleetName: string | null;
  latitude: number;
  longitude: number;
  district: string | null;
  state: string | null;
  distanceKm: number | null;
  description: string | null;
  triggeredAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Travel booking payloads
// ---------------------------------------------------------------------------

export interface BookingUpdatePayload {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  packageId: string | null;
  packageTitle: string | null;
  customerOrganizationId: string;
  providerOrganizationId: string;
  vehicleId: string | null;
  vehicleType: VehicleType | null;
  driverId: string | null;
  tripId: string | null;
  startDate: string;
  totalAmount: number;
  updatedAt: string;
}

/** Connection-level messages that are not addressed to a channel. */
export type ControlMessage =
  | { type: typeof RealtimeEvent.CONNECTED; userId: string; channels: string[] }
  | { type: typeof RealtimeEvent.SUBSCRIBED; channels: string[]; rejected: string[] }
  | { type: typeof RealtimeEvent.UNSUBSCRIBED; channels: string[] }
  | { type: typeof RealtimeEvent.ERROR; code: string; message: string }
  | { type: typeof RealtimeEvent.PONG; at: number };

/** Domain events, always delivered on a specific authorised channel. */
export type ChannelMessage =
  | { type: typeof RealtimeEvent.TRUCK_LOCATION; channel: string; payload: TruckLocationPayload }
  | { type: typeof RealtimeEvent.TRUCK_STATUS; channel: string; payload: TruckStatusPayload }
  | { type: typeof RealtimeEvent.TRIP_UPDATED; channel: string; payload: TripUpdatePayload }
  | { type: typeof RealtimeEvent.TRIP_EVENT; channel: string; payload: TripEventPayload }
  | { type: typeof RealtimeEvent.TRIP_PROGRESS; channel: string; payload: TripProgressPayload }
  | { type: typeof RealtimeEvent.ORDER_UPDATED; channel: string; payload: OrderUpdatePayload }
  | { type: typeof RealtimeEvent.SOS_TRIGGERED; channel: string; payload: SosPayload }
  | { type: typeof RealtimeEvent.SOS_UPDATED; channel: string; payload: SosPayload }
  | {
      type: typeof RealtimeEvent.SOS_RESPONDER_REQUEST;
      channel: string;
      payload: SosResponderRequestPayload;
    }
  | { type: typeof RealtimeEvent.NOTIFICATION; channel: string; payload: NotificationPayload }
  | {
      type: typeof RealtimeEvent.SIMULATION_UPDATED;
      channel: string;
      payload: SimulationUpdatePayload;
    }
  | {
      type: typeof RealtimeEvent.TELEMETRY_UPDATED;
      channel: string;
      payload: TelemetryUpdatePayload;
    }
  | { type: typeof RealtimeEvent.DEVICE_ONLINE; channel: string; payload: DeviceStatusPayload }
  | { type: typeof RealtimeEvent.DEVICE_OFFLINE; channel: string; payload: DeviceStatusPayload }
  | {
      type: typeof RealtimeEvent.DEVICE_HEARTBEAT;
      channel: string;
      payload: DeviceHeartbeatPayload;
    }
  | {
      type: typeof RealtimeEvent.DEVICE_PAIRED;
      channel: string;
      payload: DeviceAssignmentPayload;
    }
  | {
      type: typeof RealtimeEvent.DEVICE_UNPAIRED;
      channel: string;
      payload: DeviceAssignmentPayload;
    }
  | { type: typeof RealtimeEvent.DEVICE_COMMAND; channel: string; payload: DeviceCommandPayload }
  | {
      type: typeof RealtimeEvent.DEVICE_CONFIG_UPDATED;
      channel: string;
      payload: DeviceConfigPayload;
    }
  | {
      type: typeof RealtimeEvent.TELEMETRY_ALERT_CREATED;
      channel: string;
      payload: TelemetryAlertPayload;
    }
  | {
      type: typeof RealtimeEvent.ASSOCIATION_ALERT_CREATED;
      channel: string;
      payload: AssociationAlertPayload;
    }
  | {
      type: typeof RealtimeEvent.ASSOCIATION_ALERT_UPDATED;
      channel: string;
      payload: AssociationAlertPayload;
    }
  | { type: typeof RealtimeEvent.BOOKING_CREATED; channel: string; payload: BookingUpdatePayload }
  | {
      type: typeof RealtimeEvent.BOOKING_UPDATED;
      channel: string;
      payload: BookingUpdatePayload;
    };

export type ServerMessage = ControlMessage | ChannelMessage;
