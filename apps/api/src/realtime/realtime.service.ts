import {
  RealtimeChannel,
  RealtimeEvent,
  vehicleChannel,
  type AssociationAlertPayload,
  type BookingUpdatePayload,
  type ChannelMessage,
  type DeviceAssignmentPayload,
  type DeviceCommandPayload,
  type DeviceConfigPayload,
  type DeviceHeartbeatPayload,
  type DeviceStatusPayload,
  type NotificationPayload,
  type OrderUpdatePayload,
  type SimulationUpdatePayload,
  type SosPayload,
  type SosResponderRequestPayload,
  type TelemetryAlertPayload,
  type TelemetryUpdatePayload,
  type TerminalSessionPayload,
  type TripEventPayload,
  type TripProgressPayload,
  type TripUpdatePayload,
  type TruckLocationPayload,
  type TruckStatusPayload,
} from '@saarthi/shared';
import { pubsub } from '../infra/event-bus';

/**
 * Typed broadcast helpers.
 *
 * Services call these instead of touching the socket layer, which keeps every
 * outbound realtime message on a known channel with a known payload shape.
 * Fan-out is deliberately narrow: a message goes to the fleet that owns the
 * asset plus the specific parties entitled to see it, never to everyone.
 */

async function publish(channel: string, message: ChannelMessage): Promise<void> {
  await pubsub.publish(channel, message);
}

/** Same payload, re-addressed to another channel the recipient is allowed on. */
function retarget<T extends { channel: string }>(message: T, channel: string): T {
  return { ...message, channel } as T;
}

export async function broadcastTruckLocation(payload: TruckLocationPayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TRUCK_LOCATION,
    channel: RealtimeChannel.truck(payload.truckId),
    payload,
  };
  await publish(RealtimeChannel.truck(payload.truckId), message);
  await publish(RealtimeChannel.fleet(payload.organizationId), {
    ...message,
    channel: RealtimeChannel.fleet(payload.organizationId),
  });
  if (payload.tripId) {
    await publish(RealtimeChannel.trip(payload.tripId), {
      ...message,
      channel: RealtimeChannel.trip(payload.tripId),
    });
  }
}

export async function broadcastTruckStatus(payload: TruckStatusPayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TRUCK_STATUS,
    channel: RealtimeChannel.fleet(payload.organizationId),
    payload,
  };
  await publish(RealtimeChannel.fleet(payload.organizationId), message);
  await publish(RealtimeChannel.truck(payload.truckId), {
    ...message,
    channel: RealtimeChannel.truck(payload.truckId),
  });
}

export async function broadcastTripUpdate(payload: TripUpdatePayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TRIP_UPDATED,
    channel: RealtimeChannel.trip(payload.tripId),
    payload,
  };
  await publish(RealtimeChannel.trip(payload.tripId), message);
  await publish(RealtimeChannel.fleet(payload.organizationId), {
    ...message,
    channel: RealtimeChannel.fleet(payload.organizationId),
  });
  if (payload.orderId) {
    await publish(RealtimeChannel.order(payload.orderId), {
      ...message,
      channel: RealtimeChannel.order(payload.orderId),
    });
  }
  if (payload.driverId) {
    await publish(RealtimeChannel.driver(payload.driverId), {
      ...message,
      channel: RealtimeChannel.driver(payload.driverId),
    });
  }
}

export async function broadcastTripProgress(
  payload: TripProgressPayload,
  organizationId: string,
  orderId: string | null,
): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TRIP_PROGRESS,
    channel: RealtimeChannel.trip(payload.tripId),
    payload,
  };
  await publish(RealtimeChannel.trip(payload.tripId), message);
  await publish(RealtimeChannel.fleet(organizationId), {
    ...message,
    channel: RealtimeChannel.fleet(organizationId),
  });
  if (orderId) {
    await publish(RealtimeChannel.order(orderId), {
      ...message,
      channel: RealtimeChannel.order(orderId),
    });
  }
}

