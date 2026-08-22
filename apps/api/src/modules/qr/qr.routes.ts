import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  type QrSubjectType,
  createQrCodeSchema,
  idParamSchema,
  qrBadgeQuerySchema,
  qrImageQuerySchema,
  qrListQuerySchema,
  qrScanListQuerySchema,
  qrSubjectParamSchema,
  qrTokenParamSchema,
  resolveQrQuerySchema,
  revokeQrCodeSchema,
  rotateQrCodeSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as qrService from './qr.service';
import * as renderService from './qr-render.service';

/**
 * QR routes.
 *
 * `/resolve/:token` is registered outside the authenticated scope so a phone
 * camera can open a code without a session — but only codes explicitly marked
 * `allowPublicResolve` answer, and everything else 404s rather than prompting,
 * so an anonymous scan cannot confirm that a token is real.
 */
export async function qrRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------
  // Resolution. Rate limited per token and IP: an unguessable token still
  // deserves a brake, and the scan log is how guessing becomes visible.
  // ---------------------------------------------------------------------
  app.get(
    '/resolve/:token',
    {
      // Optional, not absent: a scan from a signed-in account must be
      // recognised so the scanner's relationship to the subject can widen what
      // is disclosed, while an anonymous scan still reaches the handler and
      // gets the public projection (or a 404).
      preHandler: app.optionalAuth,
      config: {
        rateLimit: {
          max: config.qr.resolveRateLimitMax,
          timeWindow: config.qr.resolveRateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const { token } = parseParams(qrTokenParamSchema, request.params);
      const query = parseQuery(resolveQrQuerySchema, request.query);

      const result = await qrService.resolveToken(request.auth ?? null, token, query, {
        ipAddress: request.clientIp ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      });

      // Audited only for authenticated scans: an anonymous scan has no actor to
      // attribute, and the QrScan row already holds the forensic detail.
      if (request.auth) {
        await auditFromRequest(request, {
          action: AuditAction.QR_SCANNED,
          entityType: 'QrCode',
          entityId: result.subjectId,
          after: {
            subjectType: result.subjectType,
            purpose: query.purpose,
            scopes: result.scopesGranted,
          },
        });
      }

      return ok(reply, result);
    },
  );

  // ---------------------------------------------------------------------
  // Management. Requires a session.
  // ---------------------------------------------------------------------
  app.register(async (scoped) => {
    scoped.addHook('preHandler', scoped.authenticate);

    scoped.post(
      '/',
      {
        preHandler: [
          requirePermission(Permission.QR_MANAGE),
          requireFeature(Feature.QR_IDENTITY),
        ],
      },
      async (request, reply) => {
        const auth = requireAuth(request);
        const input = parseBody(createQrCodeSchema, request.body);
        const code = await qrService.createQrCode(auth, input);

        await auditFromRequest(request, {
          action: AuditAction.QR_CREATED,
          entityType: 'QrCode',
          entityId: code.id,
          after: { subjectType: code.subjectType, subjectId: code.subjectId, scopes: code.scopes },
        });

        return ok(reply, code);
      },
    );

    scoped.get(
      '/',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const query = parseQuery(qrListQuerySchema, request.query);
        const result = await qrService.listQrCodes(auth, query);
        return paginated(reply, result.items, result.pagination);
      },
    );

    /**
     * Idempotent get-or-create for a subject, so a truck or driver screen can
     * show a QR without the UI having to manage provisioning.
     */
    scoped.get(
      '/subject/:subjectType/:subjectId',
      {
        preHandler: [requirePermission(Permission.QR_READ), requireFeature(Feature.QR_IDENTITY)],
      },
      async (request, reply) => {
        const auth = requireAuth(request);
        const params = parseParams(qrSubjectParamSchema, {
          ...(request.params as Record<string, string>),
          subjectType: (request.params as { subjectType: string }).subjectType.toUpperCase(),
        });
        return ok(
          reply,
          await qrService.ensureForSubject(
            auth,
            params.subjectType as QrSubjectType,
            params.subjectId,
          ),
        );
      },
    );

    scoped.get(
      '/:id',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        return ok(reply, await qrService.getQrCode(auth, id));
      },
    );

    scoped.get(
      '/:id/image.svg',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const query = parseQuery(qrImageQuerySchema, request.query);
        const { code } = await qrService.loadTokenForRendering(auth, id);

        const svg = await renderService.renderSvg(code.token, {
          size: query.size,
          errorCorrection: query.errorCorrection,
          margin: query.margin,
        });

        return reply
          .header('content-type', 'image/svg+xml; charset=utf-8')
          // The image embeds a live credential, so it is never shared-cached.
          .header('cache-control', 'private, max-age=300')
          .send(svg);
      },
    );

    scoped.get(
      '/:id/image.png',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const query = parseQuery(qrImageQuerySchema, request.query);
        const { code } = await qrService.loadTokenForRendering(auth, id);

        const png = await renderService.renderPng(code.token, {
          size: query.size,
          errorCorrection: query.errorCorrection,
          margin: query.margin,
        });

        return reply
          .header('content-type', 'image/png')
          .header('cache-control', 'private, max-age=300')
          .send(png);
      },
    );

    scoped.get(
      '/:id/badge.svg',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const { preset } = parseQuery(qrBadgeQuerySchema, request.query);
        const { code, subject } = await qrService.loadTokenForRendering(auth, id);

        const organization = subject.organizationId
          ? await organizationName(subject.organizationId)
          : null;

        const svg = await renderService.renderBadgeSvg({
          token: code.token,
          presetKey: preset,
          title: subject.displayName,
          subtitle: subject.secondaryLabel,
          organizationName: organization?.name ?? null,
          verified: organization?.verified ?? false,
        });

        return reply
          .header('content-type', 'image/svg+xml; charset=utf-8')
          .header('cache-control', 'private, max-age=300')
          .send(svg);
      },
    );

    scoped.post(
      '/:id/rotate',
      { preHandler: requirePermission(Permission.QR_MANAGE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const input = parseBody(rotateQrCodeSchema, request.body);
        const code = await qrService.rotateQrCode(auth, id, input);

        await auditFromRequest(request, {
          action: AuditAction.QR_ROTATED,
          entityType: 'QrCode',
          entityId: id,
          after: { newCodeId: code.id, version: code.version, reason: input.reason ?? null },
        });

        return ok(reply, code);
      },
    );

    scoped.post(
      '/:id/revoke',
      { preHandler: requirePermission(Permission.QR_MANAGE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const { reason } = parseBody(revokeQrCodeSchema, request.body);
        const code = await qrService.revokeQrCode(auth, id, reason);

        await auditFromRequest(request, {
          action: AuditAction.QR_REVOKED,
          entityType: 'QrCode',
          entityId: id,
          after: { reason },
        });

        return ok(reply, code);
      },
    );

    scoped.get(
      '/:id/scans',
      { preHandler: requirePermission(Permission.QR_AUDIT) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const query = parseQuery(qrScanListQuerySchema, request.query);
        const result = await qrService.listScans(auth, id, query);
        return paginated(reply, result.items, result.pagination);
      },
    );
  });
}

/** Small helper so the badge route does not reach into Prisma directly twice. */
async function organizationName(
  organizationId: string,
): Promise<{ name: string; verified: boolean } | null> {
  const { prisma } = await import('../../database/prisma');
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, verificationStatus: true },
  });
  return organization
    ? { name: organization.name, verified: organization.verificationStatus === 'VERIFIED' }
    : null;
}
