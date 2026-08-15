import type { FastifyInstance } from 'fastify';
import { databaseHealthy } from '../../database/prisma';
import { config } from '../../config/env';
import { ok } from '../../lib/http';

const startedAt = Date.now();

/**
 * Health endpoints live outside /api/v1 so orchestrators can probe them
 * without a version pin, and they never require authentication.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const database = await databaseHealthy();
    const body = {
      status: database ? ('ok' as const) : ('degraded' as const),
      service: 'saarthi-api',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: config.env,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: {
        database: database ? ('up' as const) : ('down' as const),
      },
      demoMode: config.demo.enabled,
      timestamp: new Date().toISOString(),
    };
    return reply.code(database ? 200 : 503).send({ success: true, data: body });
  });

  // Liveness: is the process running at all?
  app.get('/health/live', async (_request, reply) => ok(reply, { status: 'live' }));

  // Readiness: can the process serve traffic (dependencies reachable)?
  app.get('/health/ready', async (_request, reply) => {
    const database = await databaseHealthy();
    if (!database) {
      return reply.code(503).send({
        success: false,
        error: { code: 'NOT_READY', message: 'The database is not reachable.' },
      });
    }
    return ok(reply, { status: 'ready' });
  });
}
