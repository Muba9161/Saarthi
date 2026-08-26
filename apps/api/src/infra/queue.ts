import { config } from '../config/env';
import { logger } from '../lib/logger';
import { withLock } from './lock';

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
  readonly name: string = 'memory';
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

  /** Hook for drivers that coordinate across instances. */
  protected async run(jobName: string, handler: JobHandler): Promise<void> {
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

/**
 * The same scheduler, coordinated across instances by a distributed lock.
 *
 * Every instance keeps its own timers — which is what makes this survive one of
 * them dying — but only the instance that takes the lock for a given tick
 * actually runs the job. That is the guarantee that matters here: three API
 * instances must not each send the same EMI reminder.
 *
 * What this deliberately is *not* is a durable job queue. There is no retry,
 * no backoff and no dead-letter handling, because every job registered today is
 * an idempotent sweep that will simply run again on the next tick. When work
 * arrives that genuinely needs delivery guarantees — a payment capture, an
 * outbound webhook — that is the point to bring in BullMQ, and the JobHandler
 * signature is already the shape BullMQ processors take.
 */
class DistributedQueue extends MemoryQueue {
  override readonly name = 'redis-coordinated';

  protected override async run(jobName: string, handler: JobHandler): Promise<void> {
    // The lease is generous: it only has to outlive the job, and an over-short
    // lease would let a second instance start while the first is still working.
    const result = await withLock(`job:${jobName}`, 10 * 60_000, async () => {
      await super.run(jobName, handler);
      return true;
    });

    if (result === null) {
      logger.debug({ job: jobName }, 'Job claimed by another instance');
    }
  }
}

function createQueue(): QueueDriver {
  if (config.infra.queueDriver === 'redis') {
    return new DistributedQueue();
  }
  return new MemoryQueue();
}

export const queue: QueueDriver = createQueue();
