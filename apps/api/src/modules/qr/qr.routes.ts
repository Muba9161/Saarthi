import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  QR_BADGE_PRESETS,
  QrSubjectType,
  createQrCodeSchema,
  defaultBadgePresetFor,
  qrTargetUrl,
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
  updateQrPrivacyPolicySchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { publicAppUrl } from '../../lib/public-url';
import { ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAllPermissions,
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as qrService from './qr.service';
import * as privacyService from './qr-privacy.service';
import * as renderService from './sticker.renderer';
import * as qrImage from './qr-render.service';

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
        preHandler: [requirePermission(Permission.QR_MANAGE), requireFeature(Feature.QR_IDENTITY)],
      },
      async (request, reply) => {
        const auth = requireAuth(request);
        const input = parseBody(createQrCodeSchema, request.body);
        const code = await qrService.createQrCode(auth, input, publicAppUrl(request));

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
        const result = await qrService.listQrCodes(auth, query, publicAppUrl(request));
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
            publicAppUrl(request),
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
        return ok(reply, await qrService.getQrCode(auth, id, publicAppUrl(request)));
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

        const svg = await qrImage.renderSvg(code.token, {
          size: query.size,
          errorCorrection: query.errorCorrection,
          margin: query.margin,
          baseUrl: publicAppUrl(request),
        });

        return (
          reply
            .header('content-type', 'image/svg+xml; charset=utf-8')
            // The image embeds a live credential, so it is never shared-cached.
            .header('cache-control', 'private, max-age=300')
            .send(svg)
        );
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

        const png = await qrImage.renderPng(code.token, {
          size: query.size,
          errorCorrection: query.errorCorrection,
          margin: query.margin,
          baseUrl: publicAppUrl(request),
        });

        return reply
          .header('content-type', 'image/png')
          .header('cache-control', 'private, max-age=300')
          .send(png);
      },
    );

    /** The printable presets, so the UI can offer them without hardcoding. */
    scoped.get('/badge-presets', async (_request, reply) =>
      ok(reply, Object.values(QR_BADGE_PRESETS)),
    );

    /**
     * The printable sticker.
     *
     * SVG on purpose: it is vector, so it prints at the printer's own DPI
     * rather than one we guessed, and it needs no native rasteriser on the
     * server. A client that wants a PNG can draw it to a canvas at whatever
     * size it likes.
     */
    scoped.get(
      '/:id/badge.svg',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const query = parseQuery(qrBadgeQuerySchema, request.query);
        const { code, subject } = await qrService.loadTokenForRendering(auth, id);

        const organization = subject.organizationId
          ? await organizationName(subject.organizationId)
          : null;

        const subjectType = code.subjectType as QrSubjectType;
        const presetKey = query.preset ?? defaultBadgePresetFor(subjectType);

        const stickerInput = {
          token: code.token,
          presetKey,
          title: subject.displayName,
          subtitle: subject.secondaryLabel,
          organizationName: organization?.name ?? null,
          verified: organization?.verified ?? false,
          subjectKind:
            subjectType === QrSubjectType.DRIVER || subjectType === QrSubjectType.USER
              ? ('DRIVER' as const)
              : subjectType === QrSubjectType.VEHICLE
                ? ('VEHICLE' as const)
                : ('OTHER' as const),
          printMarks: query.printMarks,
          mirror: query.mirror,
        };

        const targetUrl = qrTargetUrl(publicAppUrl(request), code.token);

        const svg = query.sheet
          ? await renderService.renderStickerSheetSvg(stickerInput, targetUrl, {
              ...(query.columns !== undefined ? { columns: query.columns } : {}),
              ...(query.rows !== undefined ? { rows: query.rows } : {}),
            })
          : await renderService.renderStickerSvg(stickerInput, targetUrl);

        const fileName = `saarthi-${presetKey}-${subject.displayName
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase()}${query.sheet ? '-sheet' : ''}.svg`;

        return (
          reply
            .header('content-type', 'image/svg+xml; charset=utf-8')
            // Named so a download lands as a recognisable file rather than
            // "badge.svg" forty times over.
            .header('content-disposition', `inline; filename="${fileName}"`)
            // The artefact embeds a live credential, so never shared-cached.
            .header('cache-control', 'private, max-age=300')
            .send(svg)
        );
      },
    );

    scoped.post(
      '/:id/rotate',
      { preHandler: requirePermission(Permission.QR_MANAGE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const input = parseBody(rotateQrCodeSchema, request.body);
        const code = await qrService.rotateQrCode(auth, id, input, publicAppUrl(request));

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
        const code = await qrService.revokeQrCode(auth, id, reason, publicAppUrl(request));

        await auditFromRequest(request, {
          action: AuditAction.QR_REVOKED,
          entityType: 'QrCode',
          entityId: id,
          after: { reason },
        });

        return ok(reply, code);
      },
    );

    /**
     * Field disclosure policy.
     *
     * Read is open to anyone who can read QR codes: somebody printing a sticker
     * should be able to check what it will reveal before it goes on a door.
     */
    scoped.get(
      '/privacy-policy',
      { preHandler: requirePermission(Permission.QR_READ) },
      async (request, reply) => {
        const organizationId = requireOrganizationId(request);
        const policy = await privacyService.getPrivacyPolicy(organizationId);
        return ok(reply, privacyService.describePolicy(policy));
      },
    );

    /*
     * Writing needs QR_MANAGE *and* ORG_UPDATE. A dispatcher legitimately holds
     * QR_MANAGE — issuing and revoking codes is their job — but rewriting what
     * every code in the fleet discloses about drivers is an organization-level
     * decision, and it belongs with the account that answers for it.
     */
    scoped.put(
      '/privacy-policy',
      { preHandler: requireAllPermissions(Permission.QR_MANAGE, Permission.ORG_UPDATE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const organizationId = requireOrganizationId(request);
        const input = parseBody(updateQrPrivacyPolicySchema, request.body ?? {});
        const policy = await privacyService.updatePrivacyPolicy(auth, organizationId, input);

        await auditFromRequest(request, {
          action: AuditAction.QR_PRIVACY_POLICY_UPDATED,
          entityType: 'QrPrivacyPolicy',
          entityId: organizationId,
          after: {
            fields: Object.keys(policy.overrides).length,
            allowPublicScans: policy.allowPublicScans,
          },
        });

        return ok(reply, privacyService.describePolicy(policy));
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
