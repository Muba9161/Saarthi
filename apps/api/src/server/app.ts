import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ErrorCode } from '@saarthi/shared';
import { config } from '../config/env';
import { DEV_TUNNEL_ORIGIN, LOCAL_ORIGIN } from '../lib/public-url';
import { redisClient } from '../infra/redis';
import { logger } from '../lib/logger';
import { errorHandlerPlugin } from './plugins/error-handler';
import { requestContextPlugin } from './plugins/request-context';
import { authenticatePlugin } from './plugins/authenticate';
import { healthRoutes } from '../modules/health/health.routes';
import { registerApiRoutes } from './routes';
import { websocketRoutes } from '../realtime/websocket.routes';
import { deviceWebsocketRoutes } from '../realtime/device-websocket.routes';

export const API_PREFIX = '/api/v1';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Cast keeps Fastify on its default logger generic so every module can use
    // the plain `FastifyInstance` type instead of a pino-parameterised one.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    genReqId: () => globalThis.crypto.randomUUID(),
  });

  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin);

  await app.register(helmet, {
    // The API serves JSON and document downloads only; the SPA is served by Vite
    // in development and by a static host in production.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin/native clients send no Origin header.
      if (!origin) return callback(null, true);
      if (config.server.corsOrigins.includes(origin)) return callback(null, true);
      // Loopback *and* the private ranges, outside production. The private
      // ranges are what make a phone work: testing a pairing QR means opening
      // the dashboard on the machine's LAN address, and an origin the browser
      // is refused is an origin the QR must not encode either. The same
      // pattern decides both, so the two cannot drift apart.
      if (!config.isProduction && LOCAL_ORIGIN.test(origin)) {
        return callback(null, true);
      }
      // Outside production, allow the dev-tunnel providers. Reaching the app
      // from a phone or a colleague's browser goes through one of these, and
      // the Vite proxy forwards the browser's Origin unchanged — so without
      // this the tunnel fails here rather than in the browser, which reads as
      // a server fault and is a miserable thing to debug. Production is
      // untouched: there, CORS_ORIGINS is the only list that counts.
      if (!config.isProduction && DEV_TUNNEL_ORIGIN.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS policy'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id'],
  });

  await app.register(cookie, {
    secret: config.auth.cookieSecret,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.cookieSecure,
      path: '/',
      ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
    },
  });

  /*
   * Rate limiting.
   *
   * Backed by Redis when one is configured, and that is not a performance
   * choice: an in-memory limiter counts per instance, so a limit of 10 becomes
   * 30 across three instances and the protection it was supposed to provide
   * quietly disappears. The counters are namespaced per environment for the
   * same reason every other key is.
   */
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    ...(config.infra.cacheDriver === 'redis'
      ? {
          redis: redisClient('rate-limit'),
          nameSpace: `saarthi:${config.env}:ratelimit:`,
        }
      : {}),
    // Rate limit per authenticated user when possible, else per IP.
    keyGenerator: (request) => request.auth?.user.id ?? request.clientIp ?? request.ip,
    allowList: () => config.isTest,
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests. Please slow down and try again shortly.',
      },
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.storage.maxFileSize,
      files: 1,
      fields: 20,
    },
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  await app.register(authenticatePlugin);

  await app.register(healthRoutes);
  await app.register(websocketRoutes);
  // A separate endpoint from /ws, with its own credential population and no
  // channel-subscription surface at all — see the file header for why the
  // duplication is the cheaper risk.
  await app.register(deviceWebsocketRoutes);
  await app.register(registerApiRoutes, { prefix: API_PREFIX });

  return app;
}
