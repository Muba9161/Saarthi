import Redis, { type RedisOptions } from 'ioredis';
import { config } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Redis connections.
 *
 * One factory, because Redis clients are not interchangeable once they are in
 * use: a connection in subscriber mode cannot run commands, so pub/sub needs
 * its own. Everything else — cache, locks, rate limits — shares a single
 * command connection.
 *
 * Two deliberate choices about failure:
 *
 *   • **`lazyConnect`.** The process must boot even when Redis is not up yet,
 *     because a container that refuses to start on a cold dependency is much
 *     harder to operate than one that reconnects.
 *   • **Bounded retries with a ceiling.** A tight reconnect loop against a dead
 *     Redis becomes its own outage. The backoff climbs to two seconds and stays
 *     there, and every failure is logged once rather than per attempt.
 */

const redisLogger = logger.child({ module: 'redis' });

function baseOptions(role: string): RedisOptions {
  return {
    lazyConnect: true,
    // Commands issued while disconnected wait for the reconnect rather than
    // failing instantly — a two-second blip should not surface as an error.
    enableOfflineQueue: true,
    maxRetriesPerRequest: 2,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 2_000);
      if (times === 1 || times % 10 === 0) {
        redisLogger.warn({ role, attempt: times, delay }, 'Reconnecting to Redis');
      }
      return delay;
    },
    reconnectOnError(error: Error) {
      // A failover promotes a replica; the client must reconnect rather than
      // keep writing to a node that now refuses writes.
      return error.message.includes('READONLY');
    },
  };
}

function connectionUrl(): string {
  const url = config.infra.redisUrl;
  if (!url) {
    throw new Error(
      'A Redis driver is selected but REDIS_URL is not set. ' +
        'Set REDIS_URL, or use the memory drivers for local development.',
    );
  }
  return url;
}

const clients = new Map<string, Redis>();

/**
 * A command connection, shared per role.
 *
 * Roles exist so a slow scan on the cache connection cannot delay a lock
 * acquisition, and so the logs say which subsystem a connection belongs to.
 */
export function redisClient(role: 'cache' | 'lock' | 'publisher' | 'rate-limit'): Redis {
  const existing = clients.get(role);
  if (existing) return existing;

  const client = new Redis(connectionUrl(), baseOptions(role));

  client.on('error', (error: Error) => {
    // Logged at warn, not error: a reconnect in progress is an expected state,
    // and paging on it would train everyone to ignore the page.
    redisLogger.warn({ role, err: error.message }, 'Redis connection error');
  });
  client.on('ready', () => redisLogger.info({ role }, 'Redis connection ready'));

  clients.set(role, client);
  void client.connect().catch((error: unknown) => {
    redisLogger.warn({ role, err: error }, 'Initial Redis connection failed — will retry');
  });

  return client;
}

/**
 * A dedicated subscriber connection.
 *
 * Never pooled: once a client subscribes it can issue no other commands, so
 * sharing one would break every caller that tried to read a key afterwards.
 */
export function redisSubscriber(name: string): Redis {
  const client = new Redis(connectionUrl(), baseOptions(`subscriber:${name}`));
  client.on('error', (error: Error) => {
    redisLogger.warn({ role: `subscriber:${name}`, err: error.message }, 'Redis subscriber error');
  });
  void client.connect().catch((error: unknown) => {
    redisLogger.warn({ name, err: error }, 'Initial Redis subscriber connection failed — will retry');
  });
  return client;
}

export async function closeRedisClients(): Promise<void> {
  for (const [role, client] of clients) {
    try {
      await client.quit();
    } catch (error) {
      redisLogger.warn({ role, err: error }, 'Redis client did not close cleanly');
    }
  }
  clients.clear();
}

/** True when any Redis-backed driver is selected for this environment. */
export function redisEnabled(): boolean {
  return (
    config.infra.cacheDriver === 'redis' ||
    config.infra.pubsubDriver === 'redis' ||
    config.infra.queueDriver === 'redis' ||
    config.infra.lockDriver === 'redis'
  );
}