export async function broadcastTripEvent(
  payload: TripEventPayload,
  organizationId: string,
): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TRIP_EVENT,
    channel: RealtimeChannel.trip(payload.tripId),
    payload,
  };
  await publish(RealtimeChannel.trip(payload.tripId), message);
  await publish(RealtimeChannel.fleet(organizationId), {
    ...message,
    channel: RealtimeChannel.fleet(organizationId),
  });
}

export async function broadcastOrderUpdate(payload: OrderUpdatePayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.ORDER_UPDATED,
    channel: RealtimeChannel.order(payload.orderId),
    payload,
  };
  await publish(RealtimeChannel.order(payload.orderId), message);

  for (const organizationId of [
    payload.customerOrganizationId,
    payload.supplierOrganizationId,
    payload.fleetOrganizationId,
  ]) {
    if (!organizationId) continue;
    await publish(RealtimeChannel.fleet(organizationId), {
      ...message,
      channel: RealtimeChannel.fleet(organizationId),
    });
  }
}

export async function broadcastSos(
  payload: SosPayload,
  event: typeof RealtimeEvent.SOS_TRIGGERED | typeof RealtimeEvent.SOS_UPDATED,
): Promise<void> {
  const message: ChannelMessage = {
    type: event,
    channel: RealtimeChannel.sos(payload.incidentId),
    payload,
  };
  await publish(RealtimeChannel.sos(payload.incidentId), message);
  await publish(
    RealtimeChannel.fleet(payload.organizationId),
    retarget(message, RealtimeChannel.fleet(payload.organizationId)),
  );
  // Platform operators monitor every active incident.
  await publish(RealtimeChannel.admin(), retarget(message, RealtimeChannel.admin()));
}

export async function broadcastSosResponderRequest(
  payload: SosResponderRequestPayload,
  responderUserId: string,
  responderOrganizationId: string,
): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.SOS_RESPONDER_REQUEST,
    channel: RealtimeChannel.driver(payload.driverId),
    payload,
  };
  await publish(RealtimeChannel.driver(payload.driverId), message);
  await publish(RealtimeChannel.user(responderUserId), {
    ...message,
    channel: RealtimeChannel.user(responderUserId),
  });
  await publish(RealtimeChannel.fleet(responderOrganizationId), {
    ...message,
    channel: RealtimeChannel.fleet(responderOrganizationId),
  });
}

export async function broadcastNotification(payload: NotificationPayload): Promise<void> {
  await publish(RealtimeChannel.user(payload.userId), {
    type: RealtimeEvent.NOTIFICATION,
    channel: RealtimeChannel.user(payload.userId),
    payload,
  });
}

export async function broadcastSimulationUpdate(
  payload: SimulationUpdatePayload,
  organizationId: string,
): Promise<void> {
  await publish(RealtimeChannel.fleet(organizationId), {
    type: RealtimeEvent.SIMULATION_UPDATED,
    channel: RealtimeChannel.fleet(organizationId),
    payload,
  });
}

// ---------------------------------------------------------------------------
// Hardware & telemetry
// ---------------------------------------------------------------------------

/**
 * Publish a telemetry summary.
 *
 * Fan-out is deliberately narrow. A device reporting every second would, if
 * broadcast to the fleet channel, push 3,600 messages per hour per vehicle at
 * every dashboard in the organization — so the *fleet* stream carries telemetry
 * only for vehicles the caller is actively watching by subscribing to the
 * vehicle channel. The fleet channel already receives location through
 * `broadcastTruckLocation`, which is what the map needs.
 */
export async function broadcastTelemetry(payload: TelemetryUpdatePayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TELEMETRY_UPDATED,
    channel: vehicleChannel(payload.vehicleId),
    payload,
  };
  await publish(vehicleChannel(payload.vehicleId), message);
  await publish(
    RealtimeChannel.device(payload.deviceId),
    retarget(message, RealtimeChannel.device(payload.deviceId)),
  );
}

