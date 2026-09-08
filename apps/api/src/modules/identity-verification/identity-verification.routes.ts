import type { FastifyInstance } from 'fastify';
import {
  Feature,
  IDENTITY_KINDS,
  Permission,
  identitySubjectParamsSchema,
  verifyIdentitySchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import { identityProviderConfigured } from '../../providers/identity';
import * as identityService from './identity-verification.service';

/**
 * Identity verification routes — Aadhaar, PAN, Voter ID and GSTIN.
 *
 * Gated like the RC and licence routes and for the same reasons: these records
 * are personal data and every call is billable. The rate limit is per user and
 * sits on top of the global one, so a script cannot walk a number space at the
 * platform's expense.
 */
export async function identityVerificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * The catalogue: which kinds exist, what each needs, and whether this
   * environment can reach a source at all. Lets the client build the verify
   * form and hide what it cannot offer, rather than discovering a 503 after
   * somebody has typed their Aadhaar number in.
   */
  app.get('/kinds', async (_request, reply) =>
    ok(reply, {
      onlineVerificationAvailable: identityProviderConfigured,
      kinds: IDENTITY_KINDS,
    }),
  );

  /**
   * Every check held for one subject. No provider call, no charge — this is
   * what the document panel reads to decide which rows need a Verify button.
   */
  app.get(
    '/subject/:subjectType/:subjectId',
    {
      preHandler: [
        requirePermission(Permission.VERIFICATION_READ),
        // DOCUMENTS_BASIC rather than FLEET_BASIC: this surface covers a
        // business's GSTIN as well as a driver's Aadhaar, and a supplier with
        // no vehicles still has to prove who it is. Both sit in the lowest
        // tier, so no plan loses access by this being the honest one.
        requireFeature(Feature.DOCUMENTS_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { subjectType, subjectId } = parseParams(
        identitySubjectParamsSchema,
        request.params,
      );
      return ok(
        reply,
        await identityService.getSubjectIdentityChecks(auth, subjectType, subjectId),
      );
    },
  );

  app.post(
    '/verify',
    {
      config: {
        rateLimit: {
          max: config.identity.rateLimitMax,
          timeWindow: config.identity.rateLimitWindow,
        },
      },
      preHandler: [
        requirePermission(Permission.IDENTITY_VERIFY),
        requireFeature(Feature.DOCUMENTS_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(verifyIdentitySchema, request.body);
      const { summary, audit, driverChecklist } = await identityService.verifyIdentity(
        auth,
        input,
      );

      await auditFromRequest(request, {
        action: AuditAction.IDENTITY_VERIFICATION_CHECKED,
        entityType: 'IdentityVerification',
        entityId: audit.verificationId,
        // Kind and outcome only. The number never enters the audit log, and
        // neither does the holder's name, the PAN an Aadhaar was linked
        // against, or anything else the source returned.
        after: {
          kind: audit.kind,
          subjectType: audit.subjectType,
          subjectId: audit.subjectId,
          documentId: audit.documentId,
          outcome: audit.outcome,
          cached: audit.cached,
          provider: audit.provider,
          providerReference: audit.providerReference,
          sensitiveFieldsIncluded: identityService.canSeeIdentityHolderData(auth),
        },
      });

      // The check's own result, plus where the driver now stands against all
      // four — so the client can say "PAN confirmed, Voter ID still needed"
      // from one reply instead of refetching to find out.
      return ok(reply, { ...summary, driverChecklist });
    },
  );
}
