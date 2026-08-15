import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganizationSchema,
  updateProfileSchema,
} from '@saarthi/shared';
import { config } from '../config/env';
import { errors } from '../lib/errors';
import { created, ok, parseBody } from '../lib/http';
import { requireAuth } from '../server/guards';
import { buildSessionPayload } from './session.service';
import * as authService from './auth.service';
import { AuditAction, auditFromRequest } from '../modules/audit/audit.service';

/**
 * Authentication routes.
 *
 * The refresh token is delivered only as an httpOnly, sameSite cookie — it is
 * never present in a JSON body the browser can read — while the short-lived
 * access token is returned in the response for the client to hold in memory.
 */

function requestMeta(request: FastifyRequest): authService.RequestMeta {
  return {
    ipAddress: request.clientIp ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: String(request.id),
  };
}

function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  void reply.setCookie(config.auth.refreshCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    expires: expiresAt,
    ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(config.auth.refreshCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Credential endpoints get a tighter rate limit than the global default.
  const authLimit = {
    rateLimit: {
      max: config.rateLimit.authMax,
      timeWindow: config.rateLimit.authWindow,
    },
  };

  app.post('/register', { config: authLimit }, async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const result = await authService.register(input, requestMeta(request));
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return created(reply, {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      session: result.session,
    });
  });

  app.post('/login', { config: authLimit }, async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const result = await authService.login(input, requestMeta(request));
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return ok(reply, {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      session: result.session,
    });
  });

  app.post('/refresh', { config: authLimit }, async (request, reply) => {
    const cookieToken = request.cookies[config.auth.refreshCookieName];
    const bodyToken =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as { refreshToken?: string }).refreshToken
        : undefined;
    const token = cookieToken ?? bodyToken;

    if (!token) throw errors.tokenInvalid('No active session was found. Please sign in.');

    const result = await authService.refresh(token, requestMeta(request));
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return ok(reply, {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      session: result.session,
    });
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[config.auth.refreshCookieName];
    // Works whether or not a valid access token is presented.
    await app.optionalAuth(request, reply);
    await authService.logout(token, request.auth?.sessionId);
    clearRefreshCookie(reply);

    if (request.auth) {
      await auditFromRequest(request, {
        action: AuditAction.USER_LOGGED_OUT,
        entityType: 'User',
        entityId: request.auth.user.id,
      });
    }
    return ok(reply, { loggedOut: true });
  });

  app.get('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, await buildSessionPayload(auth.user.id, auth.organizationId));
  });

  app.patch('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(updateProfileSchema, request.body);
    return ok(reply, await authService.updateProfile(auth.user.id, input, auth.organizationId));
  });

  app.post('/change-password', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(changePasswordSchema, request.body);
    await authService.changePassword(auth.user.id, auth.sessionId, input, requestMeta(request));
    return ok(reply, { changed: true });
  });

  app.post('/forgot-password', { config: authLimit }, async (request, reply) => {
    const input = parseBody(forgotPasswordSchema, request.body);
    const result = await authService.requestPasswordReset(input.email, requestMeta(request));
    // Always the same response shape, so the endpoint cannot enumerate accounts.
    return ok(reply, {
      message:
        'If an account exists for that email address, a password reset link has been generated.',
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  });

  app.post('/reset-password', { config: authLimit }, async (request, reply) => {
    const input = parseBody(resetPasswordSchema, request.body);
    await authService.resetPassword(input.token, input.password, requestMeta(request));
    clearRefreshCookie(reply);
    return ok(reply, { reset: true });
  });

  app.post('/switch-organization', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(switchOrganizationSchema, request.body);
    const result = await authService.switchOrganization(
      auth.user.id,
      auth.sessionId,
      input.organizationId,
    );
    return ok(reply, result);
  });

  app.get('/sessions', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const sessions = await authService.listSessions(auth.user.id);
    return ok(
      reply,
      sessions.map((session) => ({ ...session, current: session.id === auth.sessionId })),
    );
  });

  app.delete('/sessions', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const revoked = await authService.revokeAllSessions(auth.user.id, auth.sessionId);
    await auditFromRequest(request, {
      action: AuditAction.SESSION_REVOKED,
      entityType: 'Session',
      after: { revoked },
    });
    return ok(reply, { revoked });
  });
}
