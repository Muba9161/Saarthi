import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { redisClient } from './redis';
import type { LockDriver, LockHandle } from './lock';

/**
 * Redis distributed lock.
 *
 * `SET key token NX PX ttl` — the standard single-node lock. Two details make
 * it safe rather than merely convenient:
 *
 *   • **Every lock carries a token**, and release is a Lua script that deletes
 *     the key only if the token still matches. Without that, a worker whose
 *     lease had already expired would release the *next* worker's lock on its
 *     way out, and two instances would run the same EMI sweep.
 *   • **Every lock has a TTL.** A process that dies holding a lock must not
 *     block the job for ever; the lease simply expires.
 *
 * This is not Redlock. It assumes one Redis, which is what Saarthi runs — and
 * the work it guards (a reminder sweep, a provider sync) is idempotent enough
 * that a split-brain double-run during a failover is survivable. The reminder
 * sweep, the one place a duplicate would actually be visible to a customer,
 * has its own database-level suppression on top.
 */

const lockLogger = logger.child({ module: 'redis:lock' });

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

function lockKey(key: string): string {
  return `saarthi:${config.env}:lock:${key}`;
}

export class RedisLock implements LockDriver {
  readonly name = 'redis';
  private readonly client: Redis;

  constructor(client: Redis = redisClient('lock')) {
    this.client = client;
  }

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const namespaced = lockKey(key);

    try {
      const result = await this.client.set(namespaced, token, 'PX', ttlMs, 'NX');
      if (result !== 'OK') return null;
    } catch (error) {
      // Failing closed is the safe choice: if the lock cannot be established,
      // the caller must not assume it holds one and run the work anyway.
      lockLogger.warn({ err: error, key }, 'Lock acquisition failed — skipping this run');
      return null;
    }

    return {
      key,
      release: async () => {
        try {
          await this.client.eval(RELEASE_SCRIPT, 1, namespaced, token);
        } catch (error) {
          // The lease expires on its own, so a failed release costs one cycle
          // of the job at worst.
          lockLogger.warn({ err: error, key }, 'Lock release failed — leaving it to expire');
        }
      },
    };
  }
}
