import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Single PrismaClient for the process. Query logging is routed through pino so
 * slow statements show up in the same structured stream as request logs.
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  const dbLogger = logger.child({ module: 'prisma' });

  client.$on('warn', (event) => dbLogger.warn({ target: event.target }, event.message));
  client.$on('error', (event) => dbLogger.error({ target: event.target }, event.message));

  const SLOW_QUERY_MS = 300;
  client.$on('query', (event) => {
    if (event.duration >= SLOW_QUERY_MS) {
      dbLogger.warn({ durationMs: event.duration, query: event.query }, 'Slow query');
    } else if (config.log.level === 'trace') {
      dbLogger.trace({ durationMs: event.duration, query: event.query }, 'Query');
    }
  });

  return client;
}

declare global {
   
  var __saarthiPrisma: PrismaClient | undefined;
}

// Reuse across tsx hot-reloads so watch mode does not exhaust the pool.
export const prisma: PrismaClient = globalThis.__saarthiPrisma ?? createPrismaClient();
if (!config.isProduction) globalThis.__saarthiPrisma = prisma;

export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Accepts either the root client or an interactive transaction client. */
export type Db = PrismaClient | PrismaTransaction;

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export async function databaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError & { meta?: { target?: string[] } } {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Prisma "record not found" for update/delete on a missing row. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Field names involved in a unique-constraint violation. */
export function uniqueViolationFields(error: unknown): string[] {
  if (!isUniqueViolation(error)) return [];
  const target = error.meta?.target;
  return Array.isArray(target) ? target : [];
}

export { Prisma };
