import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ErrorCode } from '@saarthi/shared';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { errorHandlerPlugin } from './plugins/error-handler';
import { requestContextPlugin } from './plugins/request-context';
import { authenticatePlugin } from './plugins/authenticate';
import { healthRoutes } from '../modules/health/health.routes';
import { registerApiRoutes } from './routes';
import { websocketRoutes } from '../realtime/websocket.routes';

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
      if (!config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
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

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
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
  await app.register(registerApiRoutes, { prefix: API_PREFIX });

  return app;
}
