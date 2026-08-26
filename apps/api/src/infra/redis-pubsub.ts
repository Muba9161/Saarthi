import type { Redis } from 'ioredis';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { redisClient, redisSubscriber } from './redis';
import type { PubSubDriver } from './event-bus';

/**
 * Redis pub/sub for the realtime layer.
 *
 * This is what makes more than one API instance possible. A telemetry frame
 * arrives at whichever instance the device connected to, and the dashboard
 * watching that vehicle is very likely holding a WebSocket on a different one;
 * without a shared bus the second instance never hears about it.
 *
 * Channels are namespaced by environment so a developer pointed at a shared
 * Redis cannot receive staging's vehicle positions.
 *
 * Delivery is at-most-once, which is correct for this traffic: a dropped
 * position update is superseded by the next one a second later. Anything that
 * must not be lost — an incident, a payment — is written to PostgreSQL first
 * and published second.
 */

const pubsubLogger = logger.child({ module: 'redis:pubsub' });

function namespaced(channel: string): string {
  return `saarthi:${config.env}:ch:${channel}`;
}

function denamespaced(channel: string): string {
  const prefix = `saarthi:${config.env}:ch:`;
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
}

export class RedisPubSub implements PubSubDriver {
  readonly name = 'redis';

  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  /** Local fan-out, so one Redis subscription serves many in-process handlers. */
  private readonly handlers = new Map<string, Set<(message: unknown) => void>>();
  private readonly wildcard = new Set<(channel: string, message: unknown) => void>();
  private patternSubscribed = false;

  constructor() {
    this.publisher = redisClient('publisher');
    this.subscriber = redisSubscriber('events');

    this.subscriber.on('message', (channel: string, payload: string) => {
      this.dispatch(denamespaced(channel), payload);
    });
    this.subscriber.on('pmessage', (_pattern: string, channel: string, payload: string) => {
      // Wildcard listeners only. Channel subscribers are served by `message`,
      // and dispatching both would deliver every event twice.
      const plain = denamespaced(channel);
      const parsed = this.parse(plain, payload);
      if (parsed === undefined) return;
      for (const handler of this.wildcard) {
        try {
          handler(plain, parsed);
        } catch (error) {
          pubsubLogger.error({ err: error, channel: plain }, 'Wildcard handler failed');
        }
      }
    });
  }

  private parse(channel: string, payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch (error) {
      pubsubLogger.warn({ err: error, channel }, 'Discarding unparseable message');
      return undefined;
    }
  }

  private dispatch(channel: string, payload: string): void {
    const listeners = this.handlers.get(channel);
    if (!listeners || listeners.size === 0) return;

    const message = this.parse(channel, payload);
    if (message === undefined) return;

    for (const handler of listeners) {
      try {
        handler(message);
      } catch (error) {
        // One bad handler must not stop the others from receiving the event.
        pubsubLogger.error({ err: error, channel }, 'Pub/sub handler failed');
      }
    }
  }

  async publish(channel: string, message: unknown): Promise<void> {
    try {
      await this.publisher.publish(namespaced(channel), JSON.stringify(message));
    } catch (error) {
      // Realtime is a best-effort overlay on state that is already persisted,
      // so a publish failure is logged and swallowed rather than failing the
      // request that produced the event.
      pubsubLogger.warn({ err: error, channel }, 'Publish failed');
    }
  }

  subscribe(channel: string, handler: (message: unknown) => void): () => void {
    const listeners = this.handlers.get(channel) ?? new Set();
    const first = listeners.size === 0;
    listeners.add(handler);
    this.handlers.set(channel, listeners);

    if (first) {
      void this.subscriber.subscribe(namespaced(channel)).catch((error: unknown) => {
        pubsubLogger.warn({ err: error, channel }, 'Subscribe failed');
      });
    }

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        // Unsubscribe when the last local listener goes, so a long-running
        // instance does not accumulate subscriptions for vehicles nobody is
        // watching any more.
        void this.subscriber.unsubscribe(namespaced(channel)).catch(() => undefined);
      }
    };
  }

  subscribeAll(handler: (channel: string, message: unknown) => void): () => void {
    this.wildcard.add(handler);

    if (!this.patternSubscribed) {
      this.patternSubscribed = true;
      void this.subscriber
        .psubscribe(`saarthi:${config.env}:ch:*`)
        .catch((error: unknown) => {
          pubsubLogger.warn({ err: error }, 'Pattern subscribe failed');
        });
    }

    return () => {
      this.wildcard.delete(handler);
      if (this.wildcard.size === 0 && this.patternSubscribed) {
        this.patternSubscribed = false;
        void this.subscriber.punsubscribe(`saarthi:${config.env}:ch:*`).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.wildcard.clear();
    await this.subscriber.quit().catch(() => undefined);
  }
}