export async function broadcastDeviceStatus(
  payload: DeviceStatusPayload,
  online: boolean,
): Promise<void> {
  const event = online ? RealtimeEvent.DEVICE_ONLINE : RealtimeEvent.DEVICE_OFFLINE;
  const message: ChannelMessage = {
    type: event,
    channel: RealtimeChannel.device(payload.deviceId),
    payload,
  };
  await publish(RealtimeChannel.device(payload.deviceId), message);
  // Device connectivity is a fleet-wide operational concern, unlike the
  // high-frequency readings themselves.
  await publish(
    RealtimeChannel.fleet(payload.organizationId),
    retarget(message, RealtimeChannel.fleet(payload.organizationId)),
  );
  if (payload.vehicleId) {
    await publish(
      vehicleChannel(payload.vehicleId),
      retarget(message, vehicleChannel(payload.vehicleId)),
    );
  }
}

/**
 * Push a device's own health report.
 *
 * Goes to the fleet stream as well as the device's own, because "the driver's
 * phone is on 4% and buffering" is an operational fact a dispatcher acts on,
 * not a detail you should have to open a device page to discover. It is low
 * frequency by construction — one message every thirty seconds per unit — so
 * unlike telemetry it needs no throttle.
 */
export async function broadcastDeviceHeartbeat(payload: DeviceHeartbeatPayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.DEVICE_HEARTBEAT,
    channel: RealtimeChannel.device(payload.deviceId),
    payload,
  };
  await publish(RealtimeChannel.device(payload.deviceId), message);
  await publish(
    RealtimeChannel.fleet(payload.organizationId),
    retarget(message, RealtimeChannel.fleet(payload.organizationId)),
  );
  if (payload.vehicleId) {
    await publish(
      vehicleChannel(payload.vehicleId),
      retarget(message, vehicleChannel(payload.vehicleId)),
    );
  }
}

/** A device joined or left a vehicle. Drives the Hardware tab without a refetch. */
export async function broadcastDeviceAssignment(
  payload: DeviceAssignmentPayload,
  paired: boolean,
): Promise<void> {
  const event = paired ? RealtimeEvent.DEVICE_PAIRED : RealtimeEvent.DEVICE_UNPAIRED;
  const message: ChannelMessage = {
    type: event,
    channel: RealtimeChannel.fleet(payload.organizationId),
    payload,
  };
  await publish(RealtimeChannel.fleet(payload.organizationId), message);
  await publish(
    RealtimeChannel.device(payload.deviceId),
    retarget(message, RealtimeChannel.device(payload.deviceId)),
  );
  await publish(
    vehicleChannel(payload.vehicleId),
    retarget(message, vehicleChannel(payload.vehicleId)),
  );
}

/**
 * Address a command to one device.
 *
 * Published only on the device's own channel. A device socket joins that
 * channel and nothing else, so this is the whole of the server-to-device
 * surface — there is no path by which a unit could be handed another unit's
 * instructions. Dashboards watching the same device see it too, which is
 * intended: an operator should see what was asked of the unit they are looking
 * at.
 */
export async function broadcastDeviceCommand(payload: DeviceCommandPayload): Promise<void> {
  await publish(RealtimeChannel.device(payload.deviceId), {
    type: RealtimeEvent.DEVICE_COMMAND,
    channel: RealtimeChannel.device(payload.deviceId),
    payload,
  });
}

/**
 * A Saarthi Terminal driver session changed.
 *
 * Three recipients, and each of them is waiting on this specific fact:
 *
 *   * the **terminal** itself, on its own device channel — a tablet showing
 *     "waiting for approval" has nothing else to go on;
 *   * the **fleet**, so the approval queue updates without a poll, and so a
 *     second manager sees a request disappear the moment a colleague decides it;
 *   * the **driver**, on their own channel, because they made the request from
 *     their phone and are standing next to the truck looking at it.
 *
 * The selfie is deliberately not in the payload — a photograph of a person is
 * fetched through the media endpoint by somebody entitled to it, never pushed
 * onto every socket subscribed to a fleet.
 */
