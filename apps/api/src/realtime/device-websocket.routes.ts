import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { RealtimeChannel, RealtimeEvent, type ServerMessage } from '@saarthi/shared';
import { logger } from '../lib/logger';
import { pubsub } from '../infra/event-bus';
import { resolveDeviceToken, type AuthenticatedDeviceContext } from '../modules/devices/device-auth';
import { collectCommands } from '../modules/devices/device-command.service';

/**
 * The device realtime gateway.
 *
 * Deliberately a separate endpoint from `/ws`, and deliberately much smaller.
 *
 * The user socket authenticates a *person*: it verifies a session row, builds a
 * full authorisation context, and then lets the client ask to join channels,
 * each of which is checked against the database. All of that exists because a
 * person legitimately watches many things and the set is not knowable in
 * advance.
 *
 * A device watches exactly one thing: itself. So there is no subscribe message,
 * no channel authorisation and no session lookup — the socket is joined to
 * `device:{id}` at the handshake and can never be joined to anything else. The
 * whole class of "client asked for a channel it should not have" cannot arise,
 * because the client is never asked what it wants.
 *
 * Reusing `/ws` and adding a device branch would have meant one handler holding
 * two authentication schemes and two authorisation models, where a mistake in
 * either leaks into the other. The duplication here is the cheaper risk.
 */

const deviceWsLogger = logger.child({ module: 'realtime:device' });

interface DeviceConnection {
  socket: WebSocket;
  device: AuthenticatedDeviceContext;
  channel: string;
  alive: boolean;
}

const connections = new Set<DeviceConnection>();

function send(connection: DeviceConnection, message: unknown): void {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  try {
    connection.socket.send(JSON.stringify(message));
  } catch (error) {
    deviceWsLogger.warn({ err: error }, 'Failed to write to device socket');
  }
}

// One fan-out subscription for every device socket, matching how the user
// gateway works. A message is delivered only to the socket whose own channel it
// names, which for a device is the only channel it holds.
pubsub.subscribeAll((channel, message) => {
  for (const connection of connections) {
    if (connection.channel === channel) {
      send(connection, message as ServerMessage);
    }
  }
});

export function connectedDeviceCount(): number {
  return connections.size;
}

export async function deviceWebsocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/device', { websocket: true }, async (socket, request) => {
    // A browser cannot set headers on a WebSocket handshake and neither can most
    // mobile clients, so the token travels as a query parameter — the same
    // compromise the user gateway makes, with the same short-lived credential.
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token) {
      socket.send(
        JSON.stringify({
          type: RealtimeEvent.ERROR,
          code: 'UNAUTHENTICATED',
          message: 'A device access token is required to open a realtime connection.',
        }),
      );
      socket.close(4401, 'unauthenticated');
      return;
    }

    let device: AuthenticatedDeviceContext;
    try {
      const caller = await resolveDeviceToken(token);
      if (!caller || caller.kind !== 'DEVICE') throw new Error('not a device');
      device = caller;
    } catch {
      socket.send(
        JSON.stringify({
          type: RealtimeEvent.ERROR,
          code: 'UNAUTHENTICATED',
          message: 'These device credentials are no longer valid. Exchange the device secret for a new token.',
        }),
      );
      socket.close(4401, 'unauthenticated');
      return;
    }

    const connection: DeviceConnection = {
      socket,
      device,
      // Fixed at the handshake. There is no message that can change it.
      channel: RealtimeChannel.device(device.id),
      alive: true,
    };
    connections.add(connection);

    send(connection, {
      type: RealtimeEvent.CONNECTED,
      userId: device.id,
      channels: [connection.channel],
    });

    deviceWsLogger.debug(
      { deviceIdentifier: device.deviceIdentifier, vehicleId: device.vehicleId },
      'Device realtime client connected',
    );

    // Anything issued while the unit was offline is handed over on connect, so
    // a device that reconnects does not have to wait for the next poll to find
    // out it was asked to do something.
    try {
      const pending = await collectCommands(device);
      for (const command of pending) {
        send(connection, {
          type: RealtimeEvent.DEVICE_COMMAND,
          channel: connection.channel,
          payload: {
            commandId: command.id,
            deviceId: device.id,
            organizationId: device.organizationId,
            type: command.type,
            payload: command.payload,
            issuedAt: command.issuedAt,
            expiresAt: command.expiresAt,
          },
        });
      }
    } catch (error) {
      deviceWsLogger.warn(
        { err: error, deviceIdentifier: device.deviceIdentifier },
        'Could not deliver queued commands on connect',
      );
    }

    socket.on('message', (raw: Buffer) => {
      // The device socket is one-way by design. Telemetry, heartbeats and
      // acknowledgements go over HTTP, where they are validated, rate limited
      // and idempotent; accepting them here would mean a second ingestion path
      // with none of that. `ping` is answered because a mobile network will drop
      // an idle connection otherwise.
      try {
        const message = JSON.parse(raw.toString()) as { type?: string };
        if (message.type === 'ping') {
          connection.alive = true;
          send(connection, { type: RealtimeEvent.PONG, at: Date.now() });
          return;
        }
      } catch {
        // Fall through to the same answer as any other unexpected message.
      }

      send(connection, {
        type: RealtimeEvent.ERROR,
        code: 'UNSUPPORTED',
        message: 'This connection delivers commands only. Post telemetry and acknowledgements to the device gateway.',
      });
    });

    socket.on('pong', () => {
      connection.alive = true;
    });

    socket.on('close', () => {
      connections.delete(connection);
      deviceWsLogger.debug(
        { deviceIdentifier: device.deviceIdentifier },
        'Device realtime client disconnected',
      );
    });

    socket.on('error', (error: Error) => {
      deviceWsLogger.warn(
        { err: error, deviceIdentifier: device.deviceIdentifier },
        'Device realtime socket error',
      );
      connections.delete(connection);
    });
  });

  // A phone that loses signal in a tunnel leaves a half-open socket behind. On a
  // mobile network that happens constantly, so the sweep is more important here
  // than on the browser gateway.
  const heartbeat = setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        connections.delete(connection);
        continue;
      }
      connection.alive = false;
      try {
        connection.socket.ping();
      } catch {
        connections.delete(connection);
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const connection of connections) connection.socket.close(1001, 'server shutting down');
    connections.clear();
  });
}
