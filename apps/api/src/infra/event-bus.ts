import { EventEmitter } from 'node:events';
import { config } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Channel-oriented publish/subscribe.
 *
 * Locally this is an in-process emitter, which is all a single Node instance
 * needs. The interface matches what a Redis pub/sub adapter provides, so
 * scaling the realtime layer horizontally in production is a driver swap
 * (`PUBSUB_DRIVER=redis`) rather than a rewrite of the broadcast call sites.
 */
export interface PubSubDriver {
  readonly name: string;
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: (message: unknown) => void): () => void;
  /** Receive every message regardless of channel (used by the WS gateway). */
  subscribeAll(handler: (channel: string, message: unknown) => void): () => void;
  close(): Promise<void>;
}

class MemoryPubSub implements PubSubDriver {
  readonly name = 'memory';
  private readonly emitter = new EventEmitter();
  private readonly wildcard = new Set<(channel: string, message: unknown) => void>();

  constructor() {
    // Fleet dashboards can legitimately hold many channel subscriptions.
    this.emitter.setMaxListeners(0);
  }

  async publish(channel: string, message: unknown): Promise<void> {
    this.emitter.emit(channel, message);
    for (const handler of this.wildcard) {
      try {
        handler(channel, message);
      } catch (error) {
        logger.error({ err: error, channel }, 'Pub/sub wildcard handler failed');
      }
    }
  }

  subscribe(channel: string, handler: (message: unknown) => void): () => void {
    const wrapped = (message: unknown): void => {
      try {
        handler(message);
      } catch (error) {
        logger.error({ err: error, channel }, 'Pub/sub handler failed');
      }
    };
    this.emitter.on(channel, wrapped);
    return () => this.emitter.off(channel, wrapped);
  }

  subscribeAll(handler: (channel: string, message: unknown) => void): () => void {
    this.wildcard.add(handler);
    return () => this.wildcard.delete(handler);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.wildcard.clear();
  }
}

function createPubSub(): PubSubDriver {
  if (config.infra.pubsubDriver === 'redis') {
    // Deliberately explicit: silently degrading to in-process delivery would
    // break cross-instance realtime in a way that is very hard to diagnose.
    throw new Error(
      'PUBSUB_DRIVER=redis requires the Redis pub/sub adapter to be configured. ' +
        'Set PUBSUB_DRIVER=memory for single-instance local development.',
    );
  }
  return new MemoryPubSub();
}

export const pubsub: PubSubDriver = createPubSub();
