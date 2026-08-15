import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { RealtimeEvent, type ClientMessage, type ServerMessage } from '@saarthi/shared';
import { logger } from '../lib/logger';
import { verifyAccessToken } from '../auth/tokens';
import { buildAuthContext } from '../auth/session.service';
import { prisma } from '../database/prisma';
import { pubsub } from '../infra/event-bus';
import { canSubscribe, defaultChannels } from './channel-authorization';
import type { AuthContext } from '../auth/context';

/**
 * WebSocket gateway.
 *
 * Connections authenticate with the same access token as the REST API (passed
 * as a query parameter because browsers cannot set headers on a WebSocket
 * handshake). Subscriptions are authorised per channel, and a socket is only
 * ever handed messages for channels it successfully joined.
 */

interface Connection {
  socket: WebSocket;
  auth: AuthContext;
  channels: Set<string>;
  alive: boolean;
}

const connections = new Set<Connection>();
const wsLogger = logger.child({ module: 'realtime' });

function send(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  try {
    connection.socket.send(JSON.stringify(message));
  } catch (error) {
    wsLogger.warn({ err: error }, 'Failed to write to socket');
  }
}

// Single fan-out subscription: every published message is routed to the
// sockets that hold the corresponding channel.
pubsub.subscribeAll((channel, message) => {
  for (const connection of connections) {
    if (connection.channels.has(channel)) {
      send(connection, message as ServerMessage);
    }
  }
});

export function connectedClientCount(): number {
  return connections.size;
}

export async function websocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string; organizationId?: string };
    const token = query.token;

    if (!token) {
      socket.send(
        JSON.stringify({
          type: RealtimeEvent.ERROR,
          code: 'UNAUTHENTICATED',
          message: 'A valid access token is required to open a realtime connection.',
        } satisfies ServerMessage),
      );
      socket.close(4401, 'unauthenticated');
      return;
    }

    let auth: AuthContext;
    try {
      const claims = verifyAccessToken(token);
      const session = await prisma.session.findUnique({
        where: { id: claims.sid },
        select: { id: true, userId: true, organizationId: true, revokedAt: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt.getTime() < Date.now()
      ) {
        throw new Error('session invalid');
      }
      auth = await buildAuthContext(claims.sub, session.id, session.organizationId);
    } catch {
      socket.send(
        JSON.stringify({
          type: RealtimeEvent.ERROR,
          code: 'UNAUTHENTICATED',
          message: 'Your session is no longer valid. Please sign in again.',
        } satisfies ServerMessage),
      );
      socket.close(4401, 'unauthenticated');
      return;
    }

    const connection: Connection = {
      socket,
      auth,
      channels: new Set(defaultChannels(auth)),
      alive: true,
    };
    connections.add(connection);

    send(connection, {
      type: RealtimeEvent.CONNECTED,
      userId: auth.user.id,
      channels: [...connection.channels],
    });

    wsLogger.debug(
      { userId: auth.user.id, organizationId: auth.organizationId, channels: connection.channels.size },
      'Realtime client connected',
    );

    socket.on('message', (raw: Buffer) => {
      void (async () => {
        let message: ClientMessage;
        try {
          message = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          send(connection, {
            type: RealtimeEvent.ERROR,
            code: 'BAD_MESSAGE',
            message: 'Messages must be valid JSON.',
          });
          return;
        }

        if (message.type === 'ping') {
          connection.alive = true;
          send(connection, { type: RealtimeEvent.PONG, at: Date.now() });
          return;
        }

        if (message.type === 'subscribe') {
          const accepted: string[] = [];
          const rejected: string[] = [];
          // Bound the request so a client cannot force thousands of lookups.
          for (const channel of message.channels.slice(0, 50)) {
            if (connection.channels.has(channel)) {
              accepted.push(channel);
              continue;
            }
            const allowed = await canSubscribe(connection.auth, channel);
            if (allowed) {
              connection.channels.add(channel);
              accepted.push(channel);
            } else {
              rejected.push(channel);
            }
          }
          if (rejected.length > 0) {
            wsLogger.warn(
              { userId: connection.auth.user.id, rejected },
              'Rejected realtime channel subscription',
            );
          }
          send(connection, { type: RealtimeEvent.SUBSCRIBED, channels: accepted, rejected });
          return;
        }

        if (message.type === 'unsubscribe') {
          for (const channel of message.channels) connection.channels.delete(channel);
          send(connection, { type: RealtimeEvent.UNSUBSCRIBED, channels: message.channels });
        }
      })();
    });

    socket.on('pong', () => {
      connection.alive = true;
    });

    socket.on('close', () => {
      connections.delete(connection);
      wsLogger.debug({ userId: auth.user.id }, 'Realtime client disconnected');
    });

    socket.on('error', (error: Error) => {
      wsLogger.warn({ err: error, userId: auth.user.id }, 'Realtime socket error');
      connections.delete(connection);
    });
  });

  // Drop half-open sockets so a dead browser tab does not hold a slot forever.
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
