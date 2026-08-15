/**
 * Realtime contract shared by the WebSocket gateway and the React client.
 *
 * Channels are namespaced strings. The server authorises every subscription
 * before adding a socket to a channel — a client asking for
 * `fleet:{otherOrgId}` is rejected, never silently ignored.
 */

import type { LatLng } from '../domain/geo';
import type {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  SosStatus,
  SosType,
  TrackingSource,
  TripStatus,
  TruckStatus,
} from '../domain/enums';

export const RealtimeChannel = {
  fleet: (organizationId: string) => `fleet:${organizationId}`,
  truck: (truckId: string) => `truck:${truckId}`,
  trip: (tripId: string) => `trip:${tripId}`,
  order: (orderId: string) => `order:${orderId}`,
  sos: (incidentId: string) => `sos:${incidentId}`,
  user: (userId: string) => `user:${userId}`,
  driver: (driverId: string) => `driver:${driverId}`,
  admin: () => 'admin:platform',
} as const;

export type ChannelKind = 'fleet' | 'truck' | 'trip' | 'order' | 'sos' | 'user' | 'driver' | 'admin';

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
    };

export type ServerMessage = ControlMessage | ChannelMessage;
