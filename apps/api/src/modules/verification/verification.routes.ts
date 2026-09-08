import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Feature,
  Permission,
  VerificationSubjectType,
  idParamSchema,
  registryVerifySchema,
  reviewVerificationSchema,
  submitVerificationSchema,
  verificationListQuerySchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireDemoMode,
  requireFeature,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as registryVerificationService from './registry-verification.service';
import * as verificationService from './verification.service';

/**
 * Subject routes take the type and id from the path. Validating the id as a
 * UUID here means a malformed one is a 400 rather than a database error.
 */
const subjectParamsSchema = z.object({
  subjectType: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.nativeEnum(VerificationSubjectType)),
  subjectId: z.string().uuid('Enter a valid identifier.'),
});

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { preHandler: requirePermission(Permission.VERIFICATION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(verificationListQuerySchema, request.query);
      const result = await verificationService.listVerificationCases(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.VERIFICATION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await verificationService.getVerificationCase(auth, id));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.VERIFICATION_SUBMIT) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(submitVerificationSchema, request.body);
      const result = await verificationService.submitVerification(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.VERIFICATION_SUBMITTED,
        entityType: 'VerificationCase',
        entityId: result.id,
        after: { subjectType: input.subjectType, subjectId: input.subjectId },
      });

      return created(reply, result);
    },
  );

  app.post(
    '/:id/review',
    { preHandler: requirePermission(Permission.VERIFICATION_REVIEW) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(reviewVerificationSchema, request.body);
      const result = await verificationService.reviewVerification(auth, id, input);

      await auditFromRequest(request, {
        action:
          input.decision === 'VERIFIED'
            ? AuditAction.VERIFICATION_APPROVED
            : input.decision === 'REJECTED'
              ? AuditAction.VERIFICATION_REJECTED
              : AuditAction.VERIFICATION_CORRECTION_REQUESTED,
        entityType: 'VerificationCase',
        entityId: id,
        organizationId: result.organizationId,
        after: { decision: input.decision, reason: input.rejectionReason ?? null },
      });

      return ok(reply, result);
    },
  );

  /**
   * Verify a vehicle or a driver against the registry that issued its record.
   *
   * The one-click path, and the one an owner actually uses: the RC or licence
   * number Saarthi already holds is checked with the RTO, and the answer
   * settles the subject's status there and then. Nothing is queued for a
   * reviewer and nobody is asked to upload anything first.
   *
   * Gated on `verification.submit` here, with the matching *lookup* permission
   * checked in the service — which one applies depends on the subject, and a
   * driver who may check their own licence must not be stopped by a rule about
   * RC records.
   *
   * It carries its own rate limit, because reaching this endpoint can reach a
   * billable provider. One route serves both registries, so the *stricter* of
   * the two configured ceilings applies — an operator who tightened either
   * lookup limit would not expect this path to be the loose way around it.
   */
  app.post(
    '/subject/:subjectType/:subjectId/registry-verify',
    {
      config: {
        rateLimit: {
          max: Math.min(config.vehicleRc.rateLimitMax, config.drivingLicence.rateLimitMax),
          timeWindow: config.vehicleRc.rateLimitWindow,
        },
      },
      preHandler: [
        requirePermission(Permission.VERIFICATION_SUBMIT),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { subjectType, subjectId } = parseParams(subjectParamsSchema, request.params);
      const input = parseBody(registryVerifySchema, request.body ?? {});

      const { result, audit } = await registryVerificationService.verifyAgainstRegistry(
        auth,
        subjectType,
        subjectId,
        input,
      );

      await auditFromRequest(request, {
        action: audit.verified
          ? AuditAction.VERIFICATION_APPROVED
          : AuditAction.VERIFICATION_REJECTED,
        entityType: 'VerificationCase',
        entityId: audit.caseId,
        organizationId: result.case.organizationId,
        // Outcome and provenance only. The registry's own answer — an owner's
        // name, a licence holder's address, the date of birth it was checked
        // against — never enters the audit log.
        after: {
          decision: audit.verified ? 'VERIFIED' : 'REJECTED',
          registryCheck: true,
          source: audit.source,
          subjectType: audit.subjectType,
          subjectId: audit.subjectId,
          outcome: audit.outcome,
          providerCalled: audit.checked && !audit.cached,
          cached: audit.cached,
          lookupId: audit.lookupId,
          providerReference: audit.providerReference,
          findings: audit.findingCodes,
        },
      });

      return ok(reply, result);
    },
  );

  // Demo affordance: a self-served organization can approve its own submission
  // so a fresh local install is usable without a platform reviewer. Behind
  // `requireDemoMode`, which cannot be enabled in production.
  app.post(
    '/:id/self-approve',
    { preHandler: [requireDemoMode(), requirePermission(Permission.VERIFICATION_SUBMIT)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const result = await verificationService.selfApproveVerification(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.VERIFICATION_APPROVED,
        entityType: 'VerificationCase',
        entityId: id,
        organizationId: result.organizationId,
        after: { decision: 'VERIFIED', selfApproved: true },
      });

      return ok(reply, result);
    },
  );

  // Demo affordance: mark a driver/truck/organization verified without the
  // document round-trip, so a freshly registered fleet can dispatch a trip.
  app.post(
    '/subject/:subjectType/:subjectId/demo-verify',
    { preHandler: [requireDemoMode(), requirePermission(Permission.VERIFICATION_SUBMIT)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { subjectType, subjectId } = parseParams(subjectParamsSchema, request.params);

      const result = await verificationService.demoVerifySubject(auth, subjectType, subjectId);

      await auditFromRequest(request, {
        action: AuditAction.VERIFICATION_APPROVED,
        entityType: 'VerificationCase',
        entityId: result.id,
        organizationId: result.organizationId,
        after: { decision: 'VERIFIED', demoDirectVerify: true, subjectType },
      });

      return ok(reply, result);
    },
  );

  // Readiness + current case for one subject, used by driver/truck detail views.
  app.get(
    '/subject/:subjectType/:subjectId',
    { preHandler: requirePermission(Permission.VERIFICATION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { subjectType, subjectId } = parseParams(subjectParamsSchema, request.params);
      return ok(reply, await verificationService.getCaseForSubject(auth, subjectType, subjectId));
    },
  );
}
