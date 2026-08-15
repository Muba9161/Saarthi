import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Attaches per-request context that later plugins and audit writes rely on:
 * a stable client IP and a correlation id echoed back on every response.
 */
export const requestContextPlugin = fp(async function requestContextPlugin(app: FastifyInstance) {
  app.decorateRequest('clientIp', '');

  app.addHook('onRequest', async (request, reply) => {
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedFirst = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]
        : undefined;

    request.clientIp = (forwardedFirst?.trim() || request.ip || 'unknown').replace(/^::ffff:/, '');
    void reply.header('x-request-id', request.id);
  });
});
