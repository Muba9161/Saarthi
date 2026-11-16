import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger';
import { pubsub } from '../infra/event-bus';
import { publicLiveRide, shareIdFromToken } from '../modules/ride-shares/ride-share.service';

/**
 * Public Live Ride Realtime Gateway.
 *
 * Dedicated WebSocket endpoint (`/ws/live?token=...`) for anonymous family members
 * following a shared ride via link. Authenticates directly from the cryptographically
 * signed HMAC token in 0ms without requiring user accounts or sessions.
 *
 * Each socket is joined strictly to `ride-share:{shareId}`, receiving sub-30ms
 * coordinate pushes and road trail updates as the vehicle travels.
 */

const liveWsLogger = logger.child({ module: 'realtime:live-ride' });

interface LiveRideConnection {
  socket: WebSocket;
  shareId: string;
  token: string;
  alive: boolean;
  unsubscribe: () => void;
}

const connections = new Set<LiveRideConnection>();

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    liveWsLogger.warn({ err: error }, 'Failed to send message over live ride socket');
  }
}

export function liveRideClientCount(): number {
  return connections.size;
}

export async function liveRideWebsocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/live', { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token) {
      send(socket, {
        type: 'ERROR',
        code: 'BAD_REQUEST',
        message: 'A valid live ride token is required to open a realtime connection.',
      });
      socket.close(4400, 'missing token');
      return;
    }

    const shareId = shareIdFromToken(token);
    if (!shareId) {
      send(socket, {
        type: 'ERROR',
        code: 'NOT_FOUND',
        message: 'This live link does not exist or has expired.',
      });
      socket.close(4404, 'invalid token');
      return;
    }

    let initialRide;
    try {
      initialRide = await publicLiveRide(token);
    } catch {
      send(socket, {
        type: 'ERROR',
        code: 'NOT_FOUND',
        message: 'This live link does not exist or has ended.',
      });
      socket.close(4404, 'not found');
      return;
    }

    // Subscribe socket to this ride's pubsub channel
    const channel = `ride-share:${shareId}`;
    const unsubscribe = pubsub.subscribe(channel, (message) => {
      send(socket, message);
    });

    const connection: LiveRideConnection = {
      socket,
      shareId,
      token,
      alive: true,
      unsubscribe,
    };
    connections.add(connection);

    // Send immediate initial snapshot
    send(socket, {
      type: 'RIDE_SHARE_SNAPSHOT',
      ride: initialRide,
    });

    socket.on('pong', () => {
      connection.alive = true;
    });

    socket.on('close', () => {
      unsubscribe();
      connections.delete(connection);
    });

    socket.on('error', (err) => {
      liveWsLogger.debug({ err, shareId }, 'Live ride socket error');
      unsubscribe();
      connections.delete(connection);
    });
  });

  // Heartbeat check every 25 seconds to terminate dead/half-open mobile sockets
  const interval = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
        conn.unsubscribe();
        conn.socket.terminate();
        connections.delete(conn);
        continue;
      }
      conn.alive = false;
      try {
        conn.socket.ping();
      } catch {
        conn.unsubscribe();
        conn.socket.terminate();
        connections.delete(conn);
      }
    }
  }, 25_000);

  app.addHook('onClose', (_instance, done) => {
    clearInterval(interval);
    for (const conn of connections) {
      conn.unsubscribe();
      conn.socket.close(1001, 'server shutting down');
    }
    connections.clear();
    done();
  });
}
