import { config } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Background job abstraction.
 *
 * Local development uses an in-process scheduler so no Redis is required;
 * production swaps in BullMQ (`QUEUE_DRIVER=redis`) without any change to the
 * job handlers themselves, which are plain async functions.
 */
export interface JobContext {
  jobName: string;
  scheduledAt: Date;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface RepeatingJob {
  name: string;
  /** Interval in milliseconds. */
  everyMs: number;
  /** Delay before the first run; defaults to `everyMs`. */
  initialDelayMs?: number;
  handler: JobHandler;
}

export interface QueueDriver {
  readonly name: string;
  /** Run a one-off job as soon as the event loop allows. */
  enqueue(jobName: string, handler: JobHandler): void;
  registerRepeating(job: RepeatingJob): void;
  start(): void;
  stop(): Promise<void>;
}

class MemoryQueue implements QueueDriver {
  readonly name = 'memory';
  private readonly repeating: RepeatingJob[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private started = false;

  enqueue(jobName: string, handler: JobHandler): void {
    setImmediate(() => {
      void this.run(jobName, handler);
    });
  }

  registerRepeating(job: RepeatingJob): void {
    this.repeating.push(job);
    if (this.started) this.schedule(job);
  }

  private async run(jobName: string, handler: JobHandler): Promise<void> {
    const startedAt = Date.now();
    try {
      await handler({ jobName, scheduledAt: new Date() });
      logger.debug({ job: jobName, durationMs: Date.now() - startedAt }, 'Job completed');
    } catch (error) {
      logger.error({ err: error, job: jobName }, 'Job failed');
    }
  }

  private schedule(job: RepeatingJob): void {
    const kickoff = setTimeout(() => {
      void this.run(job.name, job.handler);
      const interval = setInterval(() => {
        void this.run(job.name, job.handler);
      }, job.everyMs);
      interval.unref?.();
      this.timers.push(interval);
    }, job.initialDelayMs ?? job.everyMs);
    kickoff.unref?.();
    this.timers.push(kickoff);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const job of this.repeating) this.schedule(job);
    logger.info({ jobs: this.repeating.map((job) => job.name) }, 'Background jobs started');
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    this.started = false;
  }
}

function createQueue(): QueueDriver {
  if (config.infra.queueDriver === 'redis') {
    throw new Error(
      'QUEUE_DRIVER=redis requires the BullMQ adapter to be configured. ' +
        'Set QUEUE_DRIVER=memory for local development.',
    );
  }
  return new MemoryQueue();
}

export const queue: QueueDriver = createQueue();
