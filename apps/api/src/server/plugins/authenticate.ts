import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { verifyAccessToken } from '../../auth/tokens';
import { buildAuthContext } from '../../auth/session.service';

/**
 * Authentication plugin.
 *
 * `authenticate` verifies the bearer token, confirms the backing session has
 * not been revoked, then resolves the full AuthContext (tenant, permissions,
 * entitlements). Revocation is checked on every request so "sign out
 * everywhere" and account suspension take effect immediately rather than when
 * the access token happens to expire.
 */

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

async function resolve(request: FastifyRequest): Promise<void> {
  const token = bearerToken(request);
  if (!token) throw errors.unauthenticated();

  const claims = verifyAccessToken(token);

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: { id: true, userId: true, organizationId: true, revokedAt: true, expiresAt: true },
  });

  if (!session || session.userId !== claims.sub) throw errors.tokenInvalid();
  if (session.revokedAt) throw errors.tokenInvalid('This session has been signed out.');
  if (session.expiresAt.getTime() < Date.now()) throw errors.tokenExpired();

  // The session row is authoritative for the active tenant: switching
  // organizations must not require the client to present a new token.
  request.auth = await buildAuthContext(claims.sub, session.id, session.organizationId);
}

export const authenticatePlugin = fp(async function authenticatePlugin(app: FastifyInstance) {
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    await resolve(request);
  });

  app.decorate('optionalAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await resolve(request);
    } catch {
      request.auth = undefined;
    }
  });
});
