import type { Redis } from 'ioredis';
import { logger } from '../lib/logger';
import { redisClient } from './redis';
import type { CacheDriver } from './cache';

/**
 * Redis-backed cache.
 *
 * The important behaviour is what happens when Redis is unwell: every method
 * degrades to a miss rather than throwing. A cache is an optimisation, and
 * PostgreSQL is always the source of truth — an unreachable Redis should make
 * Saarthi slower, never broken. The one exception is `set`, where a failure is
 * simply dropped: the caller already has the value it was trying to store.
 */

const cacheLogger = logger.child({ module: 'redis:cache' });

export class RedisCache implements CacheDriver {
  readonly name = 'redis';
  private readonly client: Redis;

  constructor(client: Redis = redisClient('cache')) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      // A malformed value is treated as a miss and removed, so one bad write
      // cannot poison a key until its TTL expires.
      cacheLogger.warn({ err: error, key }, 'Cache read failed — treating as a miss');
      void this.delete(key).catch(() => undefined);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      // Every key gets a TTL. A cache entry with no expiry is a memory leak
      // with extra steps, and there is nothing here PostgreSQL cannot rebuild.
      await this.client.set(key, JSON.stringify(value), 'EX', Math.max(1, ttlSeconds));
    } catch (error) {
      cacheLogger.warn({ err: error, key }, 'Cache write failed — continuing without it');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      cacheLogger.warn({ err: error, key }, 'Cache delete failed');
    }
  }

  /**
   * Remove every key under a prefix.
   *
   * Uses SCAN, never KEYS: `KEYS prefix:*` blocks the whole server while it
   * walks the keyspace, and a tenant-wide invalidation on a busy instance is
   * exactly when that hurts most. Deletes are batched with UNLINK so the
   * reclaim happens on a background thread.
   */
  async deletePrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          200,
        );
        cursor = next;
        if (keys.length > 0) await this.client.unlink(...keys);
      } while (cursor !== '0');
    } catch (error) {
      cacheLogger.warn({ err: error, prefix }, 'Prefix invalidation failed');
    }
  }

  /**
   * Clear everything this environment owns.
   *
   * Deliberately *not* FLUSHDB: a developer pointing at a shared Redis would
   * wipe another environment's keys. The namespace prefix is the boundary.
   */
  async clear(): Promise<void> {
    const { config } = await import('../config/env');
    await this.deletePrefix(`saarthi:${config.env}:`);
  }
}
