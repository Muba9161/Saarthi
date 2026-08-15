import { config } from '../config/env';

/**
 * Small key/value cache used for dashboard aggregates, nearby searches and
 * entitlement lookups. PostgreSQL always remains the source of truth — nothing
 * here may be the only copy of a fact.
 */
export interface CacheDriver {
  readonly name: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every key beginning with `prefix` (tenant-scoped invalidation). */
  deletePrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

class MemoryCache implements CacheDriver {
  readonly name = 'memory';
  private readonly store = new Map<string, Entry>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

function createCache(): CacheDriver {
  if (config.infra.cacheDriver === 'redis') {
    throw new Error(
      'CACHE_DRIVER=redis requires the Redis cache adapter to be configured. ' +
        'Set CACHE_DRIVER=memory for local development.',
    );
  }
  return new MemoryCache();
}

export const cache: CacheDriver = createCache();

/** Read-through helper: returns the cached value or computes and stores it. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cache.set(key, value, ttlSeconds);
  return value;
}
