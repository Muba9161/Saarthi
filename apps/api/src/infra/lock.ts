import { config } from '../config/env';
import { logger } from '../lib/logger';
import { RedisLock } from './redis-lock';

/**
 * Distributed locks.
 *
 * Scheduled work that sends money reminders, syncs a provider or bills a
 * renewal must run exactly once per tick, not once per worker. Locally there is
 * one process and an in-memory lock is sufficient and honest; in production the
 * same call sites acquire a Redis lock instead, which is a driver swap rather
 * than a change to any job.
 *
 * The interface is deliberately lease-based (`ttlMs`) rather than an explicit
 * unlock-only design: a worker that dies mid-job must not hold the lock for
 * every subsequent tick.
 */

export interface LockHandle {
  readonly key: string;
  release(): Promise<void>;
}

export interface LockDriver {
  readonly name: string;
  /** Returns `null` when the lock is already held by someone else. */
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
}

class MemoryLock implements LockDriver {
  readonly name = 'memory';
  private readonly held = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const now = Date.now();
    const expiresAt = this.held.get(key);
    if (expiresAt !== undefined && expiresAt > now) return null;

    this.held.set(key, now + ttlMs);
    return {
      key,
      release: async () => {
        // Only release a lease we still own; a lease that already expired may
        // belong to the next run by now.
        if ((this.held.get(key) ?? 0) > Date.now()) this.held.delete(key);
      },
    };
  }
}

function createLock(): LockDriver {
  if (config.infra.lockDriver === 'redis') {
    return new RedisLock();
  }
  return new MemoryLock();
}

export const locks: LockDriver = createLock();

/**
 * Run `task` while holding `key`, or skip it if someone else holds the lock.
 *
 * Returns `null` when the lock could not be taken. Callers treat that as a
 * normal outcome — another worker is already doing the work.
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  task: () => Promise<T>,
): Promise<T | null> {
  const handle = await locks.acquire(key, ttlMs);
  if (!handle) {
    logger.debug({ lock: key }, 'Lock held elsewhere — skipping this run');
    return null;
  }
  try {
    return await task();
  } finally {
    await handle.release();
  }
}
