import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { RideShareStatus, type RideShareLiveMessage } from '@saarthi/shared';
import { logger } from '../lib/logger';
import { pubsub } from '../infra/event-bus';
import {
  publicLiveRide,
  rideShareChannel,
  shareIdFromToken,
} from '../modules/ride-shares/ride-share.service';

/**
 * The live link's socket (`/ws/live?token=…`), for whoever follows a shared
 * ride without an account. The signed link token is the whole credential, as
 * it is for `GET /public/live/:token`, and a socket only ever hears the one
 * share its token names.
 *
 * It is separate from `/ws` for the reason the device gateway is: that one
 * authenticates a signed-in person and lets them subscribe to channels; this
 * one must never grow a subscription surface. The page keeps polling beside
 * it, so a socket that cannot open or is turned away costs nothing but speed.
 */

/** Sockets held open at once, across all shares and on one share. */
const MAX_CONNECTIONS = 2_000;
const MAX_CONNECTIONS_PER_SHARE = 50;

/** RFC 6455 "try again later": the page falls back to polling and retries. */
const CLOSE_TRY_LATER = 1013;
const CLOSE_NOT_FOUND = 4404;

interface LiveRideConnection {
  socket: WebSocket;
  shareId: string;
  alive: boolean;
  unsubscribe: () => void;
}

const connections = new Set<LiveRideConnection>();
const liveLogger = logger.child({ module: 'realtime:live-ride' });

function send(socket: WebSocket, message: RideShareLiveMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    liveLogger.warn({ err: error }, 'Failed to write to live ride socket');
  }
}

function drop(connection: LiveRideConnection): void {
  connection.unsubscribe();
  connections.delete(connection);
}

function followersOf(shareId: string): number {
  let count = 0;
  for (const connection of connections) if (connection.shareId === shareId) count += 1;
  return count;
}

export async function liveRideWebsocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/live', { websocket: true }, async (socket, request) => {
    const { token } = request.query as { token?: string };
    const shareId = token ? shareIdFromToken(token) : null;
    if (!token || !shareId) {
      socket.close(CLOSE_NOT_FOUND, 'not found');
      return;
    }
    if (connections.size >= MAX_CONNECTIONS || followersOf(shareId) >= MAX_CONNECTIONS_PER_SHARE) {
      socket.close(CLOSE_TRY_LATER, 'too many followers');
      return;
    }

    const connection: LiveRideConnection = {
      socket,
      shareId,
      alive: true,
      // Joined before the ride is read, so no move between the two is missed.
      unsubscribe: pubsub.subscribe(rideShareChannel(shareId), (message) => {
        const update = message as RideShareLiveMessage;
        send(socket, update);
        if (update.type === 'RIDE_SHARE_ENDED') socket.close(1000, 'ride ended');
      }),
    };
    connections.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => drop(connection));
    socket.on('error', (error: Error) => {
      liveLogger.debug({ err: error, shareId }, 'Live ride socket error');
      drop(connection);
    });

    try {
      const ride = await publicLiveRide(token);
      send(socket, { type: 'RIDE_SHARE_SNAPSHOT', ride });
      if (ride.status !== RideShareStatus.SHARING) socket.close(1000, 'ride ended');
    } catch {
      socket.close(CLOSE_NOT_FOUND, 'not found');
    }
  });

  // Drop half-open sockets so a phone that went out of signal does not hold a slot forever.
  const heartbeat = setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        drop(connection);
        continue;
      }
      connection.alive = false;
      try {
        connection.socket.ping();
      } catch {
        drop(connection);
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const connection of connections) {
      connection.unsubscribe();
      connection.socket.close(1001, 'server shutting down');
    }
    connections.clear();
  });
}