export async function broadcastTerminalSession(
  payload: TerminalSessionPayload,
): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TERMINAL_SESSION_UPDATED,
    channel: RealtimeChannel.device(payload.terminalDeviceId),
    payload,
  };

  await publish(RealtimeChannel.device(payload.terminalDeviceId), message);
  await publish(
    RealtimeChannel.fleet(payload.organizationId),
    retarget(message, RealtimeChannel.fleet(payload.organizationId)),
  );
  await publish(
    RealtimeChannel.driver(payload.driverId),
    retarget(message, RealtimeChannel.driver(payload.driverId)),
  );
  await publish(
    vehicleChannel(payload.vehicleId),
    retarget(message, vehicleChannel(payload.vehicleId)),
  );
}

/** Configuration a device must adopt without waiting for its next poll. */
export async function broadcastDeviceConfig(payload: DeviceConfigPayload): Promise<void> {
  await publish(RealtimeChannel.device(payload.deviceId), {
    type: RealtimeEvent.DEVICE_CONFIG_UPDATED,
    channel: RealtimeChannel.device(payload.deviceId),
    payload,
  });
}

export async function broadcastTelemetryAlert(payload: TelemetryAlertPayload): Promise<void> {
  const message: ChannelMessage = {
    type: RealtimeEvent.TELEMETRY_ALERT_CREATED,
    channel: RealtimeChannel.fleet(payload.organizationId),
    payload,
  };
  await publish(RealtimeChannel.fleet(payload.organizationId), message);
  await publish(
    vehicleChannel(payload.vehicleId),
    retarget(message, vehicleChannel(payload.vehicleId)),
  );
  if (payload.driverId) {
    await publish(
      RealtimeChannel.driver(payload.driverId),
      retarget(message, RealtimeChannel.driver(payload.driverId)),
    );
  }
}

// ---------------------------------------------------------------------------
// Association emergency network
// ---------------------------------------------------------------------------

/**
 * Push an alert to one association.
 *
 * Addressed *only* to that association's own channel. It deliberately does not
 * go to the fleet channel: the payload is the association-facing projection,
 * and the fleet already receives the full incident through `broadcastSos`.
 * Sending this to both would give two audiences two different views of one
 * event on the same wire, which is how privacy rules get eroded by accident.
 */
export async function broadcastAssociationAlert(
  payload: AssociationAlertPayload,
  created: boolean,
): Promise<void> {
  const event = created
    ? RealtimeEvent.ASSOCIATION_ALERT_CREATED
    : RealtimeEvent.ASSOCIATION_ALERT_UPDATED;
  await publish(RealtimeChannel.association(payload.associationOrganizationId), {
    type: event,
    channel: RealtimeChannel.association(payload.associationOrganizationId),
    payload,
  });
}

// ---------------------------------------------------------------------------
// Travel bookings
// ---------------------------------------------------------------------------

export async function broadcastBooking(
  payload: BookingUpdatePayload,
  created: boolean,
): Promise<void> {
  const event = created ? RealtimeEvent.BOOKING_CREATED : RealtimeEvent.BOOKING_UPDATED;
  const message: ChannelMessage = {
    type: event,
    channel: RealtimeChannel.booking(payload.bookingId),
    payload,
  };
  await publish(RealtimeChannel.booking(payload.bookingId), message);
  // Both sides of the transaction see it on their own tenant stream.
  for (const organizationId of [
    payload.customerOrganizationId,
    payload.providerOrganizationId,
  ]) {
    await publish(
      RealtimeChannel.fleet(organizationId),
      retarget(message, RealtimeChannel.fleet(organizationId)),
    );
  }
  if (payload.driverId) {
    await publish(
      RealtimeChannel.driver(payload.driverId),
      retarget(message, RealtimeChannel.driver(payload.driverId)),
    );
  }
}
