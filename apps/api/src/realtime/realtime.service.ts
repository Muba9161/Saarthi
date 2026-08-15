import {
  RealtimeChannel,
  RealtimeEvent,
  type NotificationPayload,
  type OrderUpdatePayload,
  type ChannelMessage,
  type SimulationUpdatePayload,
  type SosPayload,
  type SosResponderRequestPayload,
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
